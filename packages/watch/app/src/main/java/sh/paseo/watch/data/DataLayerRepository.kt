package sh.paseo.watch.data

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.DataEvent
import com.google.android.gms.wearable.DataEventBuffer
import com.google.android.gms.wearable.DataMapItem
import com.google.android.gms.wearable.Wearable
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import sh.paseo.watch.model.AgentSession
import sh.paseo.watch.model.Transcript
import sh.paseo.watch.model.Workspace

private const val TAG = "PaseoWear"

/** What the UI needs to know about the phone link, and nothing more. */
enum class LinkState {
  /** No snapshot yet and no known phone — show setup guidance. */
  Waiting,

  /** Snapshot received; normal operation. */
  Linked,

  /** We had data, but the phone is not currently reachable. */
  Stale,
}

/**
 * [WatchRepository] backed by the Wearable Data Layer.
 *
 * Snapshots arrive as a DataItem on [WearBridge.SNAPSHOT_PATH]. DataClient is the
 * right primitive for this: it persists, syncs on its own schedule, and — crucially —
 * redelivers the latest item when the watch comes back into range, so the list is
 * never blank just because the link blipped.
 *
 * Commands go out over MessageClient, which fails fast when the phone is
 * unreachable. That is deliberate: silently queueing "approve this permission" for
 * later delivery would be worse than an honest failure.
 */
class DataLayerRepository(
  context: Context,
  private val scope: CoroutineScope,
) : WatchRepository, DataClient.OnDataChangedListener {

  private val appContext = context.applicationContext
  private val dataClient: DataClient = Wearable.getDataClient(appContext)
  private val messageClient = Wearable.getMessageClient(appContext)
  private val nodeClient = Wearable.getNodeClient(appContext)

  private val state = MutableStateFlow<List<Workspace>>(emptyList())
  override val workspaces: StateFlow<List<Workspace>> = state

  private val transcriptState = MutableStateFlow<Map<String, Transcript>>(emptyMap())
  override val transcripts: StateFlow<Map<String, Transcript>> = transcriptState

  private val link = MutableStateFlow(LinkState.Waiting)
  val linkState: StateFlow<LinkState> = link.asStateFlow()

  private val lastError = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = lastError.asStateFlow()

  /**
   * A second, distinct listener object for the transcript prefix.
   *
   * Play Services keys a live listener registration by the listener **object**, not
   * by the URI filter it was registered with. Registering `this` twice with two
   * different filters is therefore not two subscriptions: the second registration
   * can replace the first, and we would silently lose one of the two streams —
   * either snapshots or transcripts, with no error on either side. Two filters means
   * two objects.
   */
  private val transcriptListener =
    object : DataClient.OnDataChangedListener {
      override fun onDataChanged(events: DataEventBuffer) = handleEvents(events)
    }

  fun start() {
    dataClient.addListener(this, android.net.Uri.parse("wear://*$SNAPSHOT_PATH_SUFFIX"), DataClient.FILTER_PREFIX)
    // Transcripts live one-per-agent under a prefix, so this filter is a prefix
    // match on the directory rather than a single path.
    dataClient.addListener(
      transcriptListener,
      android.net.Uri.parse("wear://*$TRANSCRIPT_PATH_PREFIX/"),
      DataClient.FILTER_PREFIX,
    )
    // Read whatever is already cached before asking for anything new: this is what
    // makes the list appear instantly on launch instead of after a round trip. The
    // same pass picks up transcripts, so reopening an agent renders its scrollback
    // immediately while the fresh copy is still in flight.
    scope.launch { loadCachedDataItems() }
    scope.launch { requestRefresh() }
  }

  fun stop() {
    dataClient.removeListener(this)
    dataClient.removeListener(transcriptListener)
  }

  override fun onDataChanged(events: DataEventBuffer) = handleEvents(events)

  /**
   * Shared by both listeners. Dispatch is by path rather than by which listener
   * fired, so a filter that delivers more than we asked for still routes correctly.
   */
  private fun handleEvents(events: DataEventBuffer) {
    for (event in events) {
      if (event.type != DataEvent.TYPE_CHANGED) continue
      val path = event.dataItem.uri.path.orEmpty()
      val raw = DataMapItem.fromDataItem(event.dataItem).dataMap.getString(WearBridge.SNAPSHOT_KEY)
      when {
        path.endsWith(SNAPSHOT_PATH_SUFFIX) -> applySnapshot(raw)
        path.contains(TRANSCRIPT_PATH_MARKER) -> applyTranscript(raw)
      }
    }
    events.release()
  }

  private suspend fun loadCachedDataItems() {
    val items =
      runCatching { dataClient.dataItems.await() }
        .onFailure { Log.w(TAG, "Failed to read cached data items", it) }
        .getOrNull() ?: return
    try {
      for (item in items) {
        val path = item.uri.path.orEmpty()
        val raw = DataMapItem.fromDataItem(item).dataMap.getString(WearBridge.SNAPSHOT_KEY)
        when {
          path.endsWith(SNAPSHOT_PATH_SUFFIX) -> applySnapshot(raw)
          path.contains(TRANSCRIPT_PATH_MARKER) -> applyTranscript(raw)
        }
      }
    } finally {
      items.release()
    }
  }

  private fun applyTranscript(raw: String?) {
    if (raw == null) return
    val wire = decodeTranscript(raw)
    if (wire == null || wire.agentId.isEmpty()) {
      // Malformed, or a protocol version we don't speak. Unlike a snapshot this is
      // not worth surfacing: a missing transcript already has a good fallback (the
      // summary card), and the snapshot path will raise the version complaint.
      Log.w(TAG, "Dropped unparseable or version-mismatched transcript")
      return
    }
    val incoming = wire.toTranscript()
    if (!shouldApplyTranscript(transcriptState.value[wire.agentId], incoming)) return
    transcriptState.value = transcriptState.value + (wire.agentId to incoming)
  }

  private fun applySnapshot(raw: String?) {
    if (raw == null) return
    val snapshot = decodeSnapshot(raw)
    if (snapshot == null) {
      // Either malformed or a protocol version we don't speak. Keep whatever we're
      // already showing rather than blanking the screen.
      Log.w(TAG, "Dropped unparseable or version-mismatched snapshot")
      lastError.value = "Update Paseo on your phone"
      return
    }
    lastError.value = null
    val workspaces = snapshot.toWorkspaces()
    state.value = workspaces
    link.value = LinkState.Linked
    pruneTranscripts(workspaces)
  }

  /** Keeps watch memory tracking the live agent set. See [retainingAgentsIn]. */
  private fun pruneTranscripts(workspaces: List<Workspace>) {
    val current = transcriptState.value
    val kept = current.retainingAgentsIn(workspaces)
    // Only publish when something actually went, so an unchanged agent set doesn't
    // wake every collector on each snapshot.
    if (kept.size != current.size) transcriptState.value = kept
  }

  override fun workspace(id: String): Workspace? = state.value.firstOrNull { it.id == id }

  override fun agent(id: String): AgentSession? =
    state.value.flatMap { it.agents }.firstOrNull { it.id == id }

  override suspend fun sendPrompt(agentId: String, text: String) {
    val agent = agent(agentId) ?: return
    send(
      WireCommand(
        kind = WireCommand.SEND_PROMPT,
        serverId = agent.serverId,
        agentId = agentId,
        text = text,
      ),
    )
  }

  override suspend fun createAgent(workspaceId: String, prompt: String) {
    val workspace = workspace(workspaceId) ?: return
    send(
      WireCommand(
        kind = WireCommand.CREATE_AGENT,
        serverId = workspace.serverId,
        workspaceId = workspaceId,
        text = prompt,
      ),
    )
  }

  override suspend fun respondToPermission(requestId: String, allow: Boolean) {
    val agent =
      state.value.flatMap { it.agents }.firstOrNull { it.pendingPermission?.id == requestId }
        ?: return
    send(
      WireCommand(
        kind = WireCommand.RESPOND_PERMISSION,
        serverId = agent.serverId,
        agentId = agent.id,
        requestId = requestId,
        allow = allow,
      ),
    )
    // Optimistically clear it so the button press feels instant. The phone's next
    // snapshot is authoritative and will correct this if the response was rejected.
    state.value =
      state.value.map { workspace ->
        workspace.copy(
          agents =
            workspace.agents.map {
              if (it.pendingPermission?.id == requestId) it.copy(pendingPermission = null) else it
            },
        )
      }
  }

  override suspend fun requestTranscript(agentId: String) {
    val agent = agent(agentId) ?: return
    send(
      WireCommand(
        kind = WireCommand.REQUEST_TRANSCRIPT,
        serverId = agent.serverId,
        agentId = agentId,
      ),
    )
  }

  override suspend fun stopAgent(agentId: String) {
    val agent = agent(agentId) ?: return
    send(
      WireCommand(
        kind = WireCommand.STOP_AGENT,
        serverId = agent.serverId,
        agentId = agentId,
      ),
    )
  }

  private suspend fun requestRefresh() {
    val payload = ByteArray(0)
    broadcast(WearBridge.REFRESH_PATH, payload)
  }

  private suspend fun send(command: WireCommand) {
    val payload = WearBridge.json.encodeToString(WireCommand.serializer(), command).toByteArray()
    broadcast(WearBridge.COMMAND_PATH, payload)
  }

  /**
   * Send to every connected node. There is normally exactly one phone, but a node
   * list of one is not guaranteed, and picking "the first" would silently drop the
   * command when the ordering isn't what we assumed.
   */
  private suspend fun broadcast(path: String, payload: ByteArray) {
    withContext(Dispatchers.IO) {
      val nodes =
        runCatching { nodeClient.connectedNodes.await() }
          .onFailure {
            Log.w(TAG, "Failed to list nodes", it)
            lastError.value = "Phone not reachable"
          }
          .getOrNull()
          .orEmpty()

      if (nodes.isEmpty()) {
        link.value = if (state.value.isEmpty()) LinkState.Waiting else LinkState.Stale
        lastError.value = "Phone not reachable"
        return@withContext
      }

      var delivered = false
      for (node in nodes) {
        val result =
          runCatching { messageClient.sendMessage(node.id, path, payload).await() }
            .onFailure { Log.w(TAG, "sendMessage to ${node.displayName} failed", it) }
        if (result.isSuccess) delivered = true
      }
      if (!delivered) {
        lastError.value = "Phone not reachable"
        link.value = if (state.value.isEmpty()) LinkState.Waiting else LinkState.Stale
      } else {
        lastError.value = null
      }
    }
  }

  private companion object {
    /**
     * DataItem URIs are `wear://<nodeId><path>`, so matching on the suffix avoids
     * hardcoding a node id.
     */
    const val SNAPSHOT_PATH_SUFFIX = WearBridge.SNAPSHOT_PATH

    /** Prefix for the per-agent transcript directory, minus the node id. */
    const val TRANSCRIPT_PATH_PREFIX = WearBridge.TRANSCRIPT_PATH_PREFIX

    /**
     * Transcript paths end in an agent id, so they can only be matched by looking
     * for the directory inside the URI rather than by suffix. The trailing slash
     * keeps `/paseo/transcripts-v2` (or any other future sibling) from matching.
     */
    const val TRANSCRIPT_PATH_MARKER = "$TRANSCRIPT_PATH_PREFIX/"
  }
}

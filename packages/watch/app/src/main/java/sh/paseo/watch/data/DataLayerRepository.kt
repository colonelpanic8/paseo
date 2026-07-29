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

  private val link = MutableStateFlow(LinkState.Waiting)
  val linkState: StateFlow<LinkState> = link.asStateFlow()

  private val lastError = MutableStateFlow<String?>(null)
  val error: StateFlow<String?> = lastError.asStateFlow()

  fun start() {
    dataClient.addListener(this, android.net.Uri.parse("wear://*$SNAPSHOT_PATH_SUFFIX"), DataClient.FILTER_PREFIX)
    // Read whatever is already cached before asking for anything new: this is what
    // makes the list appear instantly on launch instead of after a round trip.
    scope.launch { loadCachedSnapshot() }
    scope.launch { requestRefresh() }
  }

  fun stop() {
    dataClient.removeListener(this)
  }

  override fun onDataChanged(events: DataEventBuffer) {
    for (event in events) {
      if (event.type != DataEvent.TYPE_CHANGED) continue
      if (!event.dataItem.uri.path.orEmpty().endsWith(SNAPSHOT_PATH_SUFFIX)) continue
      val raw = DataMapItem.fromDataItem(event.dataItem).dataMap.getString(WearBridge.SNAPSHOT_KEY)
      applySnapshot(raw)
    }
    events.release()
  }

  private suspend fun loadCachedSnapshot() {
    val items =
      runCatching { dataClient.dataItems.await() }
        .onFailure { Log.w(TAG, "Failed to read cached snapshot", it) }
        .getOrNull() ?: return
    try {
      val item = items.firstOrNull { it.uri.path.orEmpty().endsWith(SNAPSHOT_PATH_SUFFIX) }
      if (item != null) {
        applySnapshot(DataMapItem.fromDataItem(item).dataMap.getString(WearBridge.SNAPSHOT_KEY))
      }
    } finally {
      items.release()
    }
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
    state.value = snapshot.toWorkspaces()
    link.value = LinkState.Linked
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
    const val SNAPSHOT_PATH_SUFFIX = "/paseo/snapshot"
  }
}

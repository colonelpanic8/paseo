package expo.modules.wearbridge

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.DataClient
import com.google.android.gms.wearable.PutDataMapRequest
import com.google.android.gms.wearable.Wearable
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition
import kotlinx.coroutines.tasks.await

private const val TAG = "ExpoWearBridge"

/**
 * Bridges the Wearable Data Layer to JS.
 *
 * The phone app owns the daemon connection; this module is only a transport. It
 * publishes snapshots the watch renders, and forwards commands the watch sends.
 *
 * The JS side is packages/app/src/wear/. The wire format is defined in
 * packages/app/src/wear/wear-protocol.ts and mirrored in the watch app's
 * data/WearBridge.kt.
 *
 * Every Play Services call here returns a Task, awaited with
 * kotlinx-coroutines-play-services, which needs a suspend context. That is what
 * `AsyncFunction(name).SuspendBody { }` provides; the plain
 * `AsyncFunction(name) { }` overload takes a non-suspend lambda and `await()`
 * will not compile inside it.
 *
 * The explicit type arguments on each SuspendBody are load-bearing. Its zero-arg
 * and one-arg overloads are otherwise ambiguous, because the return type alone
 * cannot tell them apart when the lambda declares no parameter list.
 */
class ExpoWearBridgeModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("ExpoWearBridge")

    Events(EVENT_COMMAND)

    OnCreate {
      // Commands can arrive while the app process is dead: Play Services starts
      // PaseoWearListenerService on its own. Anything that arrived before JS was
      // listening sits in CommandQueue, so drain it as soon as we're wired up.
      WearCommandBus.setListener { payload ->
        runCatching { sendEvent(EVENT_COMMAND, mapOf("payload" to payload)) }
          .onFailure { Log.w(TAG, "Failed to emit wear command", it) }
      }
    }

    OnDestroy { WearCommandBus.setListener(null) }

    /**
     * True when this device can talk to a watch at all. False on devices without
     * Play Services, which is also the F-Droid case.
     */
    AsyncFunction("isAvailable").SuspendBody<Boolean> {
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        runCatching {
          Wearable.getNodeClient(context).connectedNodes.await()
          true
        }.getOrDefault(false)
      }
    }

    /** Node ids of currently connected watches. Empty means "no watch in range". */
    AsyncFunction("getConnectedNodes").SuspendBody<List<Map<String, String>>> {
      val context = appContext.reactContext
      if (context == null) {
        emptyList()
      } else {
        runCatching {
          Wearable.getNodeClient(context)
            .connectedNodes
            .await()
            .map { mapOf("id" to it.id, "name" to it.displayName) }
        }.getOrDefault(emptyList())
      }
    }

    /**
     * Publish the snapshot as a DataItem. DataClient dedupes identical payloads, so
     * republishing unchanged JSON is cheap — but the JS side still diffs before
     * calling, because building the JSON is the expensive part.
     */
    AsyncFunction("publishSnapshot").SuspendBody<Boolean, String> { payload ->
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        runCatching { putSnapshot(context, payload) }
          .onFailure { Log.w(TAG, "publishSnapshot failed", it) }
          .getOrDefault(false)
      }
    }

    /**
     * Publish one agent's transcript, on the watch's request.
     *
     * Each agent gets its own path so opening a second agent doesn't overwrite the
     * first, and so the watch can observe just the one it is showing.
     */
    AsyncFunction("publishTranscript").SuspendBody<Boolean, String, String> { agentId, payload ->
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        runCatching { putTranscript(context, agentId, payload) }
          .onFailure { Log.w(TAG, "publishTranscript failed", it) }
          .getOrDefault(false)
      }
    }

    /**
     * Remove everything we published — used on sign-out so a stale list or
     * conversation can't linger on the wrist.
     */
    AsyncFunction("clearSnapshot").SuspendBody<Boolean> {
      val context = appContext.reactContext
      if (context == null) {
        false
      } else {
        runCatching { deleteSnapshot(context) }
          .onFailure { Log.w(TAG, "clearSnapshot failed", it) }
          .getOrDefault(false)
      }
    }

    /** Drain commands that arrived while JS wasn't listening. */
    AsyncFunction("drainPendingCommands").SuspendBody<List<String>> {
      val context = appContext.reactContext
      if (context == null) emptyList() else CommandQueue.drain(context)
    }
  }

  private suspend fun putSnapshot(context: Context, payload: String): Boolean {
    val request =
      PutDataMapRequest.create(SNAPSHOT_PATH).apply {
        dataMap.putString(SNAPSHOT_KEY, payload)
        // DataClient drops a put whose contents are byte-identical to the current
        // item. A monotonic stamp guarantees the watch sees every publish we
        // actually meant to make.
        dataMap.putLong("stamp", System.currentTimeMillis())
      }
    Wearable.getDataClient(context)
      .putDataItem(request.asPutDataRequest().setUrgent())
      .await()
    return true
  }

  private suspend fun putTranscript(context: Context, agentId: String, payload: String): Boolean {
    val request =
      PutDataMapRequest.create("$TRANSCRIPT_PATH_PREFIX/$agentId").apply {
        dataMap.putString(SNAPSHOT_KEY, payload)
        // Same reason as putSnapshot: DataClient drops a byte-identical put, and
        // re-requesting an unchanged transcript must still reach the watch.
        dataMap.putLong("stamp", System.currentTimeMillis())
      }
    Wearable.getDataClient(context)
      .putDataItem(request.asPutDataRequest().setUrgent())
      .await()
    return true
  }

  private suspend fun deleteSnapshot(context: Context): Boolean {
    val local = Wearable.getNodeClient(context).localNode.await()
    val dataClient = Wearable.getDataClient(context)
    dataClient.deleteDataItems(android.net.Uri.parse("wear://${local.id}$SNAPSHOT_PATH")).await()
    // Transcripts are one DataItem per agent, so there is no single path to delete;
    // a prefix filter clears however many the user happened to open. The trailing
    // slash keeps the prefix from also matching a future sibling path such as
    // /paseo/transcript-settings.
    dataClient
      .deleteDataItems(
        android.net.Uri.parse("wear://${local.id}$TRANSCRIPT_PATH_PREFIX/"),
        DataClient.FILTER_PREFIX,
      )
      .await()
    return true
  }

  companion object {
    const val EVENT_COMMAND = "onWearCommand"
    const val SNAPSHOT_PATH = "/paseo/snapshot"
    const val TRANSCRIPT_PATH_PREFIX = "/paseo/transcript"
    const val SNAPSHOT_KEY = "payload"
  }
}

package expo.modules.wearbridge

import android.util.Log
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
    AsyncFunction("isAvailable") Coroutine@{ ->
      return@Coroutine runCatching {
        Wearable.getNodeClient(appContext.reactContext!!).connectedNodes.await()
        true
      }.getOrDefault(false)
    }

    /** Node ids of currently connected watches. Empty means "no watch in range". */
    AsyncFunction("getConnectedNodes") Coroutine@{ ->
      return@Coroutine runCatching {
        Wearable.getNodeClient(appContext.reactContext!!)
          .connectedNodes
          .await()
          .map { mapOf("id" to it.id, "name" to it.displayName) }
      }.getOrDefault(emptyList())
    }

    /**
     * Publish the snapshot as a DataItem. DataClient dedupes identical payloads, so
     * republishing unchanged JSON is cheap — but the JS side still diffs before
     * calling, because building the JSON is the expensive part.
     */
    AsyncFunction("publishSnapshot") Coroutine@{ payload: String ->
      val context = appContext.reactContext ?: return@Coroutine false
      return@Coroutine runCatching {
        val request =
          PutDataMapRequest.create(SNAPSHOT_PATH).apply {
            dataMap.putString(SNAPSHOT_KEY, payload)
            // DataClient drops a put whose contents are byte-identical to the
            // current item. A monotonic stamp guarantees the watch sees every
            // publish we actually meant to make.
            dataMap.putLong("stamp", System.currentTimeMillis())
          }
        Wearable.getDataClient(context).putDataItem(request.asPutDataRequest().setUrgent()).await()
        true
      }.onFailure { Log.w(TAG, "publishSnapshot failed", it) }.getOrDefault(false)
    }

    /** Remove the snapshot — used on sign-out so a stale list can't linger on the wrist. */
    AsyncFunction("clearSnapshot") Coroutine@{ ->
      val context = appContext.reactContext ?: return@Coroutine false
      return@Coroutine runCatching {
        val nodes = Wearable.getNodeClient(context).connectedNodes.await()
        val local = Wearable.getNodeClient(context).localNode.await()
        val uri = android.net.Uri.parse("wear://${local.id}$SNAPSHOT_PATH")
        Wearable.getDataClient(context).deleteDataItems(uri).await()
        nodes.isNotEmpty()
      }.onFailure { Log.w(TAG, "clearSnapshot failed", it) }.getOrDefault(false)
    }

    /** Drain commands that arrived while JS wasn't listening. */
    AsyncFunction("drainPendingCommands") Coroutine@{ ->
      val context = appContext.reactContext ?: return@Coroutine emptyList<String>()
      return@Coroutine CommandQueue.drain(context)
    }
  }

  companion object {
    const val EVENT_COMMAND = "onWearCommand"
    const val SNAPSHOT_PATH = "/paseo/snapshot"
    const val SNAPSHOT_KEY = "payload"
  }
}

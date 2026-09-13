package expo.modules.wearbridge

import android.content.Context
import android.util.Log
import com.google.android.gms.wearable.MessageEvent
import com.google.android.gms.wearable.WearableListenerService
import java.io.File
import org.json.JSONObject

private const val TAG = "ExpoWearBridge"
private const val START_LIVE_VOICE_KIND = "startLiveVoice"
private const val START_LIVE_VOICE_QUEUE_TTL_MS = 60_000L

/**
 * Receives watch -> phone messages.
 *
 * Play Services starts this service even when the app process is dead, which is the
 * whole reason it exists. But a dead process means there is no JS runtime to hand
 * the command to, and spinning up React Native headlessly just to deliver one
 * message is slow and unreliable.
 *
 * So: if JS is listening, deliver immediately. If not, persist to [CommandQueue] and
 * let the app drain it on next start. Most commands remain queued indefinitely, but
 * a Live Voice start expires before it can surprise-start the microphone later.
 */
class PaseoWearListenerService : WearableListenerService() {
  override fun onMessageReceived(event: MessageEvent) {
    when (event.path) {
      COMMAND_PATH -> {
        val payload = String(event.data)
        if (PocketStartCommandStore.stage(applicationContext, payload)) {
          Log.i(TAG, "Staged watch-initiated Live Voice pocket start")
          return
        }
        if (!WearCommandBus.deliver(payload)) {
          Log.i(TAG, "No JS listener; queueing wear command")
          CommandQueue.add(applicationContext, payload)
        }
      }
      REFRESH_PATH -> {
        // The watch is asking for a fresh snapshot. If JS is up it can answer; if
        // not, the app republishes on next start anyway, so there's nothing to queue.
        WearCommandBus.deliver(REFRESH_SENTINEL)
      }
      else -> Log.d(TAG, "Ignoring message on ${event.path}")
    }
  }

  companion object {
    const val COMMAND_PATH = "/paseo/command"
    const val REFRESH_PATH = "/paseo/refresh"

    /** Sentinel the JS side recognises as "republish now". */
    const val REFRESH_SENTINEL = "{\"kind\":\"refresh\"}"
  }
}

/**
 * Single hop between the listener service and the JS module.
 *
 * Both live in the same process when the app is alive, so a plain object reference
 * is enough; no IPC, no broadcast.
 */
object WearCommandBus {
  private var listener: ((String) -> Unit)? = null

  @Synchronized
  fun setListener(next: ((String) -> Unit)?) {
    listener = next
  }

  /** Returns false when nothing is listening, so the caller can persist instead. */
  @Synchronized
  fun deliver(payload: String): Boolean {
    val target = listener ?: return false
    target(payload)
    return true
  }
}

/**
 * Disk-backed queue for commands that arrived with no JS runtime.
 *
 * One JSON object per line. Capped, and the cap drops the OLDEST entries: if a
 * backlog builds up, the most recent instruction is the one worth keeping.
 */
object CommandQueue {
  private const val FILE_NAME = "paseo-wear-commands.jsonl"
  private const val MAX_ENTRIES = 32

  private fun file(context: Context) = File(context.filesDir, FILE_NAME)

  @Synchronized
  fun add(context: Context, payload: String) {
    runCatching {
      val target = file(context)
      val existing = if (target.exists()) target.readLines() else emptyList()
      val queued = encodeQueuedCommand(payload, System.currentTimeMillis())
      val next = (existing + queued).takeLast(MAX_ENTRIES)
      target.writeText(next.joinToString("\n"))
    }.onFailure { Log.w(TAG, "Failed to queue wear command", it) }
  }

  @Synchronized
  fun drain(context: Context): List<String> {
    val target = file(context)
    if (!target.exists()) return emptyList()
    return runCatching {
      val lines = target.readLines().filter { it.isNotBlank() }
      val nowMs = System.currentTimeMillis()
      target.delete()
      drainQueuedCommands(lines, nowMs) { queuedAtMs ->
        val detail =
          queuedAtMs?.let { " after ${nowMs - it}ms" }
            ?: " with no queue timestamp"
        Log.i(TAG, "Discarding expired startLiveVoice command$detail")
      }
    }.onFailure { Log.w(TAG, "Failed to drain wear commands", it) }.getOrDefault(emptyList())
  }
}

internal fun encodeQueuedCommand(payload: String, queuedAtMs: Long): String =
  JSONObject()
    .put("queuedAtMs", queuedAtMs)
    .put("payload", payload.replace("\n", " "))
    .toString()

/** Decode the mixed legacy/enveloped queue and remove unsafe delayed call starts. */
internal fun drainQueuedCommands(
  lines: List<String>,
  nowMs: Long,
  onExpiredStart: (Long?) -> Unit = {},
): List<String> =
  lines.mapNotNull { line ->
    val entry = decodeQueuedCommand(line)
    if (!entry.payload.isStartLiveVoice()) return@mapNotNull entry.payload

    val ageMs = entry.queuedAtMs?.let { nowMs - it }
    if (ageMs != null && ageMs in 0..START_LIVE_VOICE_QUEUE_TTL_MS) {
      entry.payload
    } else {
      onExpiredStart(entry.queuedAtMs)
      null
    }
  }

private data class QueuedCommand(val payload: String, val queuedAtMs: Long?)

private fun decodeQueuedCommand(line: String): QueuedCommand {
  val envelope = runCatching { JSONObject(line) }.getOrNull()
  val payload = envelope?.opt("payload") as? String
  val queuedAtMs = runCatching { envelope?.getLong("queuedAtMs") }.getOrNull()
  return if (payload != null && queuedAtMs != null) {
    QueuedCommand(payload, queuedAtMs)
  } else {
    QueuedCommand(line, null)
  }
}

private fun String.isStartLiveVoice(): Boolean =
  runCatching { JSONObject(this).optString("kind") == START_LIVE_VOICE_KIND }.getOrDefault(false)

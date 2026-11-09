package expo.modules.wearbridge

import android.app.Activity
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.os.Build
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.util.Log
import org.json.JSONObject

private const val POCKET_START_PREFERENCES = "paseo-wear-pocket-start"
private const val PAYLOAD_PREFIX = "payload:"
private const val CREATED_PREFIX = "created:"
private const val MAX_PENDING_STARTS = 8
private const val REQUEST_TTL_MS = 30_000L
private const val ACTIVITY_TIMEOUT_MS = 15_000L
private const val POCKET_START_TAG = "WearPocketStart"

internal fun pocketStartRequestId(payload: String): String? = runCatching {
  val command = JSONObject(payload)
  if (command.optString("kind") != "startLiveVoice") return@runCatching null
  command.optString("pocketStartRequestId").takeIf(::isValidPocketStartRequestId)
}.getOrNull()

private fun isValidPocketStartRequestId(value: String): Boolean =
  value.length in 16..80 && value.all { it.isLetterOrDigit() || it == '-' || it == '_' }

/** A short-lived command staged by the authenticated Wearable Data Layer. */
internal object PocketStartCommandStore {
  fun stage(context: Context, payload: String): Boolean {
    val requestId = pocketStartRequestId(payload) ?: return false
    val preferences = context.getSharedPreferences(POCKET_START_PREFERENCES, Context.MODE_PRIVATE)
    val now = System.currentTimeMillis()
    val pendingIds = preferences.all.keys
      .filter { it.startsWith(CREATED_PREFIX) }
      .map { it.removePrefix(CREATED_PREFIX) }
      .filter { now - preferences.getLong("$CREATED_PREFIX$it", 0L) <= REQUEST_TTL_MS }
      .sortedByDescending { preferences.getLong("$CREATED_PREFIX$it", 0L) }
      .take(MAX_PENDING_STARTS - 1)
      .toSet()

    val editor = preferences.edit()
    for (key in preferences.all.keys) {
      val id = key.substringAfter(':', missingDelimiterValue = "")
      if (id.isNotEmpty() && id !in pendingIds) editor.remove(key)
    }
    editor
      .putString("$PAYLOAD_PREFIX$requestId", payload)
      .putLong("$CREATED_PREFIX$requestId", now)
      .apply()
    return true
  }

  fun consume(context: Context, requestId: String): String? {
    if (!isValidPocketStartRequestId(requestId)) return null
    val preferences = context.getSharedPreferences(POCKET_START_PREFERENCES, Context.MODE_PRIVATE)
    val payload = preferences.getString("$PAYLOAD_PREFIX$requestId", null)
    val createdAt = preferences.getLong("$CREATED_PREFIX$requestId", 0L)
    preferences.edit().remove("$PAYLOAD_PREFIX$requestId").remove("$CREATED_PREFIX$requestId").apply()
    if (payload == null || System.currentTimeMillis() - createdAt !in 0..REQUEST_TTL_MS) return null
    return payload.takeIf { pocketStartRequestId(it) == requestId }
  }
}

/**
 * Makes the phone app visible long enough to acquire its microphone FGS.
 *
 * The deep link alone is not authority to start a call: any app can resolve an
 * exported browsable activity. The matching random request must already have been
 * staged by [PaseoWearListenerService] through the signed Wearable Data Layer.
 */
class WearLiveVoicePocketStartActivity : Activity() {
  private val handler = Handler(Looper.getMainLooper())
  private var receiverRegistered = false
  private var dispatched = false

  private val startedReceiver = object : BroadcastReceiver() {
    override fun onReceive(context: Context?, intent: Intent?) {
      if (intent?.action == ACTION_BACKGROUND_CALL_STARTED) finish()
    }
  }

  private val timeout = Runnable {
    Log.w(POCKET_START_TAG, "Pocket-start trampoline timed out")
    finish()
  }

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O_MR1) {
      setShowWhenLocked(true)
      setTurnScreenOn(true)
    } else {
      @Suppress("DEPRECATION")
      window.addFlags(
        android.view.WindowManager.LayoutParams.FLAG_SHOW_WHEN_LOCKED or
          android.view.WindowManager.LayoutParams.FLAG_TURN_SCREEN_ON,
      )
    }
  }

  override fun onStart() {
    super.onStart()
    val filter = IntentFilter(ACTION_BACKGROUND_CALL_STARTED)
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
      registerReceiver(startedReceiver, filter, Context.RECEIVER_NOT_EXPORTED)
    } else {
      @Suppress("DEPRECATION")
      registerReceiver(startedReceiver, filter)
    }
    receiverRegistered = true
  }

  override fun onPostResume() {
    super.onPostResume()
    if (dispatched) return
    dispatched = true
    // Posting lets Application.ActivityLifecycleCallbacks observe RESUMED before
    // the JS command reaches the background-call module's foreground gate.
    handler.post {
      val requestId = intent?.data?.getQueryParameter(REQUEST_ID_QUERY).orEmpty()
      val payload = PocketStartCommandStore.consume(applicationContext, requestId)
      if (payload == null) {
        Log.w(POCKET_START_TAG, "Pocket-start deep link had no matching Wear command")
        finish()
        return@post
      }
      if (!WearCommandBus.deliver(payload)) {
        CommandQueue.add(applicationContext, payload)
        finish()
        return@post
      }
      handler.postDelayed(timeout, ACTIVITY_TIMEOUT_MS)
    }
  }

  override fun onStop() {
    handler.removeCallbacks(timeout)
    if (receiverRegistered) {
      unregisterReceiver(startedReceiver)
      receiverRegistered = false
    }
    super.onStop()
  }

  companion object {
    const val URI_SCHEME = "paseo-wear-live-voice"
    const val URI_HOST = "start"
    const val REQUEST_ID_QUERY = "requestId"
    // Mirrors BackgroundCallLifetime.ACTION_BACKGROUND_CALL_STARTED without a
    // package dependency between the two Expo modules.
    const val ACTION_BACKGROUND_CALL_STARTED = "sh.paseo.backgroundcall.STARTED"
  }
}

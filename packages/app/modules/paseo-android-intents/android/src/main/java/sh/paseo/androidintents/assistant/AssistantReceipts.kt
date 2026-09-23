package sh.paseo.androidintents.assistant

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/** Receipt states shared with EVA. See docs/android-intents.md for their meaning. */
object ReceiptState {
  const val ACCEPTED = "accepted"
  const val WAITING_FOR_HOST = "waiting_for_host"
  const val SUBMITTED = "submitted"
  const val COMPLETED = "completed"
  const val FAILED = "failed"
  const val UNCERTAIN = "uncertain"
  const val EXPIRED = "expired"
  const val REJECTED = "rejected"
  const val NOT_STARTED = "not_started"
  const val NEEDS_AUTHORIZATION = "needs_authorization"
  const val NEEDS_CONFIGURATION = "needs_configuration"
  const val NEEDS_HOST_UPDATE = "needs_host_update"

  // Reply-only states; never stored on a request.
  const val NEEDS_UNLOCK = "needs_unlock"
  const val REQUEST_ID_CONFLICT = "request_id_conflict"
  const val UNKNOWN_REQUEST = "unknown_request"

  val PENDING = setOf(ACCEPTED, WAITING_FOR_HOST, SUBMITTED)

  /** States that assert nothing reached the daemon. */
  val UNDISPATCHED = setOf(EXPIRED, REJECTED, NOT_STARTED, NEEDS_AUTHORIZATION, NEEDS_CONFIGURATION, NEEDS_HOST_UPDATE)

  val STORED = PENDING + setOf(COMPLETED, FAILED, UNCERTAIN) + UNDISPATCHED
}

private const val PENDING_EXPIRY_MS = 10 * 60 * 1000L
private const val SUBMITTED_EXPIRY_MS = 24 * 60 * 60 * 1000L

data class AssistantRequestEntry(
  val key: String,
  val callerUid: Int,
  val invocationId: String,
  val operation: AssistantOperation,
  val fingerprint: String,
  val arguments: Map<String, Any?>,
  val createdAtMs: Long,
  val updatedAtMs: Long,
  val revision: Long,
  val state: String,
  /** Set before the first network send; after it, "nothing happened" can no longer be claimed. */
  val dispatchStarted: Boolean,
  /** The exact daemon request, fixed once so every replay carries the same fingerprint. */
  val plan: Map<String, Any?>?,
  val serverId: String,
  val workspaceId: String?,
  val agentId: String?,
  val errorCode: String?,
  val errorMessage: String?,
) {
  val isPending: Boolean
    get() = state in ReceiptState.PENDING

  fun receipt(): Map<String, Any?> =
    linkedMapOf<String, Any?>(
      "version" to 1L,
      "invocationId" to invocationId,
      "operation" to operation.wire,
      "state" to state,
      "serverId" to serverId,
    ).apply {
      if (workspaceId != null) put("workspaceId", workspaceId)
      if (agentId != null) put("agentId", agentId)
      if (errorCode != null || errorMessage != null) {
        put("error", linkedMapOf("code" to (errorCode ?: "error"), "message" to (errorMessage ?: "")))
      }
      put("updatedAt", isoTimestamp(updatedAtMs))
      put("pollable", isPending)
    }

  fun toJson(): Map<String, Any?> =
    linkedMapOf(
      "version" to 1L,
      "key" to key,
      "callerUid" to callerUid.toLong(),
      "invocationId" to invocationId,
      "operation" to operation.wire,
      "fingerprint" to fingerprint,
      "arguments" to arguments,
      "createdAtMs" to createdAtMs,
      "updatedAtMs" to updatedAtMs,
      "revision" to revision,
      "state" to state,
      "dispatchStarted" to dispatchStarted,
      "plan" to plan,
      "serverId" to serverId,
      "workspaceId" to workspaceId,
      "agentId" to agentId,
      "errorCode" to errorCode,
      "errorMessage" to errorMessage,
    )

  companion object {
    @Suppress("UNCHECKED_CAST")
    fun fromJson(json: Map<String, Any?>): AssistantRequestEntry =
      AssistantRequestEntry(
        key = json["key"] as String,
        callerUid = (json["callerUid"] as Long).toInt(),
        invocationId = json["invocationId"] as String,
        operation = AssistantOperation.fromWire(json["operation"] as String) ?: error("Unknown operation"),
        fingerprint = json["fingerprint"] as String,
        arguments = json["arguments"] as Map<String, Any?>,
        createdAtMs = json["createdAtMs"] as Long,
        updatedAtMs = json["updatedAtMs"] as Long,
        revision = json["revision"] as Long,
        state = (json["state"] as String).also { require(it in ReceiptState.STORED) { "Unknown state" } },
        dispatchStarted = json["dispatchStarted"] as Boolean,
        plan = json["plan"] as Map<String, Any?>?,
        serverId = json["serverId"] as String,
        workspaceId = json["workspaceId"] as String?,
        agentId = json["agentId"] as String?,
        errorCode = json["errorCode"] as String?,
        errorMessage = json["errorMessage"] as String?,
      )
  }
}

// java.time needs API 26; the app still supports older devices.
fun isoTimestamp(ms: Long): String =
  SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US)
    .apply { timeZone = TimeZone.getTimeZone("UTC") }
    .format(Date(ms))

/** A progress report from the executor. Absent fields leave the entry unchanged. */
data class ReceiptUpdate(
  val state: String? = null,
  val dispatchStarted: Boolean = false,
  val plan: Map<String, Any?>? = null,
  val workspaceId: String? = null,
  val agentId: String? = null,
  val errorCode: String? = null,
  val errorMessage: String? = null,
) {
  companion object {
    @Suppress("UNCHECKED_CAST")
    fun fromJson(json: Map<String, Any?>): ReceiptUpdate {
      val error = json["error"] as Map<String, Any?>?
      return ReceiptUpdate(
        state = json["state"] as String?,
        dispatchStarted = json["dispatchStarted"] as Boolean? ?: false,
        plan = json["plan"] as Map<String, Any?>?,
        workspaceId = json["workspaceId"] as String?,
        agentId = json["agentId"] as String?,
        errorCode = error?.get("code") as String?,
        errorMessage = error?.get("message") as String?,
      )
    }
  }
}

/**
 * The only way a request's state changes. Terminal states are final, a
 * submitted request never regresses, and once dispatch started an executor
 * cannot claim that nothing reached the daemon.
 */
object ReceiptRules {
  fun apply(entry: AssistantRequestEntry, update: ReceiptUpdate, nowMs: Long): AssistantRequestEntry {
    if (!entry.isPending) return entry
    val plan = entry.plan ?: update.plan
    val dispatchStarted = entry.dispatchStarted || (update.dispatchStarted && plan != null)
    var state = update.state ?: entry.state
    require(state in ReceiptState.STORED) { "Unknown state $state" }
    if (entry.state == ReceiptState.SUBMITTED && state in setOf(ReceiptState.ACCEPTED, ReceiptState.WAITING_FOR_HOST)) {
      state = ReceiptState.SUBMITTED
    }
    // An error describes the state it arrived with; moving on clears it.
    val stateChanged = state != entry.state
    var errorCode = if (stateChanged) update.errorCode else update.errorCode ?: entry.errorCode
    var errorMessage = if (stateChanged) update.errorMessage else update.errorMessage ?: entry.errorMessage
    if (dispatchStarted && state in ReceiptState.UNDISPATCHED) {
      state = ReceiptState.UNCERTAIN
      errorCode = "outcome_unknown"
      errorMessage = "Paseo sent the request but could not confirm whether the host acted on it."
    }
    return entry.copy(
      state = state,
      dispatchStarted = dispatchStarted,
      plan = plan,
      workspaceId = entry.workspaceId ?: update.workspaceId,
      agentId = entry.agentId ?: update.agentId,
      errorCode = errorCode,
      errorMessage = errorMessage,
      updatedAtMs = nowMs,
      revision = entry.revision + 1,
    )
  }

  /** A pending request that sat too long is closed rather than run late. */
  fun expire(entry: AssistantRequestEntry, nowMs: Long): AssistantRequestEntry? {
    val age = nowMs - entry.createdAtMs
    return when {
      entry.state == ReceiptState.SUBMITTED && age > SUBMITTED_EXPIRY_MS ->
        close(entry, nowMs, ReceiptState.UNCERTAIN, "expired", "The host accepted this request but Paseo lost track of it.")
      entry.state in setOf(ReceiptState.ACCEPTED, ReceiptState.WAITING_FOR_HOST) && age > PENDING_EXPIRY_MS ->
        if (entry.dispatchStarted) {
          close(entry, nowMs, ReceiptState.UNCERTAIN, "expired", "Paseo sent this request but the host never confirmed it.")
        } else {
          close(entry, nowMs, ReceiptState.EXPIRED, "expired", "Paseo could not reach the host in time, so it did not send this request.")
        }
      else -> null
    }
  }

  fun close(entry: AssistantRequestEntry, nowMs: Long, state: String, code: String, message: String): AssistantRequestEntry =
    apply(entry, ReceiptUpdate(state = state, errorCode = code, errorMessage = message), nowMs)
}

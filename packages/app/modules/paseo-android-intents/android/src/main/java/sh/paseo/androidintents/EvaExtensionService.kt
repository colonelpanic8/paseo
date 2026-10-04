package sh.paseo.androidintents

import android.app.Service
import android.content.Intent
import android.os.Binder
import android.os.IBinder
import android.os.RemoteException
import android.os.SystemClock
import android.os.UserManager
import android.util.Log
import com.colonelpanic.eva.extension.IEvaExtension
import com.colonelpanic.eva.extension.IEvaExtensionCallback
import sh.paseo.androidintents.assistant.Admission
import sh.paseo.androidintents.assistant.AssistantCapabilities
import sh.paseo.androidintents.assistant.AssistantOperation
import sh.paseo.androidintents.assistant.AssistantRequestEntry
import sh.paseo.androidintents.assistant.EvaProtocol
import sh.paseo.androidintents.assistant.InvalidArgumentsException
import sh.paseo.androidintents.assistant.ReceiptState
import sh.paseo.androidintents.assistant.ReceiptUpdate
import sh.paseo.androidintents.assistant.StrictJson
import sh.paseo.androidintents.assistant.StrictJsonException
import java.util.concurrent.ArrayBlockingQueue
import java.util.concurrent.RejectedExecutionException
import java.util.concurrent.ThreadPoolExecutor
import java.util.concurrent.TimeUnit

private const val TAG = "PaseoEvaExtension"
private const val MAX_ARGUMENT_BYTES = 16_384
private const val REPLY_MARGIN_MS = 1_500L
private const val MIN_BUDGET_MS = 500L
private typealias Failure = (status: String, reasonCode: String?, message: String) -> String

private val INVOCATION_ID = Regex("[\\x21-\\x7e]{1,256}")

/**
 * EVA installed-app extension (AIDL protocol v1). Authenticates on the binder
 * thread, then journals the request before any work so a lost reply, process
 * death, or status poll never runs it twice. Describe, validation and status
 * are native; running a request starts the headless JavaScript executor.
 */
class EvaExtensionService : Service() {
  private val workers =
    ThreadPoolExecutor(4, 4, 30, TimeUnit.SECONDS, ArrayBlockingQueue(8)).apply { allowCoreThreadTimeOut(true) }

  private val binder =
    object : IEvaExtension.Stub() {
      override fun describe(
        requestId: String,
        requestJson: String,
        deadlineElapsedRealtimeMillis: Long,
        callback: IEvaExtensionCallback,
      ) {
        if (!authorized()) {
          reply(callback, requestId, unauthorized(EvaProtocol::describeFailure))
          return
        }
        submit(callback, requestId, EvaProtocol::describeFailure, failureStatus = "failed") {
          if (!EvaProtocol.supportsDescribeRequest(requestJson)) {
            EvaProtocol.describeFailure("not_executed", "not_configured", "Paseo only speaks EVA extension protocol version 1.")
          } else {
            EvaProtocol.describeReply()
          }
        }
      }

      override fun execute(
        invocationId: String,
        expectedRevision: String,
        capability: String,
        argumentsJson: String,
        deadlineElapsedRealtimeMillis: Long,
        callback: IEvaExtensionCallback,
      ) {
        val uid = Binder.getCallingUid()
        if (!authorized()) {
          reply(callback, invocationId, unauthorized(::executeFailure))
          return
        }
        // After journaling, an internal error cannot prove nothing ran.
        submit(callback, invocationId, ::executeFailure, failureStatus = "unknown") {
          execute(uid, invocationId, expectedRevision, capability, argumentsJson, deadlineElapsedRealtimeMillis)
        }
      }
    }

  override fun onBind(intent: Intent?): IBinder = binder

  override fun onDestroy() {
    workers.shutdown()
    super.onDestroy()
  }

  private fun authorized(): Boolean = AssistantCallerPolicy.isAuthorizedUid(this, Binder.getCallingUid())

  private fun executeFailure(status: String, reasonCode: String?, message: String): String =
    EvaProtocol.failure(status, reasonCode, message)

  private fun unauthorized(failure: Failure): String =
    failure("not_executed", "unauthorized_caller", "This app may not use Paseo's assistant actions.")

  private fun submit(
    callback: IEvaExtensionCallback,
    requestId: String,
    failure: Failure,
    failureStatus: String,
    work: () -> String,
  ) {
    try {
      workers.execute {
        val response =
          try {
            work()
          } catch (error: Exception) {
            Log.w(TAG, "Extension request failed", error)
            failure(failureStatus, null, "Paseo hit an internal error handling this request.")
          }
        reply(callback, requestId, response)
      }
    } catch (_: RejectedExecutionException) {
      reply(callback, requestId, failure("not_executed", "busy", "Paseo is handling too many assistant requests."))
    }
  }

  private fun reply(callback: IEvaExtensionCallback, requestId: String, response: String) {
    try {
      callback.onResult(requestId, response)
    } catch (_: RemoteException) {
      // EVA is gone; the journal still holds the outcome for request_status.
    }
  }

  private fun execute(
    uid: Int,
    invocationId: String,
    expectedRevision: String,
    capabilityName: String,
    argumentsJson: String,
    deadline: Long,
  ): String {
    val capability =
      AssistantCapabilities.byName(capabilityName)
        ?: return EvaProtocol.failure("not_executed", "invalid_arguments", "Paseo has no action named $capabilityName.")
    val startedAt = SystemClock.elapsedRealtime()
    val replyAt = minOf(deadline, startedAt + capability.maxWaitMillis) - REPLY_MARGIN_MS
    if (replyAt - startedAt < MIN_BUDGET_MS) {
      return EvaProtocol.failure("not_executed", "deadline_exceeded", "The request arrived too late to run.")
    }
    if (!INVOCATION_ID.matches(invocationId)) {
      return EvaProtocol.failure("not_executed", "invalid_arguments", "The invocation ID is not 1 to 256 printable ASCII characters.")
    }
    if (expectedRevision != EvaProtocol.descriptorRevision) {
      return EvaProtocol.failure("not_executed", "stale_descriptor", "Paseo's actions changed; refresh them and try again.")
    }
    val arguments =
      try {
        if (StrictJson.utf8Size(argumentsJson) > MAX_ARGUMENT_BYTES) throw InvalidArgumentsException("Arguments are too large")
        capability.validate(StrictJson.parseObject(argumentsJson)).also {
          if (capability === AssistantCapabilities.createAgent) AssistantCapabilities.checkCreateAgentCombination(it)
        }
      } catch (error: IllegalArgumentException) {
        val message = if (error is StrictJsonException) "Arguments are not valid JSON." else error.message ?: "Invalid arguments."
        val receipt =
          linkedMapOf<String, Any?>(
            "version" to 1L,
            "invocationId" to invocationId,
            "state" to ReceiptState.REJECTED,
            "error" to linkedMapOf("code" to "invalid_arguments", "message" to message),
            "pollable" to false,
          )
        return EvaProtocol.failure("not_executed", "invalid_arguments", message, receipt)
      }
    val operation = AssistantOperation.fromWire(capability.name)
    val placeholder = placeholderReceipt(invocationId, operation, arguments)
    val userManager = getSystemService(UserManager::class.java)
    if (userManager != null && !userManager.isUserUnlocked) {
      return EvaProtocol.executeReply(placeholder + ("state" to ReceiptState.NEEDS_UNLOCK))
    }
    val journal = AssistantJobs.journal(this)

    if (operation == null) {
      val entry =
        journal.find(uid, arguments["invocationId"] as String)
          ?: return EvaProtocol.executeReply(placeholder + ("state" to ReceiptState.UNKNOWN_REQUEST))
      return EvaProtocol.statusReply(logged("status", advance(entry, replyAt)).receipt())
    }

    if (!AssistantJobs.isUnattendedAllowed(this)) {
      return EvaProtocol.executeReply(placeholder + ("state" to ReceiptState.NEEDS_AUTHORIZATION))
    }
    val entry =
      when (val admission = journal.admit(uid, invocationId, operation, arguments)) {
        is Admission.Conflict -> return EvaProtocol.executeReply(placeholder + ("state" to ReceiptState.REQUEST_ID_CONFLICT))
        is Admission.Created -> admission.entry
        is Admission.Existing -> admission.entry
      }
    return EvaProtocol.executeReply(logged(operation.wire, advance(entry, replyAt)).receipt())
  }

  // State and error code only: never arguments, prompts or host details.
  private fun logged(action: String, entry: AssistantRequestEntry): AssistantRequestEntry {
    Log.i(TAG, "$action ${entry.operation.wire} state=${entry.state} code=${entry.errorCode ?: "none"}")
    return entry
  }

  /**
   * Resumes a pending request if nothing is working on it, then waits for it
   * to settle or for the reply time. Authorization is rechecked on every
   * resume because the user may have revoked it since the request was saved.
   */
  private fun advance(initial: AssistantRequestEntry, replyAt: Long): AssistantRequestEntry {
    val journal = AssistantJobs.journal(this)
    var entry = journal.expireIfOverdue(initial.key) ?: return initial
    if (!entry.isPending) return entry
    if (!AssistantJobs.isUnattendedAllowed(this)) {
      return journal.update(
        entry.key,
        ReceiptUpdate(
          state = ReceiptState.NEEDS_AUTHORIZATION,
          errorCode = "unattended_disabled",
          errorMessage = "EVA's permission to run agents was turned off in Paseo.",
        ),
      ) ?: entry
    }
    AssistantJobs.ensureRunning(this, entry)
    while (true) {
      entry = journal.get(entry.key) ?: return entry
      val remaining = replyAt - SystemClock.elapsedRealtime()
      if (!entry.isPending || remaining <= 0) return entry
      entry = journal.awaitChange(entry.key, entry.revision, System.currentTimeMillis() + remaining) ?: return entry
    }
  }

  private fun placeholderReceipt(
    invocationId: String,
    operation: AssistantOperation?,
    arguments: Map<String, Any?>,
  ): Map<String, Any?> =
    linkedMapOf<String, Any?>(
      "version" to 1L,
      "invocationId" to (if (operation == null) arguments["invocationId"] as String else invocationId),
    ).apply {
      if (operation != null) {
        put("operation", operation.wire)
        put("serverId", arguments["serverId"])
      }
      put("pollable", false)
    }
}

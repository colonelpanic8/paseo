package sh.paseo.androidintents.assistant

const val EVA_PROTOCOL_VERSION = 1L
private const val AUTHORIZATION_SCOPE_REVISION = "paseo-paired-hosts-1"
private const val RESULT_MAX_BYTES = 16_384
private const val MAX_TEXT_CODE_POINTS = 2_000

/** EVA installed-app extension protocol v1: descriptor and reply envelopes. */
object EvaProtocol {
  private val outputSchema: Map<String, Any?> =
    linkedMapOf(
      "type" to "object",
      "properties" to linkedMapOf("state" to mapOf("type" to "string"), "invocationId" to mapOf("type" to "string")),
      "required" to listOf("state", "invocationId"),
      "additionalProperties" to true,
    )

  private val capabilities: List<Map<String, Any?>> =
    AssistantCapabilities.all.map { capability ->
      linkedMapOf(
        "tool" to
          linkedMapOf(
            "name" to capability.name,
            "title" to capability.title,
            "description" to capability.description,
            "inputSchema" to capability.inputSchema(),
            "outputSchema" to outputSchema,
            "annotations" to
              linkedMapOf(
                "readOnlyHint" to (capability.effects == "read"),
                "openWorldHint" to true,
              ),
          ),
        "effects" to capability.effects,
        "execution" to linkedMapOf("mode" to "synchronous", "requiresForeground" to false, "maxWaitMillis" to capability.maxWaitMillis),
        "result" to linkedMapOf("maxBytes" to RESULT_MAX_BYTES.toLong()),
      )
    }

  /** Changes whenever any descriptor content does, and only then. */
  val descriptorRevision: String =
    "paseo-v1." +
      AssistantJournal.sha256(StrictJson.canonical(mapOf("scope" to AUTHORIZATION_SCOPE_REVISION, "capabilities" to capabilities)))
        .take(24)

  fun describeReply(): String =
    StrictJson.stringify(
      linkedMapOf(
        "protocolVersion" to EVA_PROTOCOL_VERSION,
        "status" to "completed",
        "reasonCode" to null,
        "truncated" to false,
        "content" to emptyList<Any?>(),
        "descriptor" to
          linkedMapOf(
            "protocolVersion" to EVA_PROTOCOL_VERSION,
            "descriptorRevision" to descriptorRevision,
            "authorizationScopeRevision" to AUTHORIZATION_SCOPE_REVISION,
            "title" to "Paseo",
            "capabilities" to capabilities,
          ),
      ),
    )

  /** Accepts EVA's describe request only when it offers protocol version 1. */
  fun supportsDescribeRequest(requestJson: String): Boolean {
    val request =
      try {
        StrictJson.parseObject(requestJson)
      } catch (_: StrictJsonException) {
        return false
      }
    val versions = request["supportedProtocolVersions"] as? List<*> ?: return false
    return request["protocolVersion"] is Long && EVA_PROTOCOL_VERSION in versions
  }

  fun failure(status: String, reasonCode: String?, message: String, structured: Map<String, Any?>? = null): String =
    envelope(status, reasonCode, message, structured)

  /** A describe reply that failed still names its descriptor, as null. */
  fun describeFailure(status: String, reasonCode: String?, message: String): String =
    envelope(status, reasonCode, message, null, describe = true)

  /** Maps a request's receipt onto EVA's outcome envelope for create_agent/send_prompt. */
  fun executeReply(receipt: Map<String, Any?>): String {
    val state = receipt["state"] as String
    val (status, reason) = statusFor(state)
    return envelope(status, reason, messageFor(receipt), receipt)
  }

  /** request_status reads completed; the request's own state is in the receipt. */
  fun statusReply(receipt: Map<String, Any?>): String = envelope("completed", null, messageFor(receipt), receipt)

  fun statusFor(state: String): Pair<String, String?> =
    when (state) {
      ReceiptState.COMPLETED -> "completed" to null
      in ReceiptState.PENDING -> "handed_off" to null
      ReceiptState.UNCERTAIN -> "unknown" to null
      ReceiptState.FAILED -> "failed" to null
      ReceiptState.REJECTED, ReceiptState.REQUEST_ID_CONFLICT, ReceiptState.UNKNOWN_REQUEST -> "not_executed" to "invalid_arguments"
      ReceiptState.EXPIRED -> "not_executed" to "deadline_exceeded"
      ReceiptState.NOT_STARTED -> "not_executed" to null
      else -> "not_executed" to "not_configured"
    }

  private fun messageFor(receipt: Map<String, Any?>): String {
    val operation = if (receipt["operation"] == AssistantOperation.CREATE_AGENT.wire) "The new agent" else "The agent"
    val summary =
      when (receipt["state"]) {
        ReceiptState.COMPLETED -> "$operation received the prompt in Paseo."
        ReceiptState.ACCEPTED -> "Paseo saved the request and is sending it to the host. Check its status shortly."
        ReceiptState.WAITING_FOR_HOST -> "Paseo saved the request and is waiting for the host to come online. Check its status shortly."
        ReceiptState.SUBMITTED -> "The host accepted the request and is still starting the agent. Check its status shortly."
        ReceiptState.UNCERTAIN -> "Paseo cannot tell whether the agent received the prompt. Check in Paseo before trying again."
        ReceiptState.FAILED -> "The host could not finish the request."
        ReceiptState.EXPIRED -> "Paseo never sent the request because the host stayed unreachable."
        ReceiptState.NEEDS_AUTHORIZATION -> "Paseo does not allow EVA to run agents yet. Turn it on in Paseo settings."
        ReceiptState.NEEDS_CONFIGURATION -> "Paseo needs more setup before it can run this request."
        ReceiptState.NEEDS_HOST_UPDATE -> "The Paseo host is too old for this request. Update the host."
        ReceiptState.NEEDS_UNLOCK -> "Unlock the phone once so Paseo can read its saved hosts."
        ReceiptState.REQUEST_ID_CONFLICT -> "This request ID was already used for a different request."
        ReceiptState.UNKNOWN_REQUEST -> "Paseo has no request with that ID."
        ReceiptState.NOT_STARTED -> "Paseo could not start its background runtime."
        else -> "Paseo could not run the request."
      }
    val detail = (receipt["error"] as? Map<*, *>)?.get("message") as? String
    return if (detail.isNullOrBlank()) summary else "$summary $detail"
  }

  private fun envelope(
    status: String,
    reasonCode: String?,
    message: String,
    structured: Map<String, Any?>?,
    describe: Boolean = false,
  ): String {
    val codePoints = message.codePointCount(0, message.length)
    val truncated = codePoints > MAX_TEXT_CODE_POINTS
    val text = if (truncated) message.substring(0, message.offsetByCodePoints(0, MAX_TEXT_CODE_POINTS)) else message
    val body =
      linkedMapOf<String, Any?>(
        "protocolVersion" to EVA_PROTOCOL_VERSION,
        "status" to status,
        "reasonCode" to reasonCode,
        "truncated" to truncated,
        "content" to listOf(linkedMapOf("type" to "text", "text" to text)),
      )
    if (describe) body["descriptor"] = null
    if (structured != null) body["structuredContent"] = structured
    val json = StrictJson.stringify(body)
    check(StrictJson.utf8Size(json) <= RESULT_MAX_BYTES) { "Reply exceeds $RESULT_MAX_BYTES bytes" }
    return json
  }
}

package sh.paseo.androidintents.assistant

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertThrows
import org.junit.Assert.assertTrue
import org.junit.Test

class EvaProtocolTest {
  private val base = mapOf<String, Any?>("serverId" to "s", "projectId" to "p", "prompt" to "hi", "isolation" to "local")

  @Test
  fun strictJsonRejectsWhatOrgJsonAccepts() {
    listOf("""{"a":1,"a":2}""", "\"\\ud800\"", "1e999", "NaN", "{} {}", "{'a':1}").forEach { text ->
      assertThrows(text, IllegalArgumentException::class.java) { StrictJson.parse(text) }
    }
    assertEquals(12L, StrictJson.parse("12"))
    assertEquals("""{"a":["x"],"b":1}""", StrictJson.canonical(linkedMapOf("b" to 1L, "a" to listOf("x"))))
  }

  @Test
  fun createAgentArgumentsAreValidatedBeyondTheSchema() {
    val create = AssistantCapabilities.createAgent
    assertEquals(base, create.validate(base + ("model" to null)))
    listOf(
      base + ("extra" to "x"),
      base - "projectId",
      base + ("title" to mapOf("a" to 1)),
      base + ("prNumber" to 1.5),
      base + ("prompt" to "x".repeat(16_001)),
      base + ("worktreeSlug" to "Bad Slug"),
    ).forEach { args -> assertThrows(IllegalArgumentException::class.java) { create.validate(args) } }
    val worktree = base + ("isolation" to "worktree")
    listOf(
      base + ("baseRef" to "main"),
      worktree + ("branch" to "x"),
      worktree + ("worktreeMode" to "checkout-branch"),
      worktree + ("worktreeMode" to "checkout-pr"),
    ).forEach { args ->
      assertThrows(IllegalArgumentException::class.java) { AssistantCapabilities.checkCreateAgentCombination(args) }
    }
  }

  @Test
  fun descriptorUsesOnlyKeywordsEvaAccepts() {
    val allowed = setOf("type", "description", "enum", "minLength", "maxLength")
    val describe = EvaProtocol.describeReply()
    assertTrue(StrictJson.utf8Size(describe) <= 65_536)
    for (capability in AssistantCapabilities.all) {
      @Suppress("UNCHECKED_CAST")
      val properties = capability.inputSchema()["properties"] as Map<String, Map<String, Any?>>
      properties.forEach { (name, schema) -> assertTrue(name, allowed.containsAll(schema.keys)) }
    }
    assertTrue(EvaProtocol.supportsDescribeRequest("""{"protocolVersion":1,"supportedProtocolVersions":[1]}"""))
    assertFalse(EvaProtocol.supportsDescribeRequest("""{"protocolVersion":2,"supportedProtocolVersions":[2]}"""))
  }

  @Test
  fun describeFailuresCarryANullDescriptor() {
    val reply = StrictJson.parseObject(EvaProtocol.describeFailure("not_executed", "unauthorized_caller", "no"))
    assertTrue(reply.containsKey("descriptor") && reply["descriptor"] == null)
    assertFalse(StrictJson.parseObject(EvaProtocol.failure("not_executed", "busy", "no")).containsKey("descriptor"))
  }

  @Test
  fun receiptStatesMapToEvaEnvelopes() {
    val expected =
      mapOf(
        "completed" to ("completed" to null),
        "accepted" to ("handed_off" to null),
        "submitted" to ("handed_off" to null),
        "waiting_for_host" to ("handed_off" to null),
        "uncertain" to ("unknown" to null),
        "failed" to ("failed" to null),
        "rejected" to ("not_executed" to "invalid_arguments"),
        "request_id_conflict" to ("not_executed" to "invalid_arguments"),
        "unknown_request" to ("not_executed" to "invalid_arguments"),
        "expired" to ("not_executed" to "deadline_exceeded"),
        "not_started" to ("not_executed" to null),
        "needs_unlock" to ("not_executed" to "not_configured"),
        "needs_authorization" to ("not_executed" to "not_configured"),
        "needs_configuration" to ("not_executed" to "not_configured"),
        "needs_host_update" to ("not_executed" to "not_configured"),
      )
    expected.forEach { (state, mapping) -> assertEquals(state, mapping, EvaProtocol.statusFor(state)) }
    val status = StrictJson.parseObject(EvaProtocol.statusReply(mapOf("invocationId" to "i", "state" to "submitted")))
    assertEquals("completed", status["status"])
  }
}

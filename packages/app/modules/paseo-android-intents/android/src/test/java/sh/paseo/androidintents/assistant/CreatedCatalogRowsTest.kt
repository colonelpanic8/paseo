package sh.paseo.androidintents.assistant

import org.junit.Assert.assertEquals
import org.junit.Test

class CreatedCatalogRowsTest {
  private fun creation(key: String, updatedAtMs: Long, workspaceId: String, serverId: String = "srv") =
    AssistantRequestEntry(
      key = key,
      callerUid = 1,
      invocationId = key,
      operation = AssistantOperation.CREATE_AGENT,
      fingerprint = "f",
      arguments = emptyMap(),
      createdAtMs = updatedAtMs,
      updatedAtMs = updatedAtMs,
      revision = 1,
      state = ReceiptState.COMPLETED,
      dispatchStarted = true,
      plan = emptyMap(),
      serverId = serverId,
      serverName = "ryzen-shine",
      workspaceId = workspaceId,
      agentId = "ag-$workspaceId",
      catalog =
        mapOf(
          "workspace" to mapOf("id" to workspaceId, "serverId" to serverId, "serverName" to "ryzen-shine"),
          "agent" to mapOf("id" to "ag-$workspaceId", "serverId" to serverId, "workspaceId" to workspaceId),
        ),
      errorCode = null,
      errorMessage = null,
    )

  private fun ids(rows: List<Map<String, Any?>>) = rows.map { it["id"] }

  @Test
  fun servesCreationsTheCatalogHasNotListedNewestFirst() {
    val entries = listOf(creation("a", 100, "ws-a"), creation("b", 300, "ws-b"), creation("c", 200, "ws-c"))
    assertEquals(listOf("ws-b", "ws-c", "ws-a"), ids(CreatedCatalogRows.rows("workspaces", entries, emptySet(), null)))
    assertEquals(
      listOf("ws-b", "ws-a"),
      ids(CreatedCatalogRows.rows("workspaces", entries, setOf("srv" to "ws-c"), null)),
    )
    assertEquals(listOf("ag-ws-b", "ag-ws-c", "ag-ws-a"), ids(CreatedCatalogRows.rows("agents", entries, emptySet(), null)))
    assertEquals(emptyList<Any?>(), CreatedCatalogRows.rows("projects", entries, emptySet(), null))
  }

  @Test
  fun aCatalogCapturedAfterTheCreationWins() {
    val entries = listOf(creation("a", 100, "ws-a"), creation("b", 300, "ws-b"))
    assertEquals(listOf("ws-b"), ids(CreatedCatalogRows.rows("workspaces", entries, emptySet(), 200)))
  }

  @Test
  fun identityIncludesTheHost() {
    val entries = listOf(creation("a", 100, "ws-1", serverId = "laptop"), creation("b", 200, "ws-1", serverId = "desktop"))
    val rows = CreatedCatalogRows.rows("workspaces", entries, setOf("laptop" to "ws-1"), null)
    assertEquals(listOf("desktop"), rows.map { it["serverId"] })
  }
}

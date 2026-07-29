package sh.paseo.watch.data

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import sh.paseo.watch.model.ActivityState
import sh.paseo.watch.model.WorkspaceDestination
import sh.paseo.watch.model.destination
import sh.paseo.watch.model.sortedForWrist
import sh.paseo.watch.model.summaryLine

/**
 * The watch/phone wire contract has no generated code keeping the two halves in
 * sync, so these tests pin the exact JSON the phone is expected to produce. If
 * packages/app/src/wear/wear-protocol.ts changes shape, this is what should fail.
 */
class WearBridgeTest {

  private val phoneJson =
    """
    {
      "v": 1,
      "updatedAt": 1750000000000,
      "workspaces": [
        {
          "id": "ws-1",
          "name": "jubilant-wombat",
          "projectKey": "github.com/getpaseo/paseo",
          "projectName": "paseo",
          "serverId": "srv-1",
          "agents": [
            {
              "id": "a-1",
              "provider": "Claude",
              "state": "needsInput",
              "age": "1m",
              "summary": "Branch is ready.",
              "permission": {
                "id": "perm-1",
                "title": "Run command?",
                "detail": "git push origin jubilant-wombat"
              }
            }
          ]
        },
        {
          "id": "ws-2",
          "name": "main",
          "projectKey": "github.com/getpaseo/website",
          "projectName": "website",
          "serverId": "srv-1",
          "agents": [
            { "id": "a-2", "provider": "Claude", "state": "running", "age": "3m", "intent": "docs" },
            { "id": "a-3", "provider": "Codex", "state": "idle", "age": "2h" }
          ]
        },
        {
          "id": "ws-3",
          "name": "relay-tls",
          "projectKey": "github.com/getpaseo/paseo-relay",
          "projectName": "relay",
          "serverId": "srv-1",
          "agents": []
        }
      ]
    }
    """.trimIndent()

  @Test
  fun `decodes a phone snapshot into workspaces`() {
    val snapshot = decodeSnapshot(phoneJson)
    requireNotNull(snapshot)
    val workspaces = snapshot.toWorkspaces()

    assertEquals(3, workspaces.size)

    val first = workspaces[0]
    assertEquals("jubilant-wombat", first.name)
    assertEquals("paseo", first.projectName)
    assertEquals("srv-1", first.serverId)
    assertEquals(ActivityState.NeedsInput, first.state)

    val agent = first.agents.single()
    // serverId must propagate from workspace to agent, or commands can't be routed.
    assertEquals("srv-1", agent.serverId)
    assertEquals("perm-1", agent.pendingPermission?.id)
    assertEquals("git push origin jubilant-wombat", agent.pendingPermission?.detail)
  }

  @Test
  fun `unknown state degrades to idle rather than inventing urgency`() {
    val json = phoneJson.replace("\"needsInput\"", "\"some_future_state\"")
    val workspaces = decodeSnapshot(json)!!.toWorkspaces()
    assertEquals(ActivityState.Idle, workspaces[0].agents.single().state)
  }

  @Test
  fun `rejects a snapshot from a protocol version we do not speak`() {
    assertNull(decodeSnapshot(phoneJson.replace("\"v\": 1", "\"v\": 2")))
  }

  @Test
  fun `rejects malformed json instead of throwing`() {
    assertNull(decodeSnapshot("{ not json"))
    assertNull(decodeSnapshot(""))
  }

  @Test
  fun `tolerates unknown fields from a newer phone build`() {
    val json = phoneJson.replace("\"id\": \"ws-1\",", "\"id\": \"ws-1\", \"somethingNew\": 42,")
    assertEquals(3, decodeSnapshot(json)!!.toWorkspaces().size)
  }

  @Test
  fun `navigation rule skips the picker for single-agent workspaces`() {
    val workspaces = decodeSnapshot(phoneJson)!!.toWorkspaces()

    // Pending permission wins over everything else.
    val permission = workspaces[0].destination()
    assertTrue(permission is WorkspaceDestination.Permission)
    assertEquals("a-1", (permission as WorkspaceDestination.Permission).agentId)

    // Two agents, nothing urgent -> the picker is the only correct destination.
    assertTrue(workspaces[1].destination() is WorkspaceDestination.Picker)

    // Empty workspace -> straight to dictating a prompt.
    assertTrue(workspaces[2].destination() is WorkspaceDestination.NewAgent)
  }

  @Test
  fun `single agent workspace routes straight to the agent`() {
    val workspaces = decodeSnapshot(phoneJson)!!.toWorkspaces()
    // Drop the permission so the single-agent path is the one under test.
    val ws =
      workspaces[0].copy(
        agents = workspaces[0].agents.map { it.copy(pendingPermission = null) },
      )
    val destination = ws.destination()
    assertTrue(destination is WorkspaceDestination.Agent)
    assertEquals("a-1", (destination as WorkspaceDestination.Agent).agentId)
  }

  @Test
  fun `summary line reads as the single agent or an aggregate`() {
    val workspaces = decodeSnapshot(phoneJson)!!.toWorkspaces()
    assertEquals("Claude · needs approval", workspaces[0].summaryLine())
    assertEquals("2 agents · 1 running", workspaces[1].summaryLine())
    assertEquals("no agents · tap to start", workspaces[2].summaryLine())
  }

  @Test
  fun `sort puts needs-attention first and idle last`() {
    val sorted = decodeSnapshot(phoneJson)!!.toWorkspaces().sortedForWrist()
    assertEquals(listOf("jubilant-wombat", "main", "relay-tls"), sorted.map { it.name })
  }

  @Test
  fun `commands round trip`() {
    val command =
      WireCommand(
        kind = WireCommand.RESPOND_PERMISSION,
        serverId = "srv-1",
        agentId = "a-1",
        requestId = "perm-1",
        allow = true,
      )
    val encoded = WearBridge.json.encodeToString(WireCommand.serializer(), command)
    val decoded = WearBridge.json.decodeFromString(WireCommand.serializer(), encoded)
    assertEquals(command, decoded)
    // The phone reads these keys by name; keep them stable.
    assertTrue(encoded.contains("\"kind\":\"respondPermission\""))
    assertTrue(encoded.contains("\"allow\":true"))
  }
}

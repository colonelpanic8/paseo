package sh.paseo.watch.data

import kotlinx.serialization.SerialName
import kotlinx.serialization.Serializable
import kotlinx.serialization.json.Json
import sh.paseo.watch.model.ActivityState
import sh.paseo.watch.model.AgentSession
import sh.paseo.watch.model.PermissionRequest
import sh.paseo.watch.model.Workspace

/**
 * The watch <-> phone wire contract.
 *
 * This is a private protocol between two halves of the same product that ship
 * together, so it is NOT subject to Paseo's daemon protocol back-compat rules. It
 * does still carry [PROTOCOL_VERSION]: a watch and a phone app can be updated
 * independently by the user, and the mismatch has to be detectable rather than
 * silently mis-parsed.
 *
 * The mirror of this file is packages/app/src/wear/wear-protocol.ts. Change both or
 * neither — there is no generated code keeping them honest.
 *
 * Design notes:
 * - The phone sends display-ready values. `age` arrives as "12m", already
 *   formatted, so the watch does no clock math and needs no timezone handling.
 * - Snapshots go over DataClient (persisted, auto-synced, survives the watch being
 *   out of range and resyncs on reconnect). Commands go over MessageClient
 *   (fire-and-forget, low latency, no persistence — a command that can't be
 *   delivered should fail loudly rather than arrive an hour later).
 */
object WearBridge {
  const val PROTOCOL_VERSION = 1

  /** DataClient path carrying the full snapshot. */
  const val SNAPSHOT_PATH = "/paseo/snapshot"

  /** MessageClient path for watch -> phone commands. */
  const val COMMAND_PATH = "/paseo/command"

  /** MessageClient path asking the phone to republish immediately. */
  const val REFRESH_PATH = "/paseo/refresh"

  /** DataItem key holding the JSON payload. */
  const val SNAPSHOT_KEY = "payload"

  val json: Json = Json {
    ignoreUnknownKeys = true
    encodeDefaults = true
  }
}

// ---------------------------------------------------------------------------
// Snapshot: phone -> watch
// ---------------------------------------------------------------------------

@Serializable
data class WireSnapshot(
  @SerialName("v") val version: Int = WearBridge.PROTOCOL_VERSION,
  @SerialName("updatedAt") val updatedAt: Long = 0,
  @SerialName("workspaces") val workspaces: List<WireWorkspace> = emptyList(),
)

@Serializable
data class WireWorkspace(
  val id: String,
  val name: String,
  val projectKey: String,
  val projectName: String,
  /** Which daemon this workspace lives on; commands must be routed back to it. */
  val serverId: String,
  val agents: List<WireAgent> = emptyList(),
)

@Serializable
data class WireAgent(
  val id: String,
  val provider: String,
  /** "needsInput" | "running" | "idle" — unknown values degrade to idle. */
  val state: String,
  val age: String = "",
  val intent: String? = null,
  val summary: String? = null,
  val permission: WirePermission? = null,
)

@Serializable
data class WirePermission(
  val id: String,
  val title: String,
  val detail: String,
)

// ---------------------------------------------------------------------------
// Commands: watch -> phone
// ---------------------------------------------------------------------------

@Serializable
data class WireCommand(
  @SerialName("v") val version: Int = WearBridge.PROTOCOL_VERSION,
  val kind: String,
  val serverId: String,
  val agentId: String? = null,
  val workspaceId: String? = null,
  val requestId: String? = null,
  val text: String? = null,
  val allow: Boolean? = null,
) {
  companion object {
    const val SEND_PROMPT = "sendPrompt"
    const val CREATE_AGENT = "createAgent"
    const val RESPOND_PERMISSION = "respondPermission"
    const val STOP_AGENT = "stopAgent"
  }
}

// ---------------------------------------------------------------------------
// Mapping to the UI model
// ---------------------------------------------------------------------------

private fun String.toActivityState(): ActivityState =
  when (this) {
    "needsInput" -> ActivityState.NeedsInput
    "running" -> ActivityState.Running
    // Anything unrecognised — including a state added by a newer phone build —
    // reads as idle. Idle is the safe default: it never fabricates urgency.
    else -> ActivityState.Idle
  }

fun WireSnapshot.toWorkspaces(): List<Workspace> =
  workspaces.map { wire ->
    Workspace(
      id = wire.id,
      name = wire.name,
      projectKey = wire.projectKey,
      projectName = wire.projectName,
      serverId = wire.serverId,
      agents =
        wire.agents.map { agent ->
          AgentSession(
            id = agent.id,
            workspaceId = wire.id,
            serverId = wire.serverId,
            provider = agent.provider,
            state = agent.state.toActivityState(),
            age = agent.age,
            intent = agent.intent,
            summary = agent.summary,
            pendingPermission =
              agent.permission?.let {
                PermissionRequest(
                  id = it.id,
                  agentId = agent.id,
                  title = it.title,
                  detail = it.detail,
                )
              },
          )
        },
    )
  }

fun decodeSnapshot(raw: String): WireSnapshot? =
  runCatching { WearBridge.json.decodeFromString<WireSnapshot>(raw) }
    .getOrNull()
    // A snapshot from a future protocol version is dropped rather than
    // partially rendered; the UI shows its "waiting for phone" state instead.
    ?.takeIf { it.version == WearBridge.PROTOCOL_VERSION }

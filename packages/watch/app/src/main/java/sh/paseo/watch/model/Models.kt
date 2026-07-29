package sh.paseo.watch.model

/**
 * Watch-side view of Paseo's Project -> Workspace -> Agent session hierarchy.
 *
 * These are display models, not wire types. The phone app owns the daemon
 * connection and flattens its snapshot into these before pushing them over the
 * Wearable Data Layer, so the watch never has to know about timelines,
 * providers config, or git state.
 *
 * Terminology follows docs/glossary.md exactly: a Workspace is one cwd on one
 * daemon belonging to exactly one Project, and an Agent session is one running
 * instance of an agent inside a workspace. Worktree-backed workspaces carry the
 * mnemonic names (`jubilant-wombat`), so those are workspace labels — never
 * agent labels.
 */

/** Aggregate activity signal for a row. Ordering here is the sort priority. */
enum class ActivityState {
  NeedsInput,
  Running,
  Idle,
}

data class AgentSession(
  val id: String,
  val workspaceId: String,
  /** Daemon this session lives on. Commands must be routed back to it. */
  val serverId: String,
  /** Provider display name — "Claude", "Codex", "Copilot". The agent row's primary line. */
  val provider: String,
  val state: ActivityState,
  /** Pre-formatted by the phone ("12m", "2h"); the watch does no time math. */
  val age: String,
  /** Short intent line, e.g. "docs rewrite". Null when there's nothing useful to say. */
  val intent: String? = null,
  /**
   * One-line description of what this session is doing, for the agent detail
   * screen. The phone sends the daemon's own agent title — not the transcript tail,
   * which would mean subscribing to every agent's timeline just to fill a wrist.
   */
  val summary: String? = null,
  val pendingPermission: PermissionRequest? = null,
)

data class Workspace(
  val id: String,
  /** Workspace name — the mnemonic for worktree-backed workspaces. */
  val name: String,
  val projectKey: String,
  val projectName: String,
  /** Daemon this workspace lives on. */
  val serverId: String,
  val agents: List<AgentSession>,
) {
  /** Worst state across the workspace's agents, per ActivityState ordering. */
  val state: ActivityState
    get() = agents.minByOrNull { it.state.ordinal }?.state ?: ActivityState.Idle

  val pendingPermission: PermissionRequest?
    get() = agents.firstNotNullOfOrNull { it.pendingPermission }
}

data class PermissionRequest(
  val id: String,
  val agentId: String,
  /** Human-readable action, e.g. "Run command?". */
  val title: String,
  /** The thing being approved, rendered monospace. */
  val detail: String,
)

/**
 * Where tapping a workspace goes. Encoding this as a value — rather than
 * branching at each call site — is what keeps the "one agent skips the picker"
 * rule from drifting.
 */
sealed interface WorkspaceDestination {
  data class Permission(val agentId: String) : WorkspaceDestination

  data class Agent(val agentId: String) : WorkspaceDestination

  /** Ambiguous: 2+ agents and nothing demanding attention. */
  data class Picker(val workspaceId: String) : WorkspaceDestination

  /** Empty workspace — go straight to dictating a prompt for a new agent. */
  data class NewAgent(val workspaceId: String) : WorkspaceDestination
}

fun Workspace.destination(): WorkspaceDestination {
  pendingPermission?.let { return WorkspaceDestination.Permission(it.agentId) }
  return when (agents.size) {
    0 -> WorkspaceDestination.NewAgent(id)
    1 -> WorkspaceDestination.Agent(agents.single().id)
    else -> WorkspaceDestination.Picker(id)
  }
}

/** Secondary line on a workspace row: the single agent's status, or an aggregate. */
fun Workspace.summaryLine(): String {
  val single = agents.singleOrNull()
  if (single != null) {
    val state =
      when (single.state) {
        ActivityState.NeedsInput -> "needs approval"
        ActivityState.Running -> "running ${single.age}"
        ActivityState.Idle -> "idle ${single.age}"
      }
    return "${single.provider} · $state"
  }
  if (agents.isEmpty()) return "no agents · tap to start"

  val needsInput = agents.count { it.state == ActivityState.NeedsInput }
  val running = agents.count { it.state == ActivityState.Running }
  val detail =
    when {
      needsInput > 0 -> "$needsInput needs approval"
      running > 0 -> "$running running"
      else -> "all idle"
    }
  return "${agents.size} agents · $detail"
}

/** Needs-attention first, then running, then idle. */
fun List<Workspace>.sortedForWrist(): List<Workspace> =
  sortedWith(compareBy({ it.state.ordinal }, { it.name }))

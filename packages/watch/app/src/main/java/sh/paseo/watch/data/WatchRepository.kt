package sh.paseo.watch.data

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import sh.paseo.watch.model.ActivityState
import sh.paseo.watch.model.AgentSession
import sh.paseo.watch.model.PermissionRequest
import sh.paseo.watch.model.Workspace

/**
 * Everything the watch UI needs, and nothing about how it gets there.
 *
 * The real implementation will be backed by the Wearable Data Layer with the
 * phone app holding the daemon connection. [MockWatchRepository] stands in until
 * that bridge exists, so the UI is fully exercisable on a bare emulator.
 */
interface WatchRepository {
  val workspaces: StateFlow<List<Workspace>>

  fun workspace(id: String): Workspace?

  fun agent(id: String): AgentSession?

  /** Send a prompt to an existing agent session. */
  suspend fun sendPrompt(agentId: String, text: String)

  /** Create a new agent session in a workspace with an initial prompt. */
  suspend fun createAgent(workspaceId: String, prompt: String)

  suspend fun respondToPermission(requestId: String, allow: Boolean)

  suspend fun stopAgent(agentId: String)
}

/**
 * Mock data mirroring design/watch-mock.html one-for-one, so the running app can
 * be compared against the approved mock screen by screen.
 *
 * Deliberately covers all four workspace shapes the navigation rule has to
 * handle: needs-approval, single running agent, multi-agent, and empty.
 */
class MockWatchRepository : WatchRepository {
  private val state = MutableStateFlow(seed())

  override val workspaces: StateFlow<List<Workspace>> = state

  override fun workspace(id: String): Workspace? = state.value.firstOrNull { it.id == id }

  override fun agent(id: String): AgentSession? =
    state.value.flatMap { it.agents }.firstOrNull { it.id == id }

  override suspend fun sendPrompt(agentId: String, text: String) {
    mutateAgent(agentId) {
      it.copy(state = ActivityState.Running, age = "now", summary = null, pendingPermission = null)
    }
  }

  override suspend fun createAgent(workspaceId: String, prompt: String) {
    state.value =
      state.value.map { workspace ->
        if (workspace.id != workspaceId) {
          workspace
        } else {
          workspace.copy(
            agents =
              workspace.agents +
                AgentSession(
                  id = "agent-new-${workspace.agents.size + 1}",
                  workspaceId = workspaceId,
                  serverId = workspace.serverId,
                  provider = "Claude",
                  state = ActivityState.Running,
                  age = "now",
                  intent = prompt.take(24),
                ),
          )
        }
      }
  }

  override suspend fun respondToPermission(requestId: String, allow: Boolean) {
    state.value =
      state.value.map { workspace ->
        workspace.copy(
          agents =
            workspace.agents.map { agent ->
              if (agent.pendingPermission?.id != requestId) {
                agent
              } else {
                agent.copy(
                  pendingPermission = null,
                  state = if (allow) ActivityState.Running else ActivityState.Idle,
                  age = "now",
                )
              }
            },
        )
      }
  }

  override suspend fun stopAgent(agentId: String) {
    mutateAgent(agentId) { it.copy(state = ActivityState.Idle, age = "now") }
  }

  private fun mutateAgent(agentId: String, transform: (AgentSession) -> AgentSession) {
    state.value =
      state.value.map { workspace ->
        workspace.copy(
          agents = workspace.agents.map { if (it.id == agentId) transform(it) else it },
        )
      }
  }

  private companion object {
    const val MOCK_SERVER = "mock-daemon"

    fun seed(): List<Workspace> =
      listOf(
        Workspace(
          id = "ws-jubilant",
          name = "jubilant-wombat",
          projectKey = "github.com/getpaseo/paseo",
          projectName = "paseo",
          serverId = MOCK_SERVER,
          agents =
            listOf(
              AgentSession(
                id = "agent-jubilant",
                workspaceId = "ws-jubilant",
                serverId = MOCK_SERVER,
                provider = "Claude",
                state = ActivityState.NeedsInput,
                age = "1m",
                summary =
                  "Branch is ready. I need to push it before opening the change request.",
                pendingPermission =
                  PermissionRequest(
                    id = "perm-1",
                    agentId = "agent-jubilant",
                    title = "Run command?",
                    detail = "git push origin jubilant-wombat",
                  ),
              ),
            ),
        ),
        Workspace(
          id = "ws-crimson",
          name = "crimson-falcon",
          projectKey = "github.com/getpaseo/paseo",
          projectName = "paseo",
          serverId = MOCK_SERVER,
          agents =
            listOf(
              AgentSession(
                id = "agent-crimson",
                workspaceId = "ws-crimson",
                serverId = MOCK_SERVER,
                provider = "Claude",
                state = ActivityState.Running,
                age = "12m",
                summary =
                  "Rewrote the retry loop in relay-transport.ts. Now running the transport " +
                    "tests to verify backoff timing…",
              ),
            ),
        ),
        Workspace(
          id = "ws-main",
          name = "main",
          projectKey = "github.com/getpaseo/website",
          projectName = "website",
          serverId = MOCK_SERVER,
          agents =
            listOf(
              AgentSession(
                id = "agent-main-claude",
                workspaceId = "ws-main",
                serverId = MOCK_SERVER,
                provider = "Claude",
                state = ActivityState.Running,
                age = "3m",
                intent = "docs rewrite",
                summary = "Restructured the landing page copy; rebuilding the site now.",
              ),
              AgentSession(
                id = "agent-main-codex",
                workspaceId = "ws-main",
                serverId = MOCK_SERVER,
                provider = "Codex",
                state = ActivityState.Idle,
                age = "2h",
                summary = "Done — pricing table is responsive at 320px.",
              ),
              AgentSession(
                id = "agent-main-copilot",
                workspaceId = "ws-main",
                serverId = MOCK_SERVER,
                provider = "Copilot",
                state = ActivityState.Idle,
                age = "4h",
                summary = "No changes needed; the redirect config already covers it.",
              ),
            ),
        ),
        Workspace(
          id = "ws-relay",
          name = "relay-tls",
          projectKey = "github.com/getpaseo/paseo-relay",
          projectName = "relay",
          serverId = MOCK_SERVER,
          agents = emptyList(),
        ),
      )
  }
}

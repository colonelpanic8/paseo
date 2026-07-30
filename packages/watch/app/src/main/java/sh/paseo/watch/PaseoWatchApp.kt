package sh.paseo.watch

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.collectAsState
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.sp
import androidx.navigation.NavType
import androidx.navigation.navArgument
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.Text
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import androidx.wear.compose.navigation.SwipeDismissableNavHost
import androidx.wear.compose.navigation.composable
import androidx.wear.compose.navigation.rememberSwipeDismissableNavController
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import sh.paseo.watch.data.WatchRepository
import sh.paseo.watch.model.Workspace
import sh.paseo.watch.model.WorkspaceDestination
import sh.paseo.watch.model.destination
import sh.paseo.watch.theme.PaseoColors
import sh.paseo.watch.theme.PaseoWatchTheme
import sh.paseo.watch.ui.AgentPickerScreen
import sh.paseo.watch.ui.AgentScreen
import sh.paseo.watch.ui.NewAgentScreen
import sh.paseo.watch.ui.PermissionScreen
import sh.paseo.watch.ui.WaitingScreen
import sh.paseo.watch.ui.WorkspaceListScreen

/**
 * Long enough to coalesce a burst of snapshots into one transcript request, short
 * enough that it is invisible when you open an agent screen.
 */
private const val TRANSCRIPT_REQUEST_DEBOUNCE_MS = 300L

/**
 * How often an open agent screen re-asks for the transcript regardless of whether
 * anything visible changed.
 *
 * A `requestTranscript` opens a ~150s lease on the phone, and while that lease is
 * alive the phone pushes fresh transcripts within a couple of seconds of new
 * activity. Renewing at 60s keeps it comfortably alive with room for a missed round
 * trip. The reactive request below cannot carry this on its own: an agent that is
 * continuously busy sits at `Running` / "now" indefinitely, so none of its keys ever
 * change — the lease would expire at 150s precisely when the user is watching live
 * output.
 */
private const val TRANSCRIPT_KEEPALIVE_MS = 60_000L

private object Routes {
  const val WORKSPACES = "workspaces"
  const val PICKER = "picker/{workspaceId}"
  const val AGENT = "agent/{agentId}"
  const val PERMISSION = "permission/{agentId}"
  const val NEW_AGENT = "newAgent/{workspaceId}"

  fun picker(workspaceId: String) = "picker/$workspaceId"

  fun agent(agentId: String) = "agent/$agentId"

  fun permission(agentId: String) = "permission/$agentId"

  fun newAgent(workspaceId: String) = "newAgent/$workspaceId"
}

@Composable
fun PaseoWatchApp(
  repository: WatchRepository,
  waitingMessage: String? = null,
  /**
   * True once a snapshot has actually arrived from the phone. Distinguishes "the
   * phone reported no workspaces" from "no snapshot has ever arrived", which need
   * different copy — see [WaitingScreen].
   */
  linked: Boolean = true,
) {
  PaseoWatchTheme {
    val navController = rememberSwipeDismissableNavController()
    val scope = rememberCoroutineScope()
    val workspaces by repository.workspaces.collectAsState()
    val transcripts by repository.transcripts.collectAsState()
    // Keyed by projectKey, not workspace: several workspaces share one project, and
    // the phone publishes one icon per project.
    val icons by repository.icons.collectAsState()

    Scaffold(
      timeText = { TimeText() },
      vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
    ) {
      SwipeDismissableNavHost(
        navController = navController,
        startDestination = Routes.WORKSPACES,
      ) {
        composable(Routes.WORKSPACES) {
          if (workspaces.isEmpty()) {
            WaitingScreen(linked = linked, message = waitingMessage)
            return@composable
          }
          WorkspaceListScreen(
            workspaces = workspaces,
            listState = rememberScalingLazyListState(),
            icons = icons,
            onWorkspaceClick = { workspace ->
              // The single place the "don't make me pick when there's nothing to
              // pick" rule is applied. Keep it that way.
              when (val target = workspace.destination()) {
                is WorkspaceDestination.Permission ->
                  navController.navigate(Routes.permission(target.agentId))
                is WorkspaceDestination.Agent ->
                  navController.navigate(Routes.agent(target.agentId))
                is WorkspaceDestination.Picker ->
                  navController.navigate(Routes.picker(target.workspaceId))
                is WorkspaceDestination.NewAgent ->
                  navController.navigate(Routes.newAgent(target.workspaceId))
              }
            },
          )
        }

        composable(
          Routes.PICKER,
          arguments = listOf(navArgument("workspaceId") { type = NavType.StringType }),
        ) { entry ->
          val workspaceId = entry.arguments?.getString("workspaceId")
          val workspace = workspaces.firstOrNull { it.id == workspaceId }
          if (workspace == null) {
            Missing("Workspace is gone")
          } else {
            AgentPickerScreen(
              workspace = workspace,
              listState = rememberScalingLazyListState(),
              onAgentClick = { agent -> navController.navigate(Routes.agent(agent.id)) },
              onNewAgent = { navController.navigate(Routes.newAgent(workspace.id)) },
              icon = icons[workspace.projectKey],
            )
          }
        }

        composable(
          Routes.AGENT,
          arguments = listOf(navArgument("agentId") { type = NavType.StringType }),
        ) { entry ->
          val agentId = entry.arguments?.getString("agentId")
          val workspace = workspaces.workspaceOfAgent(agentId)
          val agent = workspace?.agents?.firstOrNull { it.id == agentId }
          val pending = agent?.pendingPermission
          if (workspace == null || agent == null) {
            Missing("Agent is gone")
          } else if (pending != null) {
            // An approval that arrives while you're looking at the agent takes over;
            // it is strictly more urgent than anything else on this screen.
            PermissionScreen(
              workspace = workspace,
              agent = agent,
              request = pending,
              onRespond = { allow ->
                scope.launch { repository.respondToPermission(pending.id, allow) }
              },
              icon = icons[workspace.projectKey],
            )
          } else {
            // Ask for the transcript on arrival, and again whenever this agent's row
            // moves — a state change or a ticking age both mean the conversation has
            // probably grown. The short delay makes this a trailing debounce:
            // LaunchedEffect cancels the previous coroutine when the key changes, so
            // a burst of snapshots collapses into one request instead of one each.
            LaunchedEffect(agent.id, agent.state, agent.age) {
              delay(TRANSCRIPT_REQUEST_DEBOUNCE_MS)
              repository.requestTranscript(agent.id)
            }
            // Renew the phone's lease for as long as this screen is up. Keyed only on
            // the agent, so it survives the snapshot churn that drives the request
            // above and cancels itself when the screen leaves composition.
            LaunchedEffect(agent.id) {
              while (true) {
                delay(TRANSCRIPT_KEEPALIVE_MS)
                repository.requestTranscript(agent.id)
              }
            }
            AgentScreen(
              workspace = workspace,
              agent = agent,
              transcript = transcripts[agent.id],
              // No reply screen: Reply opens the recognizer in place and the words
              // come back here.
              onSubmit = { text -> scope.launch { repository.sendPrompt(agent.id, text) } },
              onStop = { scope.launch { repository.stopAgent(agent.id) } },
              icon = icons[workspace.projectKey],
            )
          }
        }

        composable(
          Routes.PERMISSION,
          arguments = listOf(navArgument("agentId") { type = NavType.StringType }),
        ) { entry ->
          val agentId = entry.arguments?.getString("agentId")
          val workspace = workspaces.workspaceOfAgent(agentId)
          val agent = workspace?.agents?.firstOrNull { it.id == agentId }
          val request = agent?.pendingPermission
          if (workspace == null || agent == null || request == null) {
            // Someone answered it on the phone, or the agent moved on. Nothing to
            // do here — drop back rather than showing a stale decision.
            Missing("Already handled")
          } else {
            PermissionScreen(
              workspace = workspace,
              agent = agent,
              request = request,
              onRespond = { allow ->
                scope.launch { repository.respondToPermission(request.id, allow) }
                navController.popBackStack()
              },
              icon = icons[workspace.projectKey],
            )
          }
        }

        composable(
          Routes.NEW_AGENT,
          arguments = listOf(navArgument("workspaceId") { type = NavType.StringType }),
        ) { entry ->
          val workspaceId = entry.arguments?.getString("workspaceId")
          val workspace = workspaces.firstOrNull { it.id == workspaceId }
          if (workspace == null) {
            Missing("Workspace is gone")
          } else {
            NewAgentScreen(
              workspaceName = workspace.name,
              projectKey = workspace.projectKey,
              projectName = workspace.projectName,
              listState = rememberScalingLazyListState(),
              onSubmit = { text ->
                scope.launch { repository.createAgent(workspace.id, text) }
                navController.popBackStack()
              },
              icon = icons[workspace.projectKey],
            )
          }
        }
      }
    }
  }
}

private fun List<Workspace>.workspaceOfAgent(agentId: String?): Workspace? =
  firstOrNull { workspace -> workspace.agents.any { it.id == agentId } }

@Composable
private fun Missing(message: String) {
  Box(modifier = Modifier.fillMaxSize(), contentAlignment = Alignment.Center) {
    Text(
      text = message,
      color = PaseoColors.foregroundMuted,
      fontSize = 13.sp,
      textAlign = TextAlign.Center,
    )
  }
}

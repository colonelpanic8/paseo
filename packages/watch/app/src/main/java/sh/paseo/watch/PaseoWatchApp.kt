package sh.paseo.watch

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
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
import kotlinx.coroutines.launch
import sh.paseo.watch.data.WatchRepository
import sh.paseo.watch.model.Workspace
import sh.paseo.watch.model.WorkspaceDestination
import sh.paseo.watch.model.destination
import sh.paseo.watch.theme.PaseoColors
import sh.paseo.watch.theme.PaseoWatchTheme
import sh.paseo.watch.ui.AgentPickerScreen
import sh.paseo.watch.ui.AgentScreen
import sh.paseo.watch.ui.PermissionScreen
import sh.paseo.watch.ui.ReplyScreen
import sh.paseo.watch.ui.WaitingScreen
import sh.paseo.watch.ui.WorkspaceListScreen

private object Routes {
  const val WORKSPACES = "workspaces"
  const val PICKER = "picker/{workspaceId}"
  const val AGENT = "agent/{agentId}"
  const val PERMISSION = "permission/{agentId}"
  const val REPLY = "reply/{agentId}"
  const val NEW_AGENT = "newAgent/{workspaceId}"

  fun picker(workspaceId: String) = "picker/$workspaceId"

  fun agent(agentId: String) = "agent/$agentId"

  fun permission(agentId: String) = "permission/$agentId"

  fun reply(agentId: String) = "reply/$agentId"

  fun newAgent(workspaceId: String) = "newAgent/$workspaceId"
}

@Composable
fun PaseoWatchApp(repository: WatchRepository, waitingMessage: String? = null) {
  PaseoWatchTheme {
    val navController = rememberSwipeDismissableNavController()
    val scope = rememberCoroutineScope()
    val workspaces by repository.workspaces.collectAsState()

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
            // No snapshot yet. Distinct from "you have no workspaces", which the
            // phone would report as an empty list only after it had connected —
            // but from the wrist both look the same, and the actionable advice is
            // identical, so one screen covers both.
            WaitingScreen(message = waitingMessage)
            return@composable
          }
          WorkspaceListScreen(
            workspaces = workspaces,
            listState = rememberScalingLazyListState(),
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
            )
          } else {
            AgentScreen(
              workspace = workspace,
              agent = agent,
              onReply = { navController.navigate(Routes.reply(agent.id)) },
              onStop = { scope.launch { repository.stopAgent(agent.id) } },
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
            )
          }
        }

        composable(
          Routes.REPLY,
          arguments = listOf(navArgument("agentId") { type = NavType.StringType }),
        ) { entry ->
          val agentId = entry.arguments?.getString("agentId")
          val workspace = workspaces.workspaceOfAgent(agentId)
          val agent = workspace?.agents?.firstOrNull { it.id == agentId }
          if (workspace == null || agent == null) {
            Missing("Agent is gone")
          } else {
            ReplyScreen(
              title = "Reply to ${agent.provider}",
              projectKey = workspace.projectKey,
              projectName = workspace.projectName,
              workspaceName = workspace.name,
              listState = rememberScalingLazyListState(),
              onSubmit = { text ->
                scope.launch { repository.sendPrompt(agent.id, text) }
                navController.popBackStack()
              },
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
            ReplyScreen(
              title = "New agent in ${workspace.name}",
              projectKey = workspace.projectKey,
              projectName = workspace.projectName,
              workspaceName = workspace.name,
              listState = rememberScalingLazyListState(),
              onSubmit = { text ->
                scope.launch { repository.createAgent(workspace.id, text) }
                navController.popBackStack()
              },
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

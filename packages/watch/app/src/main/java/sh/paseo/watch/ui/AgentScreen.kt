package sh.paseo.watch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Text
import sh.paseo.watch.model.ActivityState
import sh.paseo.watch.model.AgentSession
import sh.paseo.watch.model.Workspace
import sh.paseo.watch.theme.PaseoColors

/**
 * Agent detail. The whole screen is one question: is this thing OK, and do I need
 * to say something?
 *
 * Shows a one-line summary of what the session is doing — the wrist is for triage,
 * the phone is for reading. Reply is the primary action and carries the accent
 * color; Stop is deliberately the muted secondary so a mis-tap costs nothing.
 */
@Composable
fun AgentScreen(
  workspace: Workspace,
  agent: AgentSession,
  onReply: () -> Unit,
  onStop: () -> Unit,
) {
  Column(
    modifier =
      Modifier
        .fillMaxSize()
        .verticalScroll(rememberScrollState())
        // Top padding clears Scaffold's TimeText (~24dp); bottom stays tight so the
        // action labels clear the bezel. The 3-line message cap is what makes both
        // fit at once.
        .padding(start = 16.dp, end = 16.dp, top = 26.dp, bottom = 6.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
  ) {
    WorkspaceHeader(
      projectKey = workspace.projectKey,
      projectName = workspace.projectName,
      workspaceName = workspace.name,
    )
    Spacer(Modifier.height(4.dp))
    StatusLine(state = agent.state, text = "${agent.provider} · ${statusText(agent)}")

    agent.summary?.let { message ->
      Spacer(Modifier.height(10.dp))
      Box(
        modifier =
          Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(16.dp))
            .background(PaseoColors.surface1)
            .border(1.dp, PaseoColors.border, RoundedCornerShape(16.dp))
            .padding(horizontal = 13.dp, vertical = 10.dp),
      ) {
        Text(
          text = message,
          color = PaseoColors.foregroundMuted,
          fontSize = 11.5.sp,
          lineHeight = 16.sp,
          // Three lines is the wrist's honest budget: enough to know what the agent
          // is doing, not an attempt to read the transcript. The phone is for that.
          maxLines = 3,
          overflow = TextOverflow.Ellipsis,
        )
      }
    }

    Spacer(Modifier.height(8.dp))
    Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
      ActionButton(
        label = "Reply",
        primary = true,
        onClick = onReply,
        content = { MicGlyph(tint = androidx.compose.ui.graphics.Color.White) },
      )
      if (agent.state == ActivityState.Running) {
        ActionButton(
          label = "Stop",
          primary = false,
          onClick = onStop,
          content = { StopGlyph(tint = PaseoColors.foregroundMuted) },
        )
      }
    }
  }
}

private fun statusText(agent: AgentSession): String =
  when (agent.state) {
    ActivityState.NeedsInput -> "needs approval"
    ActivityState.Running -> "running ${agent.age}"
    ActivityState.Idle -> "idle ${agent.age}"
  }

@Composable
fun ActionButton(
  label: String,
  primary: Boolean,
  onClick: () -> Unit,
  content: @Composable () -> Unit,
) {
  Column(horizontalAlignment = Alignment.CenterHorizontally) {
    Button(
      onClick = onClick,
      colors =
        ButtonDefaults.buttonColors(
          backgroundColor = if (primary) PaseoColors.accent else PaseoColors.surface2,
        ),
      modifier = Modifier.size(52.dp),
    ) {
      content()
    }
    Spacer(Modifier.height(5.dp))
    Text(
      text = label,
      color = PaseoColors.foregroundExtraMuted,
      fontSize = 10.sp,
      textAlign = TextAlign.Center,
    )
  }
}

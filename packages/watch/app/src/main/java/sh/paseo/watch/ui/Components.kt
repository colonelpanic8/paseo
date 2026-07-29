package sh.paseo.watch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text
import sh.paseo.watch.model.ActivityState
import sh.paseo.watch.theme.PaseoColors
import sh.paseo.watch.theme.deriveProjectIconColor
import sh.paseo.watch.theme.projectIconLabel

fun ActivityState.dotColor(): Color =
  when (this) {
    ActivityState.NeedsInput -> PaseoColors.warning
    ActivityState.Running -> PaseoColors.accentBright
    ActivityState.Idle -> PaseoColors.foregroundExtraMuted
  }

/**
 * Project icon: colored rounded square with the project initial, matching
 * <ProjectIconView> on the phone.
 *
 * The status dot rides the icon's bottom-right corner so one glyph carries
 * project, identity, and state — horizontal room is the scarcest thing on a
 * 450px screen. [ringColor] must match whatever surface the icon sits on, since
 * the dot punches a hole in it.
 */
@Composable
fun ProjectIcon(
  projectKey: String,
  projectName: String,
  modifier: Modifier = Modifier,
  size: Int = 26,
  state: ActivityState? = null,
  ringColor: Color = PaseoColors.surface2,
) {
  Box(modifier = modifier.size(size.dp)) {
    Box(
      modifier =
        Modifier
          .size(size.dp)
          .clip(RoundedCornerShape((size / 3.2f).dp))
          .background(deriveProjectIconColor(projectKey)),
      contentAlignment = Alignment.Center,
    ) {
      Text(
        text = projectIconLabel(projectName),
        color = Color.White,
        fontSize = (size * 0.5f).sp,
        fontWeight = FontWeight.Medium,
      )
    }
    if (state != null) {
      val dot = (size * 0.42f).dp
      Box(
        modifier =
          Modifier
            .align(Alignment.BottomEnd)
            .size(dot)
            .clip(CircleShape)
            .background(ringColor),
        contentAlignment = Alignment.Center,
      ) {
        Box(
          modifier =
            Modifier
              .size(dot - 4.dp)
              .clip(CircleShape)
              .background(state.dotColor()),
        )
      }
    }
  }
}

/** Small status dot + label, used as the secondary line on detail screens. */
@Composable
fun StatusLine(state: ActivityState, text: String, modifier: Modifier = Modifier) {
  Row(
    modifier = modifier,
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.Center,
  ) {
    Box(
      modifier =
        Modifier
          .size(7.dp)
          .clip(CircleShape)
          .background(state.dotColor()),
    )
    Spacer(Modifier.width(6.dp))
    Text(
      text = text,
      color = if (state == ActivityState.Idle) PaseoColors.foregroundMuted else state.dotColor(),
      fontSize = 12.sp,
    )
  }
}

/** Workspace context header: project icon + workspace name. */
@Composable
fun WorkspaceHeader(
  projectKey: String,
  projectName: String,
  workspaceName: String,
  modifier: Modifier = Modifier,
  muted: Boolean = false,
) {
  Row(
    modifier = modifier,
    verticalAlignment = Alignment.CenterVertically,
    horizontalArrangement = Arrangement.Center,
  ) {
    ProjectIcon(
      projectKey = projectKey,
      projectName = projectName,
      size = 20,
      ringColor = PaseoColors.surface0,
    )
    Spacer(Modifier.width(7.dp))
    Text(
      text = workspaceName,
      color = if (muted) PaseoColors.foregroundMuted else PaseoColors.foreground,
      fontSize = 13.sp,
      fontWeight = if (muted) FontWeight.Normal else FontWeight.Medium,
      maxLines = 1,
    )
  }
}

/** Monospace block for the thing being approved. */
@Composable
fun CommandBlock(text: String, modifier: Modifier = Modifier) {
  Box(
    modifier =
      modifier
        .clip(RoundedCornerShape(14.dp))
        .background(Color(0xFF121413))
        .border(1.dp, PaseoColors.border, RoundedCornerShape(14.dp)),
  ) {
    Text(
      text = text,
      color = PaseoColors.foreground,
      fontSize = 11.sp,
      fontFamily = FontFamily.Monospace,
      maxLines = 2,
      modifier = Modifier.padding(horizontal = 12.dp, vertical = 9.dp),
    )
  }
}

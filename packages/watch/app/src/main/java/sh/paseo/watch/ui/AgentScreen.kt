package sh.paseo.watch.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.rememberScalingLazyListState
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Text
import sh.paseo.watch.model.ActivityState
import sh.paseo.watch.model.AgentSession
import sh.paseo.watch.model.Transcript
import sh.paseo.watch.model.TranscriptEntry
import sh.paseo.watch.model.TranscriptKind
import sh.paseo.watch.model.Workspace
import sh.paseo.watch.theme.PaseoColors

/**
 * One row of the agent screen.
 *
 * The list is built as data before it is emitted so that "where is the bottom" is a
 * property of the list rather than arithmetic repeated next to the scroll call. The
 * initial scroll depends on that index being right, and an off-by-one there is the
 * kind of bug that only shows up on a device.
 */
private sealed interface AgentRow {
  data object Header : AgentRow

  data object Status : AgentRow

  /** Fallback shown until (or unless) a transcript arrives. */
  data object Summary : AgentRow

  /** Marks that history continues above the first entry. */
  data object Earlier : AgentRow

  data class Turn(val entry: TranscriptEntry) : AgentRow

  data object Actions : AgentRow
}

/**
 * Agent detail: the conversation, and what you can do about it.
 *
 * The list reads like a chat log — oldest at the top, newest at the bottom, actions
 * below that — and it *opens* at the bottom. That ordering is the whole design: the
 * newest turn and the Reply button are what you get without touching the crown, and
 * the crown scrolls up into the backlog only when you want it. Anchoring at the top
 * instead would put the oldest turn under your eyes and the actions off-screen.
 *
 * Until a transcript arrives — and a phone too old to answer `requestTranscript`
 * never sends one — the screen falls back to the snapshot's one-line summary. That
 * is a normal state, not an error, so it gets no error treatment.
 *
 * Reply is the 52dp accent primary. Stop is deliberately smaller and muted: it ends
 * work, it is rarely what you came for, and on a wrist the cost of a mis-tap is what
 * sizes a button.
 */
@Composable
fun AgentScreen(
  workspace: Workspace,
  agent: AgentSession,
  transcript: Transcript?,
  onReply: () -> Unit,
  onStop: () -> Unit,
  listState: ScalingLazyListState = rememberScalingLazyListState(),
) {
  val entries = transcript?.entries.orEmpty()
  val rows =
    buildList {
      add(AgentRow.Header)
      add(AgentRow.Status)
      if (entries.isEmpty()) {
        if (!agent.summary.isNullOrBlank()) add(AgentRow.Summary)
      } else {
        if (transcript?.truncated == true) add(AgentRow.Earlier)
        entries.forEach { add(AgentRow.Turn(it)) }
      }
      add(AgentRow.Actions)
    }

  ScalingLazyColumn(
    modifier = Modifier.fillMaxWidth(),
    state = listState,
    // Same reason as every other list here: autoCentering would spend the top third
    // of a 450px screen before the header renders.
    autoCentering = null,
    contentPadding = PaddingValues(start = 12.dp, top = 28.dp, end = 12.dp, bottom = 14.dp),
  ) {
    items(rows.size) { index ->
      when (val row = rows[index]) {
        AgentRow.Header ->
          WorkspaceHeader(
            projectKey = workspace.projectKey,
            projectName = workspace.projectName,
            workspaceName = workspace.name,
          )

        AgentRow.Status ->
          StatusLine(
            state = agent.state,
            text = "${agent.provider} · ${statusText(agent)}",
            modifier = Modifier.padding(top = 3.dp, bottom = 9.dp),
          )

        AgentRow.Summary -> SummaryCard(summary = agent.summary.orEmpty())

        AgentRow.Earlier -> EarlierMarker()

        is AgentRow.Turn -> {
          TranscriptRow(row.entry)
          Spacer(Modifier.height(6.dp))
        }

        AgentRow.Actions -> AgentActions(agent = agent, onReply = onReply, onStop = onStop)
      }
    }
  }

  // Land at the newest turn on entry. Afterwards a refreshed transcript re-anchors
  // only when the user is already at the bottom: the screen re-requests on every
  // snapshot tick, so following every update unconditionally would yank a reader
  // out of the backlog once a minute. Scrolling to the last row (the actions)
  // clamps to the end when the content is shorter than the screen, which is
  // exactly the no-transcript case.
  var anchoredAgentId by remember { mutableStateOf<String?>(null) }
  LaunchedEffect(agent.id, rows.size, transcript?.updatedAt) {
    if (anchoredAgentId != agent.id || !listState.canScrollForward) {
      listState.scrollToItem(rows.lastIndex)
      anchoredAgentId = agent.id
    }
  }
}

/**
 * What the screen shows before any transcript lands: the snapshot's one-line
 * summary, which every agent always has. Visually unchanged from what this screen
 * used to be — it is a real fallback, not a skeleton, because against a phone that
 * can't answer a transcript request it is the permanent state.
 */
@Composable
private fun SummaryCard(summary: String) {
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
      text = summary,
      color = PaseoColors.foregroundMuted,
      fontSize = 11.5.sp,
      lineHeight = 16.sp,
      // The summary is the daemon's agent title — one sentence. Three lines is the
      // honest budget for it; the transcript is the thing you scroll.
      maxLines = 3,
      overflow = TextOverflow.Ellipsis,
    )
  }
}

/** Says the backlog continues above, without pretending the watch can fetch it. */
@Composable
private fun EarlierMarker() {
  Text(
    text = "earlier history on your phone",
    color = PaseoColors.foregroundExtraMuted,
    fontSize = 9.5.sp,
    textAlign = TextAlign.Center,
    modifier = Modifier.fillMaxWidth().padding(bottom = 7.dp),
  )
}

/**
 * One conversation turn.
 *
 * The kinds are separated by weight rather than by labels — a "You:" prefix on every
 * other row would spend a line of a 450px screen saying what the styling already
 * says. Assistant prose is bare and bright because it is the thing being read; the
 * user's own words sit inset in a filled bubble because they are context, not news;
 * a tool line is one muted monospace line because its job is to show that work
 * happened, not what it was; errors carry the destructive tint.
 */
@Composable
private fun TranscriptRow(entry: TranscriptEntry) {
  when (entry.kind) {
    TranscriptKind.Assistant ->
      Text(
        text = entry.text,
        color = PaseoColors.foreground,
        fontSize = 12.sp,
        lineHeight = 16.sp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp),
      )

    TranscriptKind.User ->
      Box(
        modifier =
          Modifier
            .fillMaxWidth()
            // Inset from the left so the bubble reads as "mine" against the
            // full-bleed assistant prose.
            .padding(start = 22.dp)
            .clip(RoundedCornerShape(14.dp))
            .background(PaseoColors.surface2)
            .padding(horizontal = 10.dp, vertical = 7.dp),
      ) {
        Text(
          text = entry.text,
          color = PaseoColors.foreground,
          fontSize = 11.5.sp,
          lineHeight = 15.sp,
        )
      }

    TranscriptKind.Tool ->
      Text(
        text = entry.text,
        color = PaseoColors.foregroundExtraMuted,
        fontSize = 10.sp,
        fontFamily = FontFamily.Monospace,
        // Exactly one line, always. A tool call that wraps is a tool call pretending
        // to be worth reading.
        maxLines = 1,
        overflow = TextOverflow.Ellipsis,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp),
      )

    TranscriptKind.Error ->
      Box(
        modifier =
          Modifier
            .fillMaxWidth()
            .clip(RoundedCornerShape(12.dp))
            .background(PaseoColors.surface1)
            .border(1.dp, PaseoColors.destructive.copy(alpha = 0.45f), RoundedCornerShape(12.dp))
            .padding(horizontal = 10.dp, vertical = 7.dp),
      ) {
        Text(
          text = entry.text,
          color = PaseoColors.destructive,
          fontSize = 11.sp,
          lineHeight = 15.sp,
        )
      }

    // A kind this build doesn't know. Render the words plainly and muted: unstyled
    // text is a far better failure than a hole in the conversation.
    TranscriptKind.Unknown ->
      Text(
        text = entry.text,
        color = PaseoColors.foregroundMuted,
        fontSize = 11.5.sp,
        lineHeight = 15.sp,
        modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp),
      )
  }
}

/**
 * Reply and, when there is something to stop, Stop.
 *
 * Stop is 38dp against Reply's 52dp and sits 20dp away — far enough that a thumb
 * aimed at Reply cannot land on it, where the old side-by-side 52dp pair left about
 * 10dp between two equally-weighted targets. Stop keeps the muted surface it always
 * had; the size and the distance are what changed.
 */
@Composable
private fun AgentActions(agent: AgentSession, onReply: () -> Unit, onStop: () -> Unit) {
  Row(
    modifier = Modifier.fillMaxWidth().padding(top = 10.dp),
    horizontalArrangement = Arrangement.Center,
    verticalAlignment = Alignment.Top,
  ) {
    ActionButton(
      label = "Reply",
      primary = true,
      onClick = onReply,
      content = { MicGlyph(tint = Color.White) },
    )
    if (agent.state == ActivityState.Running) {
      Spacer(Modifier.width(20.dp))
      ActionButton(
        label = "Stop",
        primary = false,
        onClick = onStop,
        size = 38,
        // Centers the smaller face against Reply's: (52 - 38) / 2.
        modifier = Modifier.padding(top = 7.dp),
        content = { StopGlyph(tint = PaseoColors.foregroundMuted, size = 15) },
      )
    }
  }
}

private fun statusText(agent: AgentSession): String =
  when (agent.state) {
    ActivityState.NeedsInput -> "needs approval"
    ActivityState.Running -> "running ${agent.age}"
    ActivityState.Idle -> "idle ${agent.age}"
  }

/** Round icon button with a caption, at whatever weight the screen calls for. */
@Composable
fun ActionButton(
  label: String,
  primary: Boolean,
  onClick: () -> Unit,
  modifier: Modifier = Modifier,
  size: Int = 52,
  content: @Composable () -> Unit,
) {
  Column(modifier = modifier, horizontalAlignment = Alignment.CenterHorizontally) {
    Button(
      onClick = onClick,
      colors =
        ButtonDefaults.buttonColors(
          backgroundColor = if (primary) PaseoColors.accent else PaseoColors.surface2,
        ),
      modifier = Modifier.size(size.dp),
    ) {
      content()
    }
    Spacer(Modifier.height(5.dp))
    Text(
      text = label,
      color = PaseoColors.foregroundExtraMuted,
      // Track the button: a de-emphasised action shouldn't carry a full-weight label.
      fontSize = if (size >= 52) 10.sp else 9.sp,
      textAlign = TextAlign.Center,
    )
  }
}

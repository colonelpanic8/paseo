package sh.paseo.watch.ui

import android.app.Activity
import android.content.Intent
import android.speech.RecognizerIntent
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.foundation.lazy.ScalingLazyColumn
import androidx.wear.compose.foundation.lazy.ScalingLazyListState
import androidx.wear.compose.foundation.lazy.items
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.Chip
import androidx.wear.compose.material.ChipDefaults
import androidx.wear.compose.material.Text
import sh.paseo.watch.theme.PaseoColors

/**
 * Canned replies. Hardcoded in v1; the open question of whether these become
 * phone-configurable is tracked in design/README.md.
 *
 * These exist because they are strictly faster than voice for the most common
 * responses, and they work in a quiet room or a loud one.
 */
private val CANNED_REPLIES =
  listOf(
    "Yes, continue",
    "Looks good — ship it",
    "Stop and explain first",
  )

/**
 * Reply composer.
 *
 * Voice is Google's on-device recognizer via [RecognizerIntent], which is free,
 * works offline on Wear OS 3+, and returns a finished string — no audio ever
 * touches our code. Typing goes through the same system sheet's keyboard affordance
 * on watches that offer one, and falls back to the on-screen IME.
 *
 * Paseo's own daemon-side dictation (`dictation_stream_*`) is deliberately unused
 * here: with a phone-tethered transport, streaming PCM off the watch is a bad trade
 * against a free on-device recognizer. See design/README.md.
 */
@Composable
fun ReplyScreen(
  title: String,
  projectKey: String,
  projectName: String,
  workspaceName: String,
  listState: ScalingLazyListState,
  onSubmit: (String) -> Unit,
) {
  val voiceLauncher =
    rememberLauncherForActivityResult(ActivityResultContracts.StartActivityForResult()) { result ->
      if (result.resultCode == Activity.RESULT_OK) {
        val spoken =
          result.data
            ?.getStringArrayListExtra(RecognizerIntent.EXTRA_RESULTS)
            ?.firstOrNull()
            ?.trim()
        if (!spoken.isNullOrEmpty()) {
          onSubmit(spoken)
        }
      }
    }

  fun launchVoice(forceKeyboard: Boolean) {
    val intent =
      Intent(RecognizerIntent.ACTION_RECOGNIZE_SPEECH).apply {
        putExtra(
          RecognizerIntent.EXTRA_LANGUAGE_MODEL,
          RecognizerIntent.LANGUAGE_MODEL_FREE_FORM,
        )
        putExtra(RecognizerIntent.EXTRA_PROMPT, title)
        // Prefer on-device recognition so this keeps working with no phone and no
        // network. The system falls back to network recognition when unavailable.
        putExtra(RecognizerIntent.EXTRA_PREFER_OFFLINE, true)
        if (forceKeyboard) {
          // Wear's input sheet opens straight to the keyboard when the caller asks
          // for it, which is what the keyboard affordance on this screen means.
          putExtra("android.speech.extra.GET_AUDIO", false)
          putExtra(RecognizerIntent.EXTRA_PARTIAL_RESULTS, false)
        }
      }
    voiceLauncher.launch(intent)
  }

  ScalingLazyColumn(
    modifier = Modifier.fillMaxWidth(),
    state = listState,
    // Top-anchored for the same reason as the workspace list: autoCentering would
    // spend the top third of the screen before the mic button appears.
    autoCentering = null,
    contentPadding = PaddingValues(start = 8.dp, top = 28.dp, end = 8.dp, bottom = 34.dp),
  ) {
    item {
      WorkspaceHeader(
        projectKey = projectKey,
        projectName = projectName,
        workspaceName = workspaceName,
        muted = true,
      )
    }
    item {
      Row(
        modifier = Modifier.padding(vertical = 6.dp),
        horizontalArrangement = Arrangement.spacedBy(14.dp),
      ) {
        Button(
          onClick = { launchVoice(forceKeyboard = false) },
          colors = ButtonDefaults.buttonColors(backgroundColor = PaseoColors.accent),
          modifier = Modifier.size(46.dp),
        ) {
          MicGlyph(tint = Color.White, size = 19)
        }
        Button(
          onClick = { launchVoice(forceKeyboard = true) },
          colors = ButtonDefaults.buttonColors(backgroundColor = PaseoColors.surface2),
          modifier = Modifier.size(46.dp),
        ) {
          KeyboardGlyph(tint = PaseoColors.foregroundMuted)
        }
      }
    }
    items(CANNED_REPLIES) { reply ->
      Chip(
        onClick = { onSubmit(reply) },
        modifier = Modifier.fillMaxWidth().height(40.dp),
        contentPadding = PaddingValues(horizontal = 12.dp, vertical = 2.dp),
        colors = ChipDefaults.chipColors(backgroundColor = PaseoColors.surface2),
        border = ChipDefaults.chipBorder(borderStroke = BorderStroke(0.dp, Color.Transparent)),
        label = {
          Text(
            text = reply,
            color = PaseoColors.foreground,
            fontSize = 12.sp,
            textAlign = TextAlign.Center,
            maxLines = 1,
            modifier = Modifier.fillMaxWidth(),
          )
        },
      )
      Spacer(Modifier.height(6.dp))
    }
  }
}

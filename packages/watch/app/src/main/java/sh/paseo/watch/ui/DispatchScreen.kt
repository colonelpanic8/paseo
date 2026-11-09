package sh.paseo.watch.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Button
import androidx.wear.compose.material.ButtonDefaults
import androidx.wear.compose.material.CircularProgressIndicator
import androidx.wear.compose.material.Text
import sh.paseo.watch.theme.PaseoColors

@Composable
fun DispatchScreen(
  state: DispatchScreenState,
  targetLabel: String?,
  onVoice: () -> Unit,
  onType: () -> Unit,
  onRetry: () -> Unit,
) {
  Column(
    modifier = Modifier.fillMaxSize().padding(horizontal = 28.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = Arrangement.Center,
  ) {
    Text(
      text = "Dispatch",
      color = PaseoColors.foreground,
      fontSize = 16.sp,
      fontWeight = FontWeight.Medium,
    )
    targetLabel?.let {
      Text(
        text = it,
        color = PaseoColors.foregroundMuted,
        fontSize = 10.5.sp,
        maxLines = 1,
      )
    }
    Spacer(Modifier.height(12.dp))

    when (state) {
      DispatchScreenState.Listening -> {
        Text(
          text = "Speak one task",
          color = PaseoColors.foregroundMuted,
          fontSize = 12.sp,
        )
        Spacer(Modifier.height(12.dp))
        InputActions(onVoice = onVoice, onType = onType)
      }
      DispatchScreenState.Sending -> {
        CircularProgressIndicator(
          modifier = Modifier.size(28.dp),
          indicatorColor = PaseoColors.accentBright,
          trackColor = PaseoColors.surface2,
          strokeWidth = 3.dp,
        )
        Spacer(Modifier.height(9.dp))
        Text(text = "Sending…", color = PaseoColors.foregroundMuted, fontSize = 12.sp)
      }
      is DispatchScreenState.Sent -> {
        CheckGlyph(tint = PaseoColors.accentBright, size = 30)
        Spacer(Modifier.height(8.dp))
        Text(
          text = state.message,
          color = PaseoColors.foreground,
          fontSize = 12.sp,
          textAlign = TextAlign.Center,
        )
      }
      is DispatchScreenState.Failed -> {
        WarningGlyph(tint = PaseoColors.destructive, size = 28)
        Spacer(Modifier.height(7.dp))
        Text(
          text = state.message,
          color = PaseoColors.destructive,
          fontSize = 11.5.sp,
          textAlign = TextAlign.Center,
          maxLines = 3,
        )
        Spacer(Modifier.height(10.dp))
        Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
          Button(
            onClick = onRetry,
            colors = ButtonDefaults.buttonColors(backgroundColor = PaseoColors.accent),
            modifier = Modifier.size(48.dp),
          ) {
            Text(text = "Retry", color = Color.White, fontSize = 10.sp)
          }
          Button(
            onClick = onType,
            colors = ButtonDefaults.buttonColors(backgroundColor = PaseoColors.surface2),
            modifier = Modifier.size(40.dp),
          ) {
            KeyboardGlyph(tint = PaseoColors.foregroundMuted, size = 17)
          }
        }
      }
    }
  }
}

@Composable
private fun InputActions(onVoice: () -> Unit, onType: () -> Unit) {
  Row(horizontalArrangement = Arrangement.spacedBy(12.dp), verticalAlignment = Alignment.CenterVertically) {
    Button(
      onClick = onVoice,
      colors = ButtonDefaults.buttonColors(backgroundColor = PaseoColors.accent),
      modifier = Modifier.size(50.dp),
    ) {
      MicGlyph(tint = Color.White, size = 20)
    }
    Button(
      onClick = onType,
      colors = ButtonDefaults.buttonColors(backgroundColor = PaseoColors.surface2),
      modifier = Modifier.size(40.dp),
    ) {
      KeyboardGlyph(tint = PaseoColors.foregroundMuted, size = 17)
    }
  }
}

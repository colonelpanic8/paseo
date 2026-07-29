package sh.paseo.watch.ui

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.wear.compose.material.Text
import sh.paseo.watch.theme.PaseoColors

/**
 * Shown when the watch has no snapshot yet.
 *
 * This is a setup-guidance screen, not an error. The likeliest cause is that the
 * phone app has never run since the watch app was installed, so the copy says what
 * to do rather than what went wrong.
 */
@Composable
fun WaitingScreen(message: String?) {
  Column(
    modifier = Modifier.fillMaxSize().padding(horizontal = 22.dp, vertical = 30.dp),
    horizontalAlignment = Alignment.CenterHorizontally,
    verticalArrangement = androidx.compose.foundation.layout.Arrangement.Center,
  ) {
    Text(
      text = "Paseo",
      color = PaseoColors.foreground,
      fontSize = 15.sp,
      fontWeight = FontWeight.Medium,
    )
    Spacer(Modifier.height(8.dp))
    Text(
      text = message ?: "Open Paseo on your phone to connect",
      color = PaseoColors.foregroundMuted,
      fontSize = 12.sp,
      lineHeight = 16.sp,
      textAlign = TextAlign.Center,
    )
  }
}

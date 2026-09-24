package sh.paseo.watch

import android.app.Activity
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.hapticfeedback.HapticFeedbackType
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalHapticFeedback
import androidx.lifecycle.lifecycleScope
import androidx.wear.compose.material.Scaffold
import androidx.wear.compose.material.TimeText
import androidx.wear.compose.material.Vignette
import androidx.wear.compose.material.VignettePosition
import java.util.UUID
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import sh.paseo.watch.data.DataLayerRepository
import sh.paseo.watch.data.MockWatchRepository
import sh.paseo.watch.data.WatchRepository
import sh.paseo.watch.theme.PaseoWatchTheme
import sh.paseo.watch.ui.DispatchScreen
import sh.paseo.watch.ui.DispatchScreenState
import sh.paseo.watch.ui.dispatchScreenState
import sh.paseo.watch.ui.rememberComposerLaunchers

/** Tile-launched, one-shot recognizer flow for the phone-configured Dispatch agent. */
class DispatchActivity : ComponentActivity() {
  private var dataLayer: DataLayerRepository? = null

  override fun onCreate(savedInstanceState: Bundle?) {
    super.onCreate(savedInstanceState)
    setTheme(android.R.style.Theme_DeviceDefault)

    if (USE_MOCK_DATA) {
      setContent { DispatchRoot(MockWatchRepository()) }
      return
    }

    val repository = DataLayerRepository(this, lifecycleScope)
    dataLayer = repository
    setContent { DispatchRoot(repository) }
  }

  override fun onStart() {
    super.onStart()
    dataLayer?.start()
  }

  override fun onStop() {
    dataLayer?.stop()
    super.onStop()
  }

  private companion object {
    const val USE_MOCK_DATA = false
  }
}

@androidx.compose.runtime.Composable
private fun DispatchRoot(repository: WatchRepository) {
  PaseoWatchTheme {
    val scope = rememberCoroutineScope()
    val context = LocalContext.current
    val haptics = LocalHapticFeedback.current
    val liveVoice by repository.liveVoice.collectAsState()
    var requestId by remember { mutableStateOf<String?>(null) }
    var submittedText by remember { mutableStateOf<String?>(null) }
    var deliveryFailed by remember { mutableStateOf(false) }
    var recognizerLaunched by remember { mutableStateOf(false) }
    var confirmedRequestId by remember { mutableStateOf<String?>(null) }

    fun submit(text: String) {
      val nextRequestId = UUID.randomUUID().toString()
      requestId = nextRequestId
      submittedText = text
      deliveryFailed = false
      scope.launch {
        if (!repository.dispatchPrompt(nextRequestId, text)) deliveryFailed = true
      }
    }

    val composer =
      rememberComposerLaunchers(
        prompt = "Dispatch a task",
        onText = ::submit,
      )
    val screenState =
      dispatchScreenState(
        requestId = requestId,
        submitted = submittedText != null,
        deliveryFailed = deliveryFailed,
        dispatch = liveVoice.dispatch,
      )

    LaunchedEffect(Unit) {
      if (!recognizerLaunched) {
        recognizerLaunched = true
        composer.launchVoice()
      }
    }

    LaunchedEffect(screenState, requestId) {
      if (screenState is DispatchScreenState.Sent && confirmedRequestId != requestId) {
        confirmedRequestId = requestId
        haptics.performHapticFeedback(HapticFeedbackType.LongPress)
        delay(1_400)
        (context as? Activity)?.finish()
      }
    }

    Scaffold(
      timeText = { TimeText() },
      vignette = { Vignette(vignettePosition = VignettePosition.TopAndBottom) },
    ) {
      DispatchScreen(
        state = screenState,
        targetLabel = liveVoice.dispatch?.label,
        onVoice = composer.launchVoice,
        onType = composer.launchText,
        onRetry = { submittedText?.let(::submit) ?: composer.launchVoice() },
      )
    }
  }
}

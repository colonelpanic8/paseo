package sh.paseo.watch.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import sh.paseo.watch.model.DispatchResult
import sh.paseo.watch.model.DispatchResultStatus
import sh.paseo.watch.model.DispatchState
import sh.paseo.watch.model.LiveVoiceState
import sh.paseo.watch.tile.DispatchTileMode
import sh.paseo.watch.tile.dispatchTileMode
import sh.paseo.watch.tile.statusLine

class DispatchStateTest {
  @Test
  fun `old phone hides Dispatch while configured and unconfigured phones map distinctly`() {
    assertEquals(DispatchTileMode.Hidden, dispatchTileMode(LiveVoiceState.Unknown))

    val disabled =
      LiveVoiceState.Unknown.copy(
        dispatch = DispatchState(configured = false, label = null, result = null),
      )
    assertEquals(DispatchTileMode.Disabled, dispatchTileMode(disabled))
    assertTrue(statusLine(disabled).contains("Set Dispatch on your phone"))

    val enabled =
      LiveVoiceState.Unknown.copy(
        dispatch = DispatchState(configured = true, label = "Chief", result = null),
      )
    assertEquals(DispatchTileMode.Enabled, dispatchTileMode(enabled))
  }

  @Test
  fun `screen waits for the matching phone acknowledgement`() {
    val stale =
      DispatchState(
        configured = true,
        label = "Chief",
        result =
          DispatchResult(
            requestId = "older",
            status = DispatchResultStatus.Success,
            message = "Sent",
          ),
      )

    assertEquals(
      DispatchScreenState.Sending,
      dispatchScreenState("current", submitted = true, deliveryFailed = false, dispatch = stale),
    )
  }

  @Test
  fun `screen maps success and retryable failures`() {
    val success =
      DispatchState(
        configured = true,
        label = "Chief",
        result =
          DispatchResult(
            requestId = "current",
            status = DispatchResultStatus.Success,
            message = "Sent to Chief",
          ),
      )
    assertEquals(
      DispatchScreenState.Sent("Sent to Chief"),
      dispatchScreenState("current", submitted = true, deliveryFailed = false, dispatch = success),
    )

    assertEquals(
      DispatchScreenState.Failed("Phone not reachable"),
      dispatchScreenState("current", submitted = true, deliveryFailed = true, dispatch = success),
    )
  }
}

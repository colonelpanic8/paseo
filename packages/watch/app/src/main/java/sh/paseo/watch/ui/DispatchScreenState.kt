package sh.paseo.watch.ui

import sh.paseo.watch.model.DispatchResultStatus
import sh.paseo.watch.model.DispatchState

sealed interface DispatchScreenState {
  data object Listening : DispatchScreenState

  data object Sending : DispatchScreenState

  data class Sent(val message: String) : DispatchScreenState

  data class Failed(val message: String) : DispatchScreenState
}

internal fun dispatchScreenState(
  requestId: String?,
  submitted: Boolean,
  deliveryFailed: Boolean,
  dispatch: DispatchState?,
): DispatchScreenState {
  if (deliveryFailed) return DispatchScreenState.Failed("Phone not reachable")
  if (!submitted || requestId == null) return DispatchScreenState.Listening

  val result = dispatch?.result?.takeIf { it.requestId == requestId }
    ?: return DispatchScreenState.Sending
  return when (result.status) {
    DispatchResultStatus.Success ->
      DispatchScreenState.Sent(
        result.message ?: dispatch.label?.let { "Sent to $it" } ?: "Prompt sent",
      )
    DispatchResultStatus.Failure ->
      DispatchScreenState.Failed(result.message ?: "Dispatch failed")
  }
}

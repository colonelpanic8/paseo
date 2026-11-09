package sh.paseo.watch.model

enum class DispatchResultStatus {
  Success,
  Failure,
}

data class DispatchResult(
  val requestId: String?,
  val status: DispatchResultStatus,
  val message: String?,
)

/** Null at the Live Voice boundary means the connected phone predates Dispatch. */
data class DispatchState(
  val configured: Boolean,
  val label: String?,
  val result: DispatchResult?,
)

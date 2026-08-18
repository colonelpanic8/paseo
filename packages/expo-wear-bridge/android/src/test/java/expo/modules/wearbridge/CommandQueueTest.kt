package expo.modules.wearbridge

import org.junit.Assert.assertEquals
import org.junit.Test

class CommandQueueTest {
  @Test
  fun `drain keeps fresh starts and permanent commands but discards stale starts`() {
    val nowMs = 1_000_000L
    val freshStart = """{"kind":"startLiveVoice","serverId":"srv-1"}"""
    val staleStart = """{"kind":"startLiveVoice","serverId":"srv-2"}"""
    val approval = """{"kind":"resolvePermission","requestId":"req-1","allow":true}"""
    val legacyPrompt = """{"kind":"sendPrompt","serverId":"srv-1","text":"continue"}"""
    val discardedAt = mutableListOf<Long?>()

    val drained =
      drainQueuedCommands(
        lines =
          listOf(
            encodeQueuedCommand(freshStart, nowMs - 59_000L),
            encodeQueuedCommand(staleStart, nowMs - 61_000L),
            encodeQueuedCommand(approval, nowMs - 86_400_000L),
            legacyPrompt,
            freshStart,
          ),
        nowMs = nowMs,
        onExpiredStart = discardedAt::add,
      )

    assertEquals(listOf(freshStart, approval, legacyPrompt), drained)
    assertEquals(listOf(nowMs - 61_000L, null), discardedAt)
  }
}

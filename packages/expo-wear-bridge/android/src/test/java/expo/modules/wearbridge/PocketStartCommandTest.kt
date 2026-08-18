package expo.modules.wearbridge

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class PocketStartCommandTest {
  @Test
  fun `accepts a start command with a strong request id`() {
    assertEquals(
      "12345678-1234-1234-1234-123456789abc",
      pocketStartRequestId(
        """{"v":1,"kind":"startLiveVoice","serverId":"srv-1","pocketStartRequestId":"12345678-1234-1234-1234-123456789abc"}""",
      ),
    )
  }

  @Test
  fun `rejects malformed unrelated and weak requests`() {
    assertNull(pocketStartRequestId("not json"))
    assertNull(
      pocketStartRequestId(
        """{"v":1,"kind":"stopLiveVoice","pocketStartRequestId":"12345678-1234-1234-1234-123456789abc"}""",
      ),
    )
    assertNull(
      pocketStartRequestId(
        """{"v":1,"kind":"startLiveVoice","pocketStartRequestId":"short"}""",
      ),
    )
  }
}

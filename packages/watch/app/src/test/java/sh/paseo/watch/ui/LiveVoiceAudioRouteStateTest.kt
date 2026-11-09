package sh.paseo.watch.ui

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import sh.paseo.watch.model.LiveVoiceAudioRoute
import sh.paseo.watch.model.LiveVoiceAudioRouteKind
import sh.paseo.watch.model.LiveVoiceHost
import sh.paseo.watch.model.LiveVoicePhase
import sh.paseo.watch.model.LiveVoiceState
import sh.paseo.watch.model.audioRouteGlance
import sh.paseo.watch.model.nextAudioRoute
import sh.paseo.watch.tile.statusLine

class LiveVoiceAudioRouteStateTest {
  private val earbuds =
    LiveVoiceAudioRoute("android:7", "Pixel Buds Pro", LiveVoiceAudioRouteKind.Earbuds)
  private val watch =
    LiveVoiceAudioRoute("android:8", "Pixel Watch 3", LiveVoiceAudioRouteKind.Watch)

  @Test
  fun `screen cycles through the phone candidate order`() {
    val state = state(active = earbuds, candidates = listOf(earbuds, watch))
    assertEquals(watch, state.nextAudioRoute())
    assertEquals(earbuds, state.copy(activeAudioRoute = watch).nextAudioRoute())
    assertNull(state.copy(audioRouteCandidates = listOf(earbuds)).nextAudioRoute())
  }

  @Test
  fun `tile maps route kinds to a glance label`() {
    assertEquals("🎧 Pixel Buds Pro", state(earbuds, listOf(earbuds, watch)).audioRouteGlance())
    assertEquals(
      "On call · workstation\n⌚ Pixel Watch 3",
      statusLine(state(watch, listOf(earbuds, watch))),
    )
  }

  private fun state(
    active: LiveVoiceAudioRoute,
    candidates: List<LiveVoiceAudioRoute>,
  ): LiveVoiceState =
    LiveVoiceState.Unknown.copy(
      phase = LiveVoicePhase.Active,
      hostLabel = "workstation",
      hosts = listOf(LiveVoiceHost("srv-1", "workstation")),
      activeAudioRoute = active,
      audioRouteCandidates = candidates,
    )
}

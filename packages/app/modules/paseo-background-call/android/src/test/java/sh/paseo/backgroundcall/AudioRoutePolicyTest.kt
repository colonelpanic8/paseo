package sh.paseo.backgroundcall

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class AudioRoutePolicyTest {
    @Test
    fun `non-watch bluetooth wins over a connected watch`() {
        val watch = option("watch", AudioRouteKind.Watch, AudioRouteClass.Bluetooth)
        val earbuds = option("buds", AudioRouteKind.Earbuds, AudioRouteClass.Bluetooth)
        assertEquals(earbuds, choosePreferredAudioRoute(listOf(watch, earbuds)))
    }

    @Test
    fun `an explicit route wins while it remains a candidate`() {
        val speaker = option("speaker", AudioRouteKind.Speaker, AudioRouteClass.Speaker)
        val earbuds = option("buds", AudioRouteKind.Earbuds, AudioRouteClass.Bluetooth)
        assertEquals(speaker, choosePreferredAudioRoute(listOf(speaker, earbuds), "speaker"))
    }

    @Test
    fun `wear node matching is case punctuation and prefix insensitive`() {
        assertEquals(
            "Google Pixel Watch 3",
            matchingWearNodeName("Pixel Watch 3", listOf("Google Pixel Watch 3")),
        )
        assertNull(matchingWearNodeName("Pixel Buds Pro", listOf("Google Pixel Watch 3")))
    }

    private fun option(
        id: String,
        kind: AudioRouteKind,
        routeClass: AudioRouteClass,
    ) = AudioRouteOption(id, id, kind, routeClass, 0)
}

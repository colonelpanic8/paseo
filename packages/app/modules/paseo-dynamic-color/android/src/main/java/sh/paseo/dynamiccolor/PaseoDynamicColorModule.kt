package sh.paseo.dynamiccolor

import android.content.Context
import android.os.Build
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

// Android names its dynamic color resources by "shade" — system_neutral1_0 is white and
// system_neutral1_1000 is black — while Material (and the JS side) works in tones, where
// 0 is black and 100 is white. The conversion belongs here, next to the resource names:
// JS never sees a shade.
private val SHADES = intArrayOf(0, 10, 50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000)

private val LADDERS = listOf("neutral1", "neutral2", "accent1")

class PaseoDynamicColorModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaseoDynamicColor")

    // Null on Android 11 and below, where the wallpaper palette does not exist. Callers
    // treat null as "no dynamic color on this device" and fall back to a static theme.
    Function("getPalette") {
      if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) {
        return@Function null
      }
      val context = appContext.reactContext?.applicationContext ?: return@Function null
      LADDERS.associateWith { ladder -> readLadder(context, ladder) }
    }
  }
}

private fun readLadder(context: Context, ladder: String): Map<String, String> {
  val resources = context.resources
  val tones = mutableMapOf<String, String>()
  for (shade in SHADES) {
    val id = resources.getIdentifier("system_${ladder}_$shade", "color", "android")
    if (id == 0) {
      continue
    }
    val tone = (1000 - shade) / 10
    tones[tone.toString()] = String.format("#%06X", context.getColor(id) and 0xFFFFFF)
  }
  return tones
}

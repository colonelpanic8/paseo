package expo.modules.paseoterminal

import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

class PaseoTerminalModule : Module() {
  override fun definition() = ModuleDefinition {
    Name("PaseoTerminalSurface")

    // Bumped when native hardware-keyboard handling changes; surfaced in the JS debug
    // logs so a stale native binary is distinguishable from a broken key pipeline.
    Constants(
      "hardwareKeyRevision" to 3,
    )

    View(PaseoTerminalView::class) {
      Prop("terminalKey") { view: PaseoTerminalView, terminalKey: String ->
        view.terminalKey = terminalKey
      }

      Prop("initialBuffer") { view: PaseoTerminalView, initialBuffer: String ->
        view.initialBuffer = initialBuffer
      }

      Prop("fontSize") { view: PaseoTerminalView, fontSize: Double ->
        view.fontSize = fontSize.toFloat()
      }

      Prop("focusRequest") { view: PaseoTerminalView, focusRequest: Double ->
        view.focusRequest = focusRequest
      }

      Prop("autoFocus") { view: PaseoTerminalView, autoFocus: Boolean ->
        view.autoFocus = autoFocus
      }

      Prop("swipeGesturesEnabled") { view: PaseoTerminalView, enabled: Boolean ->
        view.swipeGesturesEnabled = enabled
      }

      Prop("appearanceScheme") { view: PaseoTerminalView, appearanceScheme: String ->
        view.appearanceScheme = appearanceScheme
      }

      Prop("themeConfig") { view: PaseoTerminalView, themeConfig: String ->
        view.themeConfig = themeConfig
      }

      Prop("backgroundColor") { view: PaseoTerminalView, backgroundColor: String ->
        view.backgroundColorHex = backgroundColor
      }

      Prop("foregroundColor") { view: PaseoTerminalView, foregroundColor: String ->
        view.foregroundColorHex = foregroundColor
      }

      Prop("mutedForegroundColor") { view: PaseoTerminalView, mutedForegroundColor: String ->
        view.mutedForegroundColorHex = mutedForegroundColor
      }

      AsyncFunction("write") { view: PaseoTerminalView, data: String ->
        view.write(data)
      }

      AsyncFunction("replaceBuffer") { view: PaseoTerminalView, data: String ->
        view.replaceBuffer(data)
      }

      AsyncFunction("clear") { view: PaseoTerminalView ->
        view.clear()
      }

      AsyncFunction("focus") { view: PaseoTerminalView ->
        view.focus()
      }

      AsyncFunction("blur") { view: PaseoTerminalView ->
        view.blur()
      }

      AsyncFunction("refresh") { view: PaseoTerminalView ->
        view.refresh()
      }

      Events(
        "onInput",
        "onTerminalKey",
        "onResize",
        "onFocus",
        "onSwipeLeft",
        "onSwipeRight",
        "onSurfaceCreationError",
      )

      OnViewDestroys { view: PaseoTerminalView ->
        view.cleanup()
      }
    }
  }
}

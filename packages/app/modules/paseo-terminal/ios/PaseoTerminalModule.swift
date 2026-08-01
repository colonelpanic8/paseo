import ExpoModulesCore

public class PaseoTerminalModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PaseoTerminalSurface")

    // Bumped when native hardware-keyboard handling changes; surfaced in the JS debug
    // logs so a stale native binary is distinguishable from a broken key pipeline.
    Constants([
      "hardwareKeyRevision": 3,
    ])

    View(PaseoTerminalView.self) {
      Prop("terminalKey") { (view: PaseoTerminalView, terminalKey: String) in
        view.terminalKey = terminalKey
      }

      Prop("initialBuffer") { (view: PaseoTerminalView, initialBuffer: String) in
        view.initialBuffer = initialBuffer
      }

      Prop("fontSize") { (view: PaseoTerminalView, fontSize: Double) in
        view.fontSize = CGFloat(fontSize)
      }

      Prop("focusRequest") { (view: PaseoTerminalView, focusRequest: Double) in
        view.focusRequest = focusRequest
      }

      Prop("autoFocus") { (view: PaseoTerminalView, autoFocus: Bool) in
        view.autoFocus = autoFocus
      }

      Prop("swipeGesturesEnabled") { (view: PaseoTerminalView, enabled: Bool) in
        view.swipeGesturesEnabled = enabled
      }

      Prop("appearanceScheme") { (view: PaseoTerminalView, appearanceScheme: String) in
        view.appearanceScheme = appearanceScheme
      }

      Prop("themeConfig") { (view: PaseoTerminalView, themeConfig: String) in
        view.themeConfig = themeConfig
      }

      Prop("backgroundColor") { (view: PaseoTerminalView, backgroundColor: String) in
        view.backgroundColorHex = backgroundColor
      }

      Prop("foregroundColor") { (view: PaseoTerminalView, foregroundColor: String) in
        view.foregroundColorHex = foregroundColor
      }

      Prop("mutedForegroundColor") { (view: PaseoTerminalView, mutedForegroundColor: String) in
        view.mutedForegroundColorHex = mutedForegroundColor
      }

      AsyncFunction("write") { (view: PaseoTerminalView, data: String) in
        view.write(data)
      }

      AsyncFunction("replaceBuffer") { (view: PaseoTerminalView, data: String) in
        view.replaceBuffer(data)
      }

      AsyncFunction("clear") { (view: PaseoTerminalView) in
        view.clear()
      }

      AsyncFunction("focus") { (view: PaseoTerminalView) in
        view.focus()
      }

      AsyncFunction("blur") { (view: PaseoTerminalView) in
        view.blur()
      }

      AsyncFunction("refresh") { (view: PaseoTerminalView) in
        view.refresh()
      }

      Events(
        "onInput",
        "onTerminalKey",
        "onResize",
        "onFocus",
        "onSwipeLeft",
        "onSwipeRight",
        "onSurfaceCreationError"
      )
    }
  }
}

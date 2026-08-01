import ExpoModulesCore
import Foundation
import GhosttyKit
import QuartzCore
import UIKit

private enum GhosttyRuntime {
  private static let lock = NSLock()
  private static var initialized = false

  static func ensureInitialized() -> Bool {
    lock.lock()
    defer { lock.unlock() }

    if initialized {
      return true
    }

    let result = ghostty_init(0, nil)
    initialized = result == GHOSTTY_SUCCESS
    return initialized
  }
}

/// Encodes hardware-keyboard combos that UITextField never surfaces through its
/// text-editing delegate (control combos, Escape, Tab, arrow keys) into the byte
/// sequences a terminal expects.
///
/// Capture uses UIKeyCommand with `wantsPriorityOverSystemBehavior` rather than
/// `pressesBegan`: while a text field is first responder, iPadOS routes hardware key
/// events through the text-input system, which can consume presses before they reach
/// responder press callbacks. Registered key commands are matched deterministically
/// before that happens.
private enum TerminalHardwareKeyEncoder {
  /// Characters that produce a control byte when combined with Ctrl.
  private static let controlInputs = "abcdefghijklmnopqrstuvwxyz@[\\]^_-? "

  static func makeKeyCommands(action: Selector) -> [UIKeyCommand] {
    var commands: [UIKeyCommand] = []

    let specialInputs = [
      UIKeyCommand.inputEscape,
      UIKeyCommand.inputUpArrow,
      UIKeyCommand.inputDownArrow,
      UIKeyCommand.inputLeftArrow,
      UIKeyCommand.inputRightArrow,
      "\t",
    ]
    for input in specialInputs {
      commands.append(makeCommand(input: input, modifierFlags: [], action: action))
    }
    commands.append(makeCommand(input: "\t", modifierFlags: .shift, action: action))

    for character in controlInputs {
      commands.append(makeCommand(input: String(character), modifierFlags: .control, action: action))
      commands.append(
        makeCommand(input: String(character), modifierFlags: [.control, .shift], action: action)
      )
    }

    return commands
  }

  private static func makeCommand(
    input: String,
    modifierFlags: UIKeyModifierFlags,
    action: Selector
  ) -> UIKeyCommand {
    let command = UIKeyCommand(input: input, modifierFlags: modifierFlags, action: action)
    command.wantsPriorityOverSystemBehavior = true
    return command
  }

  static func sequence(input: String, modifiers: UIKeyModifierFlags) -> String? {
    switch input {
    case UIKeyCommand.inputEscape:
      return "\u{1B}"
    case UIKeyCommand.inputUpArrow:
      return "\u{1B}[A"
    case UIKeyCommand.inputDownArrow:
      return "\u{1B}[B"
    case UIKeyCommand.inputRightArrow:
      return "\u{1B}[C"
    case UIKeyCommand.inputLeftArrow:
      return "\u{1B}[D"
    case "\t":
      return modifiers.contains(.shift) ? "\u{1B}[Z" : "\t"
    default:
      break
    }

    guard modifiers.contains(.control) else { return nil }
    guard let scalar = input.lowercased().unicodeScalars.first else { return nil }
    return controlSequence(for: scalar)
  }

  private static func controlSequence(for scalar: Unicode.Scalar) -> String? {
    switch scalar {
    case "a"..."z":
      // Ctrl+A..Z -> 0x01..0x1A (Ctrl+C = ETX, Ctrl+Z = SUB, ...).
      return UnicodeScalar(scalar.value - 96).map(String.init)
    case " ", "@":
      return "\u{00}"
    case "[":
      return "\u{1B}"
    case "\\":
      return "\u{1C}"
    case "]":
      return "\u{1D}"
    case "^":
      return "\u{1E}"
    case "_", "-":
      return "\u{1F}"
    case "?":
      return "\u{7F}"
    default:
      return nil
    }
  }
}

private enum TerminalInputSequence {
  /// Terminal Enter is carriage return. Sending line feed instead is Ctrl+J,
  /// which raw-mode TUIs may interpret as the literal J key.
  static let carriageReturn = "\r"

  static func normalizingReturn(_ input: String) -> String {
    switch input {
    case "\n", "\r\n":
      return carriageReturn
    default:
      return input
    }
  }
}

private final class TerminalInputField: UITextField {
  var onDeleteBackward: (() -> Void)?
  var onInsert: ((String) -> Void)?

  private static let hardwareKeyCommands = TerminalHardwareKeyEncoder.makeKeyCommands(
    action: #selector(handleHardwareKeyCommand(_:))
  )

  override var keyCommands: [UIKeyCommand]? {
    Self.hardwareKeyCommands
  }

  override func deleteBackward() {
    onDeleteBackward?()
    super.deleteBackward()
  }

  @objc
  private func handleHardwareKeyCommand(_ command: UIKeyCommand) {
    guard let input = command.input else { return }
    guard let sequence = TerminalHardwareKeyEncoder.sequence(
      input: input,
      modifiers: command.modifierFlags
    ) else { return }
    onInsert?(sequence)
  }
}

private enum TerminalAppearanceScheme: String {
  case light
  case dark

  init(value: String) {
    self = TerminalAppearanceScheme(rawValue: value) ?? .dark
  }

  var ghosttyColorScheme: ghostty_color_scheme_e {
    switch self {
    case .light:
      return GHOSTTY_COLOR_SCHEME_LIGHT
    case .dark:
      return GHOSTTY_COLOR_SCHEME_DARK
    }
  }
}

private extension UIColor {
  convenience init(hexString: String) {
    let sanitized = hexString.replacingOccurrences(of: "#", with: "")
    let value = Int(sanitized, radix: 16) ?? 0
    self.init(
      red: CGFloat((value >> 16) & 0xFF) / 255,
      green: CGFloat((value >> 8) & 0xFF) / 255,
      blue: CGFloat(value & 0xFF) / 255,
      alpha: 1
    )
  }
}

public final class PaseoTerminalView: ExpoView, UITextFieldDelegate {
  private static let minimumVerticalScrollStepPoints: CGFloat = 18
  private static let verticalScrollStepMultiplier: CGFloat = 1.15

  private let terminalViewport = UIView()
  private let inputField = TerminalInputField()
  private let focusTapGesture = UITapGestureRecognizer()
  private let scrollPanGesture = UIPanGestureRecognizer()
  private var lastViewportSize: CGSize = .zero
  private var lastContentScale: CGFloat = 0
  private var lastReportedGrid: (cols: Int, rows: Int)?
  private var lastAppliedBuffer = ""
  private var hasIncrementalOutput = false
  private var pendingVerticalScrollPoints: CGFloat = 0
  private var totalPanX: CGFloat = 0
  private var totalPanY: CGFloat = 0
  private var app: ghostty_app_t?
  private var surface: ghostty_surface_t?
  private var isCreatingSurface = false
  private var surfaceCreationFailed = false
  private var appearance = TerminalAppearanceScheme.dark
  private var backgroundColorValue = UIColor(hexString: "#24292e")

  let onInput = EventDispatcher()
  let onTerminalKey = EventDispatcher()
  let onResize = EventDispatcher()
  let onFocus = EventDispatcher()
  let onSwipeLeft = EventDispatcher()
  let onSwipeRight = EventDispatcher()
  let onSurfaceCreationError = EventDispatcher()

  var terminalKey: String = "" {
    didSet {
      accessibilityIdentifier = "paseo-terminal-\(terminalKey)"
      if oldValue != terminalKey {
        resetSurface()
      }
    }
  }

  var initialBuffer: String = "" {
    didSet {
      applyRemoteBuffer(initialBuffer)
    }
  }

  var fontSize: CGFloat = 10 {
    didSet {
      guard oldValue != fontSize else { return }
      inputField.font = UIFont.monospacedSystemFont(ofSize: max(fontSize, 13), weight: .regular)
      updateSurfaceConfiguration()
    }
  }

  var focusRequest: Double = 0 {
    didSet {
      guard oldValue != focusRequest else { return }
      DispatchQueue.main.async { [weak self] in
        self?.requestKeyboardFocus()
      }
    }
  }

  var autoFocus = true {
    didSet {
      guard oldValue != autoFocus else { return }
      if autoFocus {
        requestKeyboardFocus()
      } else {
        inputField.resignFirstResponder()
      }
    }
  }

  var swipeGesturesEnabled = false

  var appearanceScheme: String = TerminalAppearanceScheme.dark.rawValue {
    didSet {
      guard oldValue != appearanceScheme else { return }
      appearance = TerminalAppearanceScheme(value: appearanceScheme)
      if let app {
        ghostty_app_set_color_scheme(app, appearance.ghosttyColorScheme)
      }
      if let surface {
        ghostty_surface_set_color_scheme(surface, appearance.ghosttyColorScheme)
        redrawSurface()
      }
    }
  }

  var themeConfig: String = "" {
    didSet {
      guard oldValue != themeConfig else { return }
      updateSurfaceConfiguration()
    }
  }

  var backgroundColorHex: String = "#24292e" {
    didSet {
      backgroundColorValue = UIColor(hexString: backgroundColorHex)
      applyTheme()
    }
  }

  var foregroundColorHex: String = "#d1d5da"
  var mutedForegroundColorHex: String = "#959da5"

  public required init(appContext: AppContext? = nil) {
    super.init(appContext: appContext)

    applyTheme()
    clipsToBounds = true
    contentScaleFactor = UIScreen.main.scale

    terminalViewport.clipsToBounds = true
    terminalViewport.contentScaleFactor = contentScaleFactor
    terminalViewport.translatesAutoresizingMaskIntoConstraints = false
    terminalViewport.isUserInteractionEnabled = true

    inputField.delegate = self
    inputField.backgroundColor = UIColor.clear
    inputField.textColor = UIColor.clear
    inputField.tintColor = UIColor.clear
    inputField.font = UIFont.monospacedSystemFont(ofSize: max(fontSize, 13), weight: .regular)
    inputField.placeholder = ""
    inputField.autocorrectionType = .no
    inputField.autocapitalizationType = .none
    inputField.spellCheckingType = .no
    inputField.smartDashesType = .no
    inputField.smartQuotesType = .no
    inputField.returnKeyType = .send
    inputField.keyboardType = .asciiCapable
    inputField.enablesReturnKeyAutomatically = false
    inputField.translatesAutoresizingMaskIntoConstraints = false
    inputField.alpha = 0.02
    inputField.isAccessibilityElement = false
    inputField.accessibilityElementsHidden = true
    inputField.addTarget(self, action: #selector(handleInputEditingDidBegin), for: .editingDidBegin)
    inputField.onDeleteBackward = { [weak self] in
      self?.emitInput("\u{7F}")
    }
    inputField.onInsert = { [weak self] data in
      self?.emitInput(data)
    }

    focusTapGesture.addTarget(self, action: #selector(handleViewportTap))
    terminalViewport.addGestureRecognizer(focusTapGesture)
    scrollPanGesture.addTarget(self, action: #selector(handleViewportPan(_:)))
    scrollPanGesture.maximumNumberOfTouches = 1
    scrollPanGesture.cancelsTouchesInView = false
    terminalViewport.addGestureRecognizer(scrollPanGesture)

    addSubview(terminalViewport)
    addSubview(inputField)

    NSLayoutConstraint.activate([
      terminalViewport.leadingAnchor.constraint(equalTo: leadingAnchor),
      terminalViewport.trailingAnchor.constraint(equalTo: trailingAnchor),
      terminalViewport.topAnchor.constraint(equalTo: topAnchor),
      terminalViewport.bottomAnchor.constraint(equalTo: bottomAnchor),

      inputField.trailingAnchor.constraint(equalTo: trailingAnchor),
      inputField.topAnchor.constraint(equalTo: bottomAnchor, constant: 8),
      inputField.widthAnchor.constraint(equalToConstant: 1),
      inputField.heightAnchor.constraint(equalToConstant: 1),
    ])
  }

  deinit {
    destroySurface()
  }

  func write(_ data: String) {
    guard !data.isEmpty else { return }
    feedData(Data(data.utf8))
    hasIncrementalOutput = true
  }

  func replaceBuffer(_ data: String) {
    initialBuffer = data
  }

  func clear() {
    replaceBuffer("")
  }

  func focus() {
    requestKeyboardFocus()
  }

  func blur() {
    inputField.resignFirstResponder()
  }

  func refresh() {
    resizeSurface()
  }

  public override func layoutSubviews() {
    super.layoutSubviews()
    updateContentScale()

    let viewportSize = terminalViewport.bounds.size
    if surface == nil {
      createSurfaceIfPossible()
    }

    guard viewportSize != lastViewportSize || contentScaleFactor != lastContentScale else {
      return
    }

    lastViewportSize = viewportSize
    lastContentScale = contentScaleFactor
    resizeSurface()
  }

  public override func didMoveToWindow() {
    super.didMoveToWindow()

    guard window != nil, autoFocus else { return }
    DispatchQueue.main.async { [weak self] in
      self?.requestKeyboardFocus()
    }
  }

  public func textField(_ textField: UITextField, shouldChangeCharactersIn range: NSRange, replacementString string: String) -> Bool {
    if !string.isEmpty {
      // Some software keyboards deliver Return through this delegate instead of
      // textFieldShouldReturn, so normalize that path too.
      emitInput(TerminalInputSequence.normalizingReturn(string))
      return false
    }

    return false
  }

  public func textFieldShouldReturn(_ textField: UITextField) -> Bool {
    emitInput(TerminalInputSequence.carriageReturn)
    textField.text = ""
    return false
  }

  @objc
  private func handleViewportTap() {
    requestKeyboardFocus()
  }

  @objc
  private func handleViewportPan(_ gesture: UIPanGestureRecognizer) {
    guard let surface else { return }

    let location = gesture.location(in: terminalViewport)
    ghostty_surface_mouse_pos(
      surface,
      Double(location.x * contentScaleFactor),
      Double(location.y * contentScaleFactor),
      GHOSTTY_MODS_NONE
    )

    switch gesture.state {
    case .began:
      pendingVerticalScrollPoints = 0
      totalPanX = 0
      totalPanY = 0
      gesture.setTranslation(.zero, in: terminalViewport)
    case .changed:
      let translation = gesture.translation(in: terminalViewport)
      totalPanX += translation.x
      totalPanY += translation.y
      let stepSize = max(
        fontSize * Self.verticalScrollStepMultiplier,
        Self.minimumVerticalScrollStepPoints
      )
      let totalVerticalPoints = pendingVerticalScrollPoints + translation.y
      let verticalSteps = Int(totalVerticalPoints / stepSize)
      pendingVerticalScrollPoints = totalVerticalPoints - (CGFloat(verticalSteps) * stepSize)

      guard verticalSteps != 0 else {
        gesture.setTranslation(.zero, in: terminalViewport)
        return
      }

      ghostty_surface_mouse_scroll(surface, 0, Double(verticalSteps), 0)
      redrawSurface()
      gesture.setTranslation(.zero, in: terminalViewport)
    default:
      if gesture.state == .ended, swipeGesturesEnabled,
        abs(totalPanX) >= 22, abs(totalPanX) > abs(totalPanY) * 1.2
      {
        if totalPanX > 0 {
          onSwipeRight([:])
        } else {
          onSwipeLeft([:])
        }
      }
      pendingVerticalScrollPoints = 0
      totalPanX = 0
      totalPanY = 0
      gesture.setTranslation(.zero, in: terminalViewport)
    }
  }

  @objc
  private func handleInputEditingDidBegin() {
    textInputModeDidChange()
  }

  private func createSurfaceIfPossible() {
    guard surface == nil, app == nil, !isCreatingSurface, !surfaceCreationFailed else { return }
    guard terminalViewport.bounds.width > 0, terminalViewport.bounds.height > 0 else { return }
    guard GhosttyRuntime.ensureInitialized() else {
      failSurfaceCreation()
      return
    }

    isCreatingSurface = true
    defer { isCreatingSurface = false }

    var runtimeConfig = ghostty_runtime_config_s(
      userdata: Unmanaged.passUnretained(self).toOpaque(),
      supports_selection_clipboard: false,
      wakeup_cb: { _ in },
      action_cb: { _, _, _ in false },
      read_clipboard_cb: { _, _, _ in false },
      confirm_read_clipboard_cb: { _, _, _, _ in },
      write_clipboard_cb: { _, _, _, _, _ in },
      close_surface_cb: { _, _ in }
    )

    guard let config = ghostty_config_new() else {
      failSurfaceCreation()
      return
    }
    loadThemeConfig(into: config)
    ghostty_config_finalize(config)
    defer { ghostty_config_free(config) }

    guard let createdApp = ghostty_app_new(&runtimeConfig, config) else {
      failSurfaceCreation()
      return
    }

    var surfaceConfig = ghostty_surface_config_new()
    surfaceConfig.platform_tag = GHOSTTY_PLATFORM_IOS
    surfaceConfig.platform.ios.uiview = Unmanaged.passUnretained(terminalViewport).toOpaque()
    surfaceConfig.userdata = Unmanaged.passUnretained(self).toOpaque()
    surfaceConfig.scale_factor = Double(contentScaleFactor)
    surfaceConfig.font_size = Float(fontSize)
    surfaceConfig.context = GHOSTTY_SURFACE_CONTEXT_WINDOW
    surfaceConfig.use_custom_io = true

    guard let createdSurface = ghostty_surface_new(createdApp, &surfaceConfig) else {
      ghostty_app_free(createdApp)
      failSurfaceCreation()
      return
    }

    app = createdApp
    surface = createdSurface
    ghostty_app_set_color_scheme(createdApp, appearance.ghosttyColorScheme)
    ghostty_surface_set_color_scheme(createdSurface, appearance.ghosttyColorScheme)
    resizeSurface()
    feedBuffer(initialBuffer)
  }

  private func failSurfaceCreation() {
    surfaceCreationFailed = true
    onSurfaceCreationError([:])
  }

  private func resetSurface() {
    destroySurface()
    lastAppliedBuffer = ""
    hasIncrementalOutput = false
    lastViewportSize = .zero
    lastContentScale = 0
    lastReportedGrid = nil
    surfaceCreationFailed = false
    setNeedsLayout()
  }

  private func destroySurface() {
    if let surface {
      ghostty_surface_set_write_callback(surface, nil, nil)
      ghostty_surface_free(surface)
    }
    if let app {
      ghostty_app_free(app)
    }
    surface = nil
    app = nil
  }

  private func applyRemoteBuffer(_ buffer: String) {
    guard surface != nil else {
      createSurfaceIfPossible()
      return
    }

    if !hasIncrementalOutput, buffer.hasPrefix(lastAppliedBuffer) {
      let suffix = String(buffer.dropFirst(lastAppliedBuffer.count))
      feedData(Data(suffix.utf8))
      lastAppliedBuffer = buffer
      return
    }

    resetSurface()
    createSurfaceIfPossible()
  }

  private func feedBuffer(_ buffer: String) {
    if !buffer.isEmpty {
      feedData(Data(buffer.utf8))
    }
    lastAppliedBuffer = buffer
    hasIncrementalOutput = false
  }

  private func feedData(_ data: Data) {
    guard let surface, !data.isEmpty else { return }

    data.withUnsafeBytes { buffer in
      guard let pointer = buffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
        return
      }
      ghostty_surface_feed_data(surface, pointer, buffer.count)
    }

    redrawSurface()
  }

  private func resizeSurface() {
    guard let surface else {
      emitEstimatedResize()
      return
    }

    let scale = contentScaleFactor
    let width = UInt32(max(floor(terminalViewport.bounds.width * scale), 1))
    let height = UInt32(max(floor(terminalViewport.bounds.height * scale), 1))

    terminalViewport.contentScaleFactor = scale
    ghostty_surface_set_content_scale(surface, Double(scale), Double(scale))
    ghostty_surface_set_size(surface, width, height)
    ghostty_surface_set_occlusion(surface, window != nil)
    configureIOSurfaceLayers()
    redrawSurface()
    emitGhosttyResize()
  }

  private func redrawSurface() {
    guard let surface else { return }
    ghostty_surface_refresh(surface)
    ghostty_surface_draw(surface)
    markIOSurfaceLayersForDisplay()
    emitGhosttyResize()
  }

  private func updateSurfaceConfiguration() {
    guard let app, let surface, let config = ghostty_config_new() else { return }
    loadThemeConfig(into: config)
    ghostty_config_finalize(config)
    ghostty_app_update_config(app, config)
    ghostty_surface_update_config(surface, config)
    ghostty_config_free(config)
    redrawSurface()
  }

  private func emitGhosttyResize() {
    guard let surface else {
      emitEstimatedResize()
      return
    }

    let size = ghostty_surface_size(surface)
    let cols = max(1, Int(size.columns))
    let rows = max(1, Int(size.rows))
    emitResize(cols: cols, rows: rows)
  }

  private func emitEstimatedResize() {
    guard bounds.width > 0, bounds.height > 0 else { return }

    let cellWidth = max(fontSize * 0.62, 1)
    let cellHeight = max(fontSize * 1.35, 1)
    let cols = max(20, min(400, Int(bounds.width / cellWidth)))
    let terminalHeight = max(bounds.height, 0)
    let rows = max(5, min(200, Int(terminalHeight / cellHeight)))
    emitResize(cols: cols, rows: rows)
  }

  private func emitResize(cols: Int, rows: Int) {
    guard lastReportedGrid?.cols != cols || lastReportedGrid?.rows != rows else {
      return
    }

    lastReportedGrid = (cols, rows)
    onResize([
      "cols": cols,
      "rows": rows,
    ])
  }

  private func updateContentScale() {
    let scale = window?.screen.scale ?? UIScreen.main.scale
    if contentScaleFactor != scale {
      contentScaleFactor = scale
    }
  }

  private func requestKeyboardFocus() {
    guard window != nil else { return }
    guard inputField.becomeFirstResponder() else { return }
    onFocus([:])
    textInputModeDidChange()
  }

  private func emitInput(_ data: String) {
    guard !data.isEmpty else { return }
    onInput(["data": data])
  }

  private func textInputModeDidChange() {
    guard let app else { return }
    ghostty_app_keyboard_changed(app)
  }

  private func configureIOSurfaceLayers() {
    let targetBounds = CGRect(origin: .zero, size: terminalViewport.bounds.size)
    CATransaction.begin()
    CATransaction.setDisableActions(true)
    terminalViewport.layer.sublayers?.forEach { sublayer in
      sublayer.frame = targetBounds
      sublayer.contentsScale = contentScaleFactor
    }
    CATransaction.commit()
  }

  private func markIOSurfaceLayersForDisplay() {
    terminalViewport.layer.setNeedsDisplay()
    terminalViewport.layer.sublayers?.forEach { layer in
      layer.setNeedsDisplay()
    }
  }

  private func applyTheme() {
    backgroundColor = backgroundColorValue
    terminalViewport.backgroundColor = backgroundColorValue
  }

  private func loadThemeConfig(into config: ghostty_config_t) {
    guard let path = writeThemeConfigFile() else { return }
    path.withCString { cString in
      ghostty_config_load_file(config, cString)
    }
  }

  private func writeThemeConfigFile() -> String? {
    let configContents = "\(themeConfig)\nfont-size = \(fontSize)"
    let url = URL(fileURLWithPath: NSTemporaryDirectory())
      .appendingPathComponent("paseo-terminal-theme-\(appearance.rawValue).ghostty")

    do {
      if let existing = try? String(contentsOf: url, encoding: .utf8), existing == configContents {
        return url.path
      }

      try configContents.write(to: url, atomically: true, encoding: .utf8)
      return url.path
    } catch {
      return nil
    }
  }
}

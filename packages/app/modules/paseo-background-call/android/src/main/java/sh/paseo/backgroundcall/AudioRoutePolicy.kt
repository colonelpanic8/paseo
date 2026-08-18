package sh.paseo.backgroundcall

internal enum class AudioRouteKind(val wireValue: String) {
    Watch("watch"),
    Earbuds("earbuds"),
    Wired("wired"),
    Speaker("speaker"),
    Other("other"),
}

internal enum class AudioRouteClass {
    Bluetooth,
    Wired,
    Usb,
    Speaker,
    Other,
}

internal data class AudioRouteOption(
    val id: String,
    val label: String,
    val kind: AudioRouteKind,
    val routeClass: AudioRouteClass,
    val typePriority: Int,
)

internal data class AudioRouteState(
    val active: AudioRouteOption?,
    val candidates: List<AudioRouteOption>,
)

internal fun normalizeAudioDeviceLabel(value: String): String =
    value.lowercase().filter(Char::isLetterOrDigit)

internal fun matchingWearNodeName(
    productName: String,
    wearNodeNames: Collection<String>,
): String? {
    val product = normalizeAudioDeviceLabel(productName)
    if (product.length < 4) return null
    return wearNodeNames.firstOrNull { nodeName ->
        val node = normalizeAudioDeviceLabel(nodeName)
        node.length >= 4 && (node.contains(product) || product.contains(node))
    }
}

internal fun choosePreferredAudioRoute(
    candidates: List<AudioRouteOption>,
    requestedId: String? = null,
): AudioRouteOption? {
    requestedId?.let { id -> candidates.firstOrNull { it.id == id } }?.let { return it }
    return candidates.minWithOrNull(
        compareBy<AudioRouteOption> { option ->
            when {
                option.routeClass == AudioRouteClass.Bluetooth && option.kind != AudioRouteKind.Watch -> 0
                option.kind == AudioRouteKind.Watch -> 1
                option.routeClass == AudioRouteClass.Wired -> 2
                option.routeClass == AudioRouteClass.Usb -> 3
                option.routeClass == AudioRouteClass.Speaker -> 4
                else -> 5
            }
        }.thenBy { it.typePriority }.thenBy { it.id },
    )
}

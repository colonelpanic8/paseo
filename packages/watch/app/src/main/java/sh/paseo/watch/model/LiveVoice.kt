package sh.paseo.watch.model

/**
 * Watch-side view of a Live Voice call.
 *
 * The call itself never runs here: the phone holds the WebRTC peer and the daemon
 * socket, and this screen starts it, hangs it up, mutes it, and reads the
 * transcript.
 *
 * The phone owns the communication route. The watch only displays the phone's
 * candidates and sends a route id back when the user changes it.
 */
enum class LiveVoicePhase {
  Idle,
  Starting,
  Active,
  Stopping,
  Error,
}

/** A daemon the watch may place a call on. */
data class LiveVoiceHost(val serverId: String, val label: String)

enum class LiveVoiceAudioRouteKind {
  Watch,
  Earbuds,
  Wired,
  Speaker,
  Other,
}

data class LiveVoiceAudioRoute(
  val id: String,
  val label: String,
  val kind: LiveVoiceAudioRouteKind,
)

data class LiveVoiceTranscriptEntry(
  val id: String,
  /** True for the user's own speech, false for the agent's. */
  val fromUser: Boolean,
  val text: String,
)

data class LiveVoiceState(
  val phase: LiveVoicePhase,
  val serverId: String?,
  /** Label of the host the call is on, resolved by the phone. */
  val hostLabel: String?,
  val isMuted: Boolean,
  val hosts: List<LiveVoiceHost>,
  val unavailableReason: String?,
  /** Oldest to newest. */
  val transcripts: List<LiveVoiceTranscriptEntry>,
  val errorCode: String?,
  val errorMessage: String?,
  val closedCause: String?,
  val activeAudioRoute: LiveVoiceAudioRoute?,
  val audioRouteCandidates: List<LiveVoiceAudioRoute>,
  val pocketStartSupported: Boolean,
) {
  /** A call is up or coming up: the controls should offer hang-up and mute. */
  val isLive: Boolean
    get() = phase == LiveVoicePhase.Starting || phase == LiveVoicePhase.Active

  /** Exactly one callable host means the start button needs no picker. */
  val soleHost: LiveVoiceHost?
    get() = hosts.singleOrNull()

  companion object {
    /**
     * What the watch shows before any Live Voice item has arrived — including on
     * a phone too old to publish one, which never sends it at all.
     */
    val Unknown =
      LiveVoiceState(
        phase = LiveVoicePhase.Idle,
        serverId = null,
        hostLabel = null,
        isMuted = false,
        hosts = emptyList(),
        unavailableReason = null,
        transcripts = emptyList(),
        errorCode = null,
        errorMessage = null,
        closedCause = null,
        activeAudioRoute = null,
        audioRouteCandidates = emptyList(),
        pocketStartSupported = false,
      )
  }
}

fun LiveVoiceState.nextAudioRoute(): LiveVoiceAudioRoute? {
  if (audioRouteCandidates.size < 2) return null
  val currentIndex = audioRouteCandidates.indexOfFirst { it.id == activeAudioRoute?.id }
  return audioRouteCandidates[(currentIndex + 1).mod(audioRouteCandidates.size)]
}

fun audioRouteIcon(kind: LiveVoiceAudioRouteKind): String =
  when (kind) {
    LiveVoiceAudioRouteKind.Watch -> "⌚"
    LiveVoiceAudioRouteKind.Earbuds -> "🎧"
    LiveVoiceAudioRouteKind.Wired -> "⌁"
    LiveVoiceAudioRouteKind.Speaker -> "🔊"
    LiveVoiceAudioRouteKind.Other -> "•"
  }

fun LiveVoiceState.audioRouteGlance(): String? =
  activeAudioRoute?.let { "${audioRouteIcon(it.kind)} ${it.label}" }

/**
 * One line explaining why no call can be placed.
 *
 * Unrecognised reasons fall back to generic copy rather than showing a raw code:
 * the phone's reason set is allowed to grow, and a watch that hasn't been updated
 * should still say something true.
 */
fun liveVoiceUnavailableMessage(reason: String?): String =
  when (reason) {
    "platform_unsupported" -> "Live Voice needs a newer phone app"
    "no_hosts" -> "No hosts on your phone yet"
    "hosts_connecting" -> "Connecting to your hosts…"
    "hosts_offline" -> "No host is online"
    "host_upgrade_required" -> "Update Paseo on your host"
    else -> "Live Voice is unavailable"
  }

/**
 * One line explaining a call that failed or ended.
 *
 * Same open-set discipline as [liveVoiceUnavailableMessage]: the daemon's codes
 * stay open on the wire so a newer daemon can add one, and the phone's own
 * message is the fallback when this watch doesn't know the code.
 */
fun liveVoiceErrorMessage(code: String?, message: String?): String =
  when (code) {
    null -> message ?: "Call failed"
    "mic_busy" -> "The phone's mic is in use"
    "mic_denied" -> "Allow mic access on your phone"
    "mic_unavailable" -> "The phone's mic is unavailable"
    "not_connected" -> "The host went offline"
    "unsupported" -> "This phone can't place calls"
    "background_unavailable" -> "The phone blocked background audio"
    "ice_timeout", "webrtc_failed" -> "Lost the connection"
    else -> message ?: "Call failed"
  }

package sh.paseo.backgroundcall

import android.content.Context
import android.media.AudioDeviceCallback
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.util.Log
import java.util.concurrent.Executor

private const val TAG = "PaseoCallAudio"

/** Owns the communication route while a Live Voice call is active. */
internal object CallAudioRouter {
    private var audioManager: AudioManager? = null
    private var previousMode: Int? = null
    private var deviceCallback: AudioDeviceCallback? = null
    private var communicationDeviceListener: AudioManager.OnCommunicationDeviceChangedListener? = null
    private var requestedRouteId: String? = null
    private var expectedRouteId: String? = null
    private var wearNodeNames: Set<String> = emptySet()

    @Volatile
    var stateListener: ((AudioRouteState) -> Unit)? = null

    fun attach(context: Context) {
        val manager = context.getSystemService(AudioManager::class.java) ?: return
        audioManager = manager

        if (previousMode == null) previousMode = manager.mode
        runCatching { manager.mode = AudioManager.MODE_IN_COMMUNICATION }
            .onFailure { Log.w(TAG, "Failed to enter communication mode", it) }

        applyRoute(manager)
        registerDeviceCallbacks(manager)
        emitState(manager)
    }

    fun detach() {
        val manager = audioManager ?: return
        audioManager = null

        deviceCallback?.let { manager.unregisterAudioDeviceCallback(it) }
        deviceCallback = null
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            communicationDeviceListener?.let(manager::removeOnCommunicationDeviceChangedListener)
        }
        communicationDeviceListener = null

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            runCatching { manager.clearCommunicationDevice() }
                .onFailure { Log.w(TAG, "Failed to clear the communication device", it) }
        } else {
            @Suppress("DEPRECATION")
            runCatching {
                if (manager.isBluetoothScoOn) {
                    manager.isBluetoothScoOn = false
                    manager.stopBluetoothSco()
                }
                manager.isSpeakerphoneOn = false
            }.onFailure { Log.w(TAG, "Failed to release the legacy audio route", it) }
        }

        previousMode?.let { mode ->
            runCatching { manager.mode = mode }
                .onFailure { Log.w(TAG, "Failed to restore the audio mode", it) }
        }
        previousMode = null
        requestedRouteId = null
        expectedRouteId = null
        stateListener?.invoke(snapshot(manager))
    }

    fun updateWearNodeNames(names: Collection<String>, context: Context) {
        val next = names.map(String::trim).filter(String::isNotEmpty).toSet()
        if (next == wearNodeNames) return
        wearNodeNames = next
        audioManager?.let { manager ->
            if (requestedRouteId == null) applyRoute(manager)
            emitState(manager)
        } ?: stateListener?.invoke(snapshot(context))
    }

    fun snapshot(context: Context): AudioRouteState {
        val manager = audioManager ?: context.getSystemService(AudioManager::class.java)
        return if (manager == null) AudioRouteState(null, emptyList()) else snapshot(manager)
    }

    fun select(context: Context, routeId: String): Boolean {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.S) return false
        val manager = audioManager ?: context.getSystemService(AudioManager::class.java) ?: return false
        val devices = manager.availableCommunicationDevices
        val target = devices.firstOrNull { routeIdOf(it) == routeId } ?: return false
        val accepted = runCatching { manager.setCommunicationDevice(target) }
            .onFailure { Log.w(TAG, "Failed to set communication device ${target.type}", it) }
            .getOrDefault(false)
        if (accepted) {
            requestedRouteId = routeId
            expectedRouteId = routeId
            emitState(manager)
        }
        return accepted
    }

    private fun registerDeviceCallbacks(manager: AudioManager) {
        if (deviceCallback == null) {
            val callback = object : AudioDeviceCallback() {
                override fun onAudioDevicesAdded(addedDevices: Array<out AudioDeviceInfo>?) = devicesChanged(manager)
                override fun onAudioDevicesRemoved(removedDevices: Array<out AudioDeviceInfo>?) = devicesChanged(manager)
            }
            runCatching {
                manager.registerAudioDeviceCallback(callback, Handler(Looper.getMainLooper()))
                deviceCallback = callback
            }.onFailure { Log.w(TAG, "Failed to watch for audio device changes", it) }
        }

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && communicationDeviceListener == null) {
            val listener = AudioManager.OnCommunicationDeviceChangedListener { device ->
                expectedRouteId = device?.let(::routeIdOf)
                emitState(manager)
            }
            runCatching {
                manager.addOnCommunicationDeviceChangedListener(mainExecutor(), listener)
                communicationDeviceListener = listener
            }.onFailure { Log.w(TAG, "Failed to watch the communication route", it) }
        }
    }

    private fun devicesChanged(manager: AudioManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            val ids = manager.availableCommunicationDevices.mapTo(mutableSetOf(), ::routeIdOf)
            if (requestedRouteId !in ids) requestedRouteId = null
        }
        applyRoute(manager)
        emitState(manager)
    }

    private fun applyRoute(manager: AudioManager) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) applyModernRoute(manager) else applyLegacyRoute(manager)
    }

    private fun applyModernRoute(manager: AudioManager) {
        val devices = runCatching { manager.availableCommunicationDevices }
            .onFailure { Log.w(TAG, "Failed to list communication devices", it) }
            .getOrNull()
            .orEmpty()
        val options = devices.map(::routeOption)
        val targetOption = choosePreferredAudioRoute(options, requestedRouteId) ?: return
        val target = devices.firstOrNull { routeIdOf(it) == targetOption.id } ?: return
        expectedRouteId = targetOption.id

        if (manager.communicationDevice?.id == target.id) return
        val accepted = runCatching { manager.setCommunicationDevice(target) }
            .onFailure { Log.w(TAG, "Failed to set communication device ${target.type}", it) }
            .getOrDefault(false)
        if (!accepted) Log.w(TAG, "Communication device ${target.type} was refused")
    }

    @Suppress("DEPRECATION")
    private fun applyLegacyRoute(manager: AudioManager) {
        val outputs = runCatching { manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList() }.getOrDefault(emptyList())
        val preferred = choosePreferredAudioRoute(outputs.map(::routeOption))
        expectedRouteId = preferred?.id
        runCatching {
            if (preferred?.routeClass == AudioRouteClass.Bluetooth) {
                manager.startBluetoothSco()
                manager.isBluetoothScoOn = true
                manager.isSpeakerphoneOn = false
                return
            }
            if (manager.isBluetoothScoOn) {
                manager.isBluetoothScoOn = false
                manager.stopBluetoothSco()
            }
            manager.isSpeakerphoneOn = preferred?.routeClass == AudioRouteClass.Speaker
        }.onFailure { Log.w(TAG, "Failed to apply the legacy audio route", it) }
    }

    private fun snapshot(manager: AudioManager): AudioRouteState {
        val modern = Build.VERSION.SDK_INT >= Build.VERSION_CODES.S
        val devices = if (modern) {
            runCatching { manager.availableCommunicationDevices }.getOrDefault(emptyList())
        } else {
            runCatching { manager.getDevices(AudioManager.GET_DEVICES_OUTPUTS).toList() }.getOrDefault(emptyList())
        }
        val options = devices.map(::routeOption)
        val activeId = if (modern && audioManager != null) {
            manager.communicationDevice?.let(::routeIdOf) ?: expectedRouteId
        } else {
            expectedRouteId
        }
        val active = options.firstOrNull { it.id == activeId } ?: choosePreferredAudioRoute(options)
        return AudioRouteState(active = active, candidates = if (modern) options else emptyList())
    }

    private fun routeOption(device: AudioDeviceInfo): AudioRouteOption {
        val rawLabel = runCatching { device.productName.toString().trim() }.getOrDefault("")
        val matchedWatchName = if (isBluetooth(device.type)) matchingWearNodeName(rawLabel, wearNodeNames) else null
        val routeClass = routeClass(device.type)
        val kind = when {
            matchedWatchName != null -> AudioRouteKind.Watch
            routeClass == AudioRouteClass.Bluetooth -> AudioRouteKind.Earbuds
            routeClass == AudioRouteClass.Wired || routeClass == AudioRouteClass.Usb -> AudioRouteKind.Wired
            routeClass == AudioRouteClass.Speaker -> AudioRouteKind.Speaker
            else -> AudioRouteKind.Other
        }
        val label = matchedWatchName ?: rawLabel.ifEmpty { fallbackLabel(kind) }
        return AudioRouteOption(
            id = routeIdOf(device),
            label = label,
            kind = kind,
            routeClass = routeClass,
            typePriority = typePriority(device.type),
        )
    }

    private fun routeClass(type: Int): AudioRouteClass = when (type) {
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
        AudioDeviceInfo.TYPE_BLE_HEADSET,
        -> AudioRouteClass.Bluetooth
        AudioDeviceInfo.TYPE_WIRED_HEADSET,
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES,
        -> AudioRouteClass.Wired
        AudioDeviceInfo.TYPE_USB_HEADSET -> AudioRouteClass.Usb
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> AudioRouteClass.Speaker
        else -> AudioRouteClass.Other
    }

    private fun isBluetooth(type: Int): Boolean =
        type == AudioDeviceInfo.TYPE_BLUETOOTH_SCO ||
            (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && type == AudioDeviceInfo.TYPE_BLE_HEADSET)

    private fun typePriority(type: Int): Int = when (type) {
        AudioDeviceInfo.TYPE_BLE_HEADSET -> 0
        AudioDeviceInfo.TYPE_BLUETOOTH_SCO -> 1
        AudioDeviceInfo.TYPE_WIRED_HEADSET -> 2
        AudioDeviceInfo.TYPE_WIRED_HEADPHONES -> 3
        AudioDeviceInfo.TYPE_USB_HEADSET -> 4
        AudioDeviceInfo.TYPE_BUILTIN_SPEAKER -> 5
        else -> 6
    }

    private fun fallbackLabel(kind: AudioRouteKind): String = when (kind) {
        AudioRouteKind.Watch -> "Watch"
        AudioRouteKind.Earbuds -> "Bluetooth audio"
        AudioRouteKind.Wired -> "Wired audio"
        AudioRouteKind.Speaker -> "Phone speaker"
        AudioRouteKind.Other -> "Audio device"
    }

    private fun routeIdOf(device: AudioDeviceInfo): String = "android:${device.id}"

    private fun emitState(manager: AudioManager) {
        stateListener?.invoke(snapshot(manager))
    }

    private fun mainExecutor(): Executor = Executor { command -> Handler(Looper.getMainLooper()).post(command) }
}

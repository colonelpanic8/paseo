package sh.paseo.backgroundcall

import android.app.Activity
import android.app.Application
import android.os.Bundle
import java.util.Collections
import java.util.WeakHashMap

internal object ForegroundActivityTracker : Application.ActivityLifecycleCallbacks {
    private val resumed = Collections.newSetFromMap(WeakHashMap<Activity, Boolean>())
    private var registeredApplication: Application? = null

    @Synchronized
    fun register(application: Application) {
        if (registeredApplication === application) return
        registeredApplication?.unregisterActivityLifecycleCallbacks(this)
        resumed.clear()
        registeredApplication = application
        application.registerActivityLifecycleCallbacks(this)
    }

    @Synchronized
    fun hasResumedActivity(): Boolean = resumed.isNotEmpty()

    @Synchronized
    override fun onActivityResumed(activity: Activity) {
        resumed.add(activity)
    }

    @Synchronized
    override fun onActivityPaused(activity: Activity) {
        resumed.remove(activity)
    }

    @Synchronized
    override fun onActivityDestroyed(activity: Activity) {
        resumed.remove(activity)
    }

    override fun onActivityCreated(activity: Activity, savedInstanceState: Bundle?) = Unit
    override fun onActivityStarted(activity: Activity) = Unit
    override fun onActivityStopped(activity: Activity) = Unit
    override fun onActivitySaveInstanceState(activity: Activity, outState: Bundle) = Unit
}

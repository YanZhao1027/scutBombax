package cn.scut.bombax.activity

import android.content.Intent
import com.getcapacitor.JSObject
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin

/**
 * A deliberately small bridge from the app's Material 3 activity navigation.
 *
 * The web caller may open only the canonical production entry. It cannot pass a URL, cookie, campus token, or payment code.
 * ActivityPortalActivity is a bare Android WebView with no Capacitor bridge
 * and no access to the native SCUT water/electricity session.
 */
@CapacitorPlugin(name = "BombaxActivityPortal")
class BombaxActivityPortalPlugin : Plugin() {
    @PluginMethod
    fun open(call: PluginCall) {
        val destination = call.getString("destination")
        if (destination != "activity") {
            call.reject("Invalid activity portal destination")
            return
        }
        bridge.activity.runOnUiThread {
            try {
                val intent = Intent(bridge.activity, ActivityPortalActivity::class.java)
                intent.putExtra(ActivityPortalActivity.EXTRA_DESTINATION, destination)
                bridge.activity.startActivity(intent)
                val result = JSObject()
                result.put("opened", true)
                call.resolve(result)
            } catch (_: Exception) {
                call.reject("Unable to open isolated activity portal")
            }
        }
    }
}

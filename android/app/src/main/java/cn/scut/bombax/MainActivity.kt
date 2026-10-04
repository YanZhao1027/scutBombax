package cn.scut.bombax

import android.os.Bundle
import cn.scut.bombax.scut.ScutApiPlugin
import com.getcapacitor.BridgeActivity

/**
 * The Capacitor host. The SCUT bridge is an app-local plugin, so it has to be
 * registered before the bridge is built in super.onCreate.
 */
class MainActivity : BridgeActivity() {

    override fun onCreate(savedInstanceState: Bundle?) {
        registerPlugin(ScutApiPlugin::class.java)
        super.onCreate(savedInstanceState)
    }
}

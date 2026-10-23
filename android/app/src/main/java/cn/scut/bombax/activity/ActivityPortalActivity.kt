package cn.scut.bombax.activity

import android.Manifest
import android.app.Activity
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.SslErrorHandler
import android.webkit.ValueCallback
import android.webkit.WebChromeClient
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import android.webkit.WebSettings
import android.net.http.SslError
import android.view.View
import android.view.ViewGroup
import android.widget.LinearLayout
import android.widget.TextView
import androidx.core.content.ContextCompat

/**
 * Android-native, isolated HTTPS workbench. This is a plain WebView: there is
 * NO Capacitor bridge and NO SCUT authentication or billing cookie injection.
 * Only two exact first-party HTTPS origins can request camera/GPS: the
 * canonical Cloudflare public entry and the campus-only :8443 HTTPS endpoint.
 * The public site's health probe chooses the route. Student credentials and
 * screenshots remain within the separate activity WebView, never SCUT billing.
 */
class ActivityPortalActivity : Activity() {

    companion object {
        const val EXTRA_DESTINATION = "bombax.activity.destination"
        private const val CAMERA_PERMISSION_REQUEST = 6081
        private const val LOCATION_PERMISSION_REQUEST = 6082
        private const val FILE_PICK_REQUEST = 6083
        private const val PUBLIC = ActivityOriginPolicy.PUBLIC_URL
        // Debug-only USB-loopback QA, never enabled for Release or remote hosts.
        private const val USB_QA = "http://127.0.0.1:3318/"
    }

    private lateinit var webView: WebView
    private var pendingCamera: PermissionRequest? = null
    private var pendingLocation: Pair<String, GeolocationPermissions.Callback>? = null
    private var pendingFile: ValueCallback<Array<Uri>>? = null
    private var fullscreenCameraView: View? = null
    private var fullscreenCameraCallback: WebChromeClient.CustomViewCallback? = null
    private var previousSystemUiFlags: Int = 0
    private var isUsbQaSession: Boolean = false

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun qaDebugMode(): Boolean =
        (applicationInfo.flags and android.content.pm.ApplicationInfo.FLAG_DEBUGGABLE) != 0

    private fun trusted(uri: Uri?): Boolean {
        if (isUsbQaSession && qaDebugMode() &&
            uri?.scheme == "http" && uri.host == "127.0.0.1" && uri.port == 3318 &&
            uri.userInfo == null) return true
        return ActivityOriginPolicy.isTrusted(uri?.toString())
    }

    private fun permissionGranted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    /** Web Fullscreen API: occupy the ENTIRE phone viewport, including the native header. */
    private fun showFullscreenCamera(view: View, callback: WebChromeClient.CustomViewCallback) {
        if (fullscreenCameraView != null) {
            callback.onCustomViewHidden()
            return
        }
        val decor = window.decorView as? ViewGroup ?: run {
            callback.onCustomViewHidden()
            return
        }
        previousSystemUiFlags = window.decorView.systemUiVisibility
        fullscreenCameraView = view
        fullscreenCameraCallback = callback
        decor.addView(view, ViewGroup.LayoutParams(
            ViewGroup.LayoutParams.MATCH_PARENT, ViewGroup.LayoutParams.MATCH_PARENT
        ))
        window.decorView.systemUiVisibility = (
            View.SYSTEM_UI_FLAG_IMMERSIVE_STICKY or
            View.SYSTEM_UI_FLAG_FULLSCREEN or
            View.SYSTEM_UI_FLAG_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_FULLSCREEN or
            View.SYSTEM_UI_FLAG_LAYOUT_HIDE_NAVIGATION or
            View.SYSTEM_UI_FLAG_LAYOUT_STABLE
        )
    }

    private fun hideFullscreenCamera() {
        val view = fullscreenCameraView ?: return
        (view.parent as? ViewGroup)?.removeView(view)
        fullscreenCameraView = null
        window.decorView.systemUiVisibility = previousSystemUiFlags
        val callback = fullscreenCameraCallback
        fullscreenCameraCallback = null
        callback?.onCustomViewHidden()
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val destination = intent.getStringExtra(EXTRA_DESTINATION)
        isUsbQaSession = destination == "qa" && qaDebugMode()
        val url = when (destination) {
            "activity" -> PUBLIC
            "qa" -> if (isUsbQaSession) USB_QA else { finish(); return }
            else -> { finish(); return }
        }

        val dark = (resources.configuration.uiMode and Configuration.UI_MODE_NIGHT_MASK) ==
            Configuration.UI_MODE_NIGHT_YES
        val surface = Color.parseColor(if (dark) "#1D2734" else "#F5F7FF")
        val ink = Color.parseColor(if (dark) "#E1E7F3" else "#19334F")
        window.statusBarColor = surface
        window.navigationBarColor = surface
        if (!dark) window.decorView.systemUiVisibility = View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR

        val content = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setBackgroundColor(surface)
        }
        val header = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(17), dp(7), dp(17), dp(10))
        }
        val back = TextView(this).apply {
            text = "‹ 返回花工木棉"
            textSize = 16f
            setTextColor(ink)
            setPadding(dp(0), dp(9), dp(0), dp(10))
            isClickable = true
            isFocusable = true
            contentDescription = "返回花工木棉的宿舍水电与活动导航"
            setOnClickListener { finish() }
        }
        val title = TextView(this).apply {
            text = "活动速签 · 正式工作台"
            textSize = 18f
            setTextColor(ink)
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        val subtitle = TextView(this).apply {
            text = if (isUsbQaSession)
                 "USB 本机 QA · 127.0.0.1 · 不连接校园系统"
                else "校园网优先直连 · 校外 Cloudflare 加密回源 · 与一卡通登录态隔离"
            textSize = 11f
            setTextColor(Color.parseColor(if (dark) "#B9C8E1" else "#506887"))
            setPadding(0, dp(5), 0, 0)
        }
        header.addView(back)
        header.addView(title)
        header.addView(subtitle)
        content.addView(header)

        webView = WebView(this)
        webView.setBackgroundColor(Color.WHITE)
        webView.settings.apply {
            javaScriptEnabled = true
            domStorageEnabled = true
            setGeolocationEnabled(true)
            allowFileAccess = false
            allowContentAccess = true // Android document picker grants selected content:// URI only
            allowFileAccessFromFileURLs = false
            allowUniversalAccessFromFileURLs = false
            mixedContentMode = WebSettings.MIXED_CONTENT_NEVER_ALLOW
            javaScriptCanOpenWindowsAutomatically = false
            setSupportMultipleWindows(false)
            mediaPlaybackRequiresUserGesture = false // live camera video stream
        }
        CookieManager.getInstance().setAcceptThirdPartyCookies(webView, false)
        webView.webViewClient = object : WebViewClient() {
            override fun onPageStarted(view: WebView?, url: String?, favicon: android.graphics.Bitmap?) {
                super.onPageStarted(view, url, favicon)
                if (qaDebugMode()) {
                    val page = runCatching { Uri.parse(url) }.getOrNull()
                    // Never log path, query, fragment, pass tokens, cookies or student identity.
                    val host = page?.host ?: "unknown"
                    val port = page?.port ?: -1
                    val scheme = page?.scheme ?: "unknown"
                    android.util.Log.i("BombaxActivityRoute", "mainframe_origin=$scheme://$host:$port")
                }
            }

            override fun shouldOverrideUrlLoading(view: WebView, request: WebResourceRequest): Boolean {
                val uri = request.url
                if (trusted(uri)) return false
                // External links never inherit our authenticated activity WebView context.
                if (uri.scheme == "https") {
                    runCatching { startActivity(Intent(Intent.ACTION_VIEW, uri)) }
                }
                return true
            }

            override fun onReceivedSslError(view: WebView, handler: SslErrorHandler, error: SslError) {
                handler.cancel() // Do not override TLS errors, even on campus Wi-Fi.
            }
        }
        webView.webChromeClient = object : WebChromeClient() {
            override fun onShowCustomView(view: View, callback: CustomViewCallback) {
                runOnUiThread { showFullscreenCamera(view, callback) }
            }

            override fun onHideCustomView() {
                runOnUiThread { hideFullscreenCamera() }
            }

            override fun onPermissionRequest(request: PermissionRequest) {
                runOnUiThread {
                    if (!trusted(request.origin) ||
                        request.resources.any { it != PermissionRequest.RESOURCE_VIDEO_CAPTURE } ||
                        request.resources.isEmpty()) {
                        request.deny()
                        return@runOnUiThread
                    }
                    if (permissionGranted(Manifest.permission.CAMERA)) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else {
                        pendingCamera?.deny()
                        pendingCamera = request
                        requestPermissions(arrayOf(Manifest.permission.CAMERA), CAMERA_PERMISSION_REQUEST)
                    }
                }
            }

            override fun onPermissionRequestCanceled(request: PermissionRequest) {
                if (pendingCamera === request) pendingCamera = null
            }

            override fun onGeolocationPermissionsShowPrompt(
                origin: String,
                callback: GeolocationPermissions.Callback
            ) {
                if (!trusted(Uri.parse(origin))) {
                    callback.invoke(origin, false, false)
                    return
                }
                if (permissionGranted(Manifest.permission.ACCESS_FINE_LOCATION) ||
                    permissionGranted(Manifest.permission.ACCESS_COARSE_LOCATION)) {
                    callback.invoke(origin, true, false)
                } else {
                    pendingLocation?.let { it.second.invoke(it.first, false, false) }
                    pendingLocation = origin to callback
                    requestPermissions(
                        arrayOf(
                            Manifest.permission.ACCESS_FINE_LOCATION,
                            Manifest.permission.ACCESS_COARSE_LOCATION
                        ),
                        LOCATION_PERMISSION_REQUEST
                    )
                }
            }

            override fun onShowFileChooser(
                view: WebView,
                filePathCallback: ValueCallback<Array<Uri>>,
                fileChooserParams: FileChooserParams
            ): Boolean {
                pendingFile?.onReceiveValue(null)
                pendingFile = filePathCallback
                val picker = Intent(Intent.ACTION_GET_CONTENT).apply {
                    type = "image/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
                }
                return try {
                    startActivityForResult(
                        Intent.createChooser(picker, "选择活动证明图片"),
                        FILE_PICK_REQUEST
                    )
                    true
                } catch (_: Exception) {
                    pendingFile?.onReceiveValue(null)
                    pendingFile = null
                    false
                }
            }
        }
        content.addView(
            webView,
            LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, 0, 1f)
        )
        setContentView(content)
        webView.loadUrl(url)
    }

    override fun onRequestPermissionsResult(
        requestCode: Int,
        permissions: Array<out String>,
        grantResults: IntArray
    ) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults)
        when (requestCode) {
            CAMERA_PERMISSION_REQUEST -> {
                val request = pendingCamera
                pendingCamera = null
                if (request != null) {
                    if (permissionGranted(Manifest.permission.CAMERA)) {
                        request.grant(arrayOf(PermissionRequest.RESOURCE_VIDEO_CAPTURE))
                    } else request.deny()
                }
            }
            LOCATION_PERMISSION_REQUEST -> {
                val pending = pendingLocation
                pendingLocation = null
                pending?.second?.invoke(
                    pending.first,
                    permissionGranted(Manifest.permission.ACCESS_FINE_LOCATION) ||
                        permissionGranted(Manifest.permission.ACCESS_COARSE_LOCATION),
                    false
                )
            }
        }
    }

    @Deprecated("Legacy Activity lifecycle callback supports Capacitor Android API 24+")
    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?) {
        super.onActivityResult(requestCode, resultCode, data)
        if (requestCode == FILE_PICK_REQUEST) {
            val callback = pendingFile
            pendingFile = null
            callback?.onReceiveValue(WebChromeClient.FileChooserParams.parseResult(resultCode, data))
        }
    }

    @Deprecated("Use the explicit close button for guaranteed return to the main app")
    override fun onBackPressed() {
        if (fullscreenCameraView != null) {
            // Releases camera tracks via the activity site's own cleanup handler.
            webView.evaluateJavascript(
                "if (typeof window.cleanScanner === 'function') window.cleanScanner(); else if (document.fullscreenElement) document.exitFullscreen();",
                null
            )
            hideFullscreenCamera()
            return
        }
        if (::webView.isInitialized && webView.canGoBack()) webView.goBack()
        else super.onBackPressed()
    }

    override fun onDestroy() {
        hideFullscreenCamera()
        pendingCamera?.deny()
        pendingCamera = null
        pendingLocation?.let { it.second.invoke(it.first, false, false) }
        pendingLocation = null
        pendingFile?.onReceiveValue(null)
        pendingFile = null
        if (::webView.isInitialized) {
            webView.stopLoading()
            webView.destroy()
        }
        super.onDestroy()
    }
}

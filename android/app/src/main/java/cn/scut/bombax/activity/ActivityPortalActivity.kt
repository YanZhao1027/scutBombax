package cn.scut.bombax.activity

import android.Manifest
import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.pm.PackageManager
import android.content.res.Configuration
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import android.os.Handler
import android.os.Looper
import android.webkit.CookieManager
import android.webkit.GeolocationPermissions
import android.webkit.PermissionRequest
import android.webkit.WebResourceError
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
import android.widget.ImageView
import android.widget.TextView
import androidx.webkit.WebViewCompat
import androidx.webkit.WebViewFeature
import androidx.webkit.WebMessageCompat
import androidx.webkit.JavaScriptReplyProxy
import org.json.JSONObject
import androidx.core.content.ContextCompat

/**
 * Android-native, isolated HTTPS workbench. This is a plain WebView: there is
 * NO Capacitor bridge and NO SCUT authentication or billing cookie injection.
 * A separately guarded WebMessageListener exposes only an encrypted *activity*
 * receipt vault to the exact HTTPS Stage main frame. It never exposes tokens,
 * keys, balance history, school login cookies or cross-origin iframe access.
 * Only a hardcoded synthetic-data activity origin can request camera/GPS.
 *
 * The user authorizes camera and location through Android runtime permissions.
 * For actual school data, activity identity proof must be redesigned first.
 */
class ActivityPortalActivity : Activity() {

    companion object {
        const val EXTRA_DESTINATION = "bombax.activity.destination"
        private const val CAMERA_PERMISSION_REQUEST = 6081
        private const val LOCATION_PERMISSION_REQUEST = 6082
        private const val FILE_PICK_REQUEST = 6083
        private const val STAGE = "https://activity-stage.10273055.xyz/"
        private const val STAGE_ORIGIN = "https://activity-stage.10273055.xyz"
        private const val SHOWCASE = "https://activity-demo.10273055.xyz/"
    }

    private lateinit var webView: WebView
    private val localPasses by lazy { ActivityPassVault(applicationContext) }
    private lateinit var loadNotice: LinearLayout
    private lateinit var loadNoticeText: TextView
    private val loadHandler = Handler(Looper.getMainLooper())
    private var loadGeneration = 0
    private var pageCommitted = false
    private var pageLoadFailed = false
    private var pendingCamera: PermissionRequest? = null
    private var pendingLocation: Pair<String, GeolocationPermissions.Callback>? = null
    private var pendingFile: ValueCallback<Array<Uri>>? = null
    private var fullscreenCameraView: View? = null
    private var fullscreenCameraCallback: WebChromeClient.CustomViewCallback? = null
    private var previousSystemUiFlags: Int = 0

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density + 0.5f).toInt()

    private fun trusted(uri: Uri?): Boolean {
        if (uri == null || uri.scheme != "https" || (uri.port != -1 && uri.port != 443)) return false
        if (uri.userInfo != null) return false
        return uri.host?.lowercase() in setOf(
            "activity-stage.10273055.xyz",
            "activity-demo.10273055.xyz"
        )
    }

    private fun permissionGranted(permission: String): Boolean =
        ContextCompat.checkSelfPermission(this, permission) == PackageManager.PERMISSION_GRANTED

    private fun showPortalNotice(message: String, failed: Boolean = false) {
        if (failed) pageLoadFailed = true
        if (::loadNotice.isInitialized && ::loadNoticeText.isInitialized) {
            loadNoticeText.text = message
            loadNotice.visibility = View.VISIBLE
        }
    }

    private fun loadPortal(url: String) {
        val generation = ++loadGeneration
        pageCommitted = false
        pageLoadFailed = false
        loadNotice.visibility = View.GONE
        webView.loadUrl(url)
        // Campus Wi-Fi captive portals can leave WebView blank without a quick
        // error callback. Offer a retry while continuing the original load.
        loadHandler.postDelayed({
            if (generation == loadGeneration && !pageLoadFailed && !isFinishing) {
                if (!pageCommitted) {
                    showPortalNotice("活动测试站尚未响应。请确认校园 Wi-Fi 已完成网络认证，或切换可用网络后点“重试连接”。")
                } else {
                    // The static page may load from cache while its API calls hang.
                    // The probe reports only a boolean; no personal text enters native code.
                    webView.evaluateJavascript(
                        "(function(){var n=document.getElementById('notice');return !!n && n.textContent.indexOf('系统初始化中')!==-1})()"
                    ) { waiting ->
                        if (waiting == "true" && generation == loadGeneration && !isFinishing) {
                            showPortalNotice("活动网页已打开，但后台初始化超时。请检查校园网认证或切换可用网络后重试。")
                        }
                    }
                }
            }
        }, 12_000L)
    }

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

    /**
     * AndroidX injects the JS receiver for this exact HTTPS origin. Unlike
     * addJavascriptInterface, this callback includes frame/origin metadata:
     * reject all subframes, even if they display same-origin content.
     * Never use this bridge in the showcase or in the main SCUT Capacitor WebView.
     */
    private fun installActivityVaultBridge(): Boolean {
        if (!WebViewFeature.isFeatureSupported(WebViewFeature.WEB_MESSAGE_LISTENER)) return false
        WebViewCompat.addWebMessageListener(
            webView, "BombaxNativeVault", setOf(STAGE_ORIGIN),
            object : WebViewCompat.WebMessageListener {
                override fun onPostMessage(
                    view: WebView, message: WebMessageCompat,
                    sourceOrigin: Uri, isMainFrame: Boolean,
                    replyProxy: JavaScriptReplyProxy
                ) {
                    if (!isMainFrame || sourceOrigin.toString() != STAGE_ORIGIN ||
                        !isStageUri(Uri.parse(view.url ?: ""))) return
                    val input = runCatching { JSONObject(message.data ?: "") }.getOrNull() ?: return
                    val requestId = input.optString("id")
                    if (!Regex("^[A-Za-z0-9_-]{1,48}$").matches(requestId)) return
                    fun success(value: Any) {
                        replyProxy.postMessage(
                            JSONObject().put("id", requestId).put("ok", true)
                                .put("data", value).toString()
                        )
                    }
                    fun error() {
                        // No exception messages, tokens, cookie strings or stack traces leak to JS.
                        replyProxy.postMessage(
                            JSONObject().put("id", requestId).put("ok", false)
                                .put("error", "本机加密票夹暂不可用；请保存一码通截图").toString()
                        )
                    }
                    try {
                        when (input.optString("op")) {
                            "list" -> success(localPasses.listSummaries())
                            "save" -> {
                                val eid = input.getString("eventId")
                                val title = input.getString("title")
                                val state = input.getString("state")
                                val cookie = CookieManager.getInstance()
                                    .getCookie(STAGE + "api/events/" + eid)
                                val pass = ActivityPassRules.extractReceipt(eid, cookie)
                                    ?: throw IllegalStateException("receipt cookie unavailable")
                                localPasses.save(
                                    eid, title, state,
                                    input.optBoolean("attended"), input.getLong("expiresAt"), pass
                                )
                                success(JSONObject().put("saved", true))
                            }
                            "restore" -> {
                                val eid = input.getString("eventId")
                                val pass = localPasses.readReceipt(eid)
                                    ?: throw IllegalStateException("no valid pass")
                                val name = ActivityPassRules.cookieName(eid)
                                    ?: throw IllegalArgumentException("bad event")
                                // Only native code handles the plaintext pass. JS receives a
                                // confirmation but cannot read the saved bearer credential.
                                CookieManager.getInstance().setCookie(
                                    STAGE, "$name=$pass; Path=/api; Secure; HttpOnly; SameSite=Strict"
                                ) { applied ->
                                    if (applied == true) {
                                        CookieManager.getInstance().flush()
                                        success(JSONObject().put("restored", true))
                                    } else error()
                                }
                            }
                            "forget" -> {
                                val eid = input.getString("eventId")
                                val name = ActivityPassRules.cookieName(eid)
                                    ?: throw IllegalArgumentException("bad event")
                                localPasses.forget(eid)
                                CookieManager.getInstance().setCookie(
                                    STAGE, "$name=; Path=/api; Secure; HttpOnly; Max-Age=0"
                                ) {
                                    CookieManager.getInstance().flush()
                                    success(JSONObject().put("removed", true))
                                }
                            }
                            else -> error()
                        }
                    } catch (_: Exception) {
                        error()
                    }
                }
            }
        )
        return true
    }

    private fun isStageUri(uri: Uri?): Boolean =
        uri?.scheme == "https" && uri.host == "activity-stage.10273055.xyz" &&
            (uri.port == -1 || uri.port == 443) && uri.userInfo == null

    private fun showOfflineOneCode(eventId: String, title: String) {
        val receipt = localPasses.readReceipt(eventId)
        if (receipt == null) {
            AlertDialog.Builder(this).setTitle("本机一码通已不可用")
                .setMessage("此凭证已过期或加密数据已失效。请导入保存的二维码截图并向服务器查证。")
                .setPositiveButton("知道了", null).show()
            return
        }
        // The existing opaque pass is only decoded in native Kotlin. Neither
        // the webpage nor the Android photo gallery receives a token copy.
        val picture = ImageView(this).apply {
            setImageBitmap(ActivityPassQr.bitmap(receipt, 720))
            adjustViewBounds = true
            scaleType = ImageView.ScaleType.FIT_CENTER
            layoutParams = LinearLayout.LayoutParams(
                ViewGroup.LayoutParams.MATCH_PARENT, dp(285)
            )
            contentDescription = "本场活动的离线一码通二维码，请仅向授权工作人员展示"
        }
        val caption = TextView(this).apply {
            text = "此码与原始报名二维码完全相同，可离线展示、截图备份。\n" +
                "持码者也可以查看报名，请勿公开转发。\n" +
                "离线状态不是有效性证明；工作人员仍须联网核销、当面确认身份。"
            textSize = 13f
            setPadding(dp(4), dp(8), dp(4), dp(4))
        }
        val layout = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(14), dp(4), dp(14), dp(4))
            addView(picture)
            addView(caption)
        }
        AlertDialog.Builder(this).setTitle("离线一码通 · " + title)
            .setView(layout).setPositiveButton("关闭", null).show()
    }

    /** Avoid a false 12-second network timeout on same-document fragment navigation. */
    private fun navigateToSavedEvent(eventId: String) {
        val destination = STAGE + "#event=" + eventId
        val current = Uri.parse(webView.url ?: "")
        if (pageCommitted && !pageLoadFailed && isStageUri(current) &&
            (current.path == "/" || current.path.isNullOrEmpty())) {
            // The current WebView is already loaded: frontend hashchange handler
            // fetches the server-confirmed status. No second page commit occurs.
            loadNotice.visibility = View.GONE
            webView.loadUrl(destination)
        } else {
            loadPortal(destination)
        }
    }

    private fun restoreOneCodeAndVerify(eventId: String) {
        val receipt = localPasses.readReceipt(eventId)
        val name = ActivityPassRules.cookieName(eventId)
        if (receipt == null || name == null) {
            showPortalNotice("此本机凭证已过期或不可用，请导入截图核验")
            return
        }
        CookieManager.getInstance().setCookie(
            STAGE, name + "=" + receipt + "; Path=/api; Secure; HttpOnly; SameSite=Strict"
        ) { applied ->
            if (applied == true) {
                CookieManager.getInstance().flush()
                // UUID is public; raw bearer stays in native CookieManager.
                navigateToSavedEvent(eventId)
            } else showPortalNotice("无法恢复本机凭证，请导入二维码截图")
        }
    }

    private fun openLocalPassShelf() {
        try {
            val items = localPasses.listSummaries()
            if (items.length() == 0) {
                AlertDialog.Builder(this).setTitle("我的活动 · 本机加密票夹")
                    .setMessage(
                        "还没有已保存的报名。活动报名后会自动保存在本机。" +
                            "请务必另外截图备份一码通，清除应用数据或卸载后本机记录会消失。"
                    ).setPositiveButton("知道了", null).show()
                return
            }
            val labels = Array(items.length()) { index ->
                val row = items.getJSONObject(index)
                val state = if (row.optBoolean("attended")) "已签到" else
                    when (row.optString("state")) {
                        "approved" -> "审核通过"
                        "pending" -> "审核中"
                        else -> "待补交 / 驳回"
                    }
                row.optString("title", "活动") + " · 上次同步：" + state
            }
            AlertDialog.Builder(this).setTitle("本机已参与活动 · 离线可出示二维码")
                .setItems(labels) { _, index ->
                    val row = items.getJSONObject(index)
                    val eventId = row.optString("eventId")
                    val title = row.optString("title", "活动")
                    AlertDialog.Builder(this).setTitle(title)
                        .setMessage("同一个一码通贯穿报名、查询和签到。离线出示只用于现场展示，不会离线核销。")
                        .setPositiveButton("离线出示一码通") { _, _ ->
                            runCatching { showOfflineOneCode(eventId, title) }
                                .onFailure { showPortalNotice("本机二维码暂无法生成，请使用保存的原截图") }
                        }
                        .setNeutralButton("联网核验当前状态") { _, _ ->
                            restoreOneCodeAndVerify(eventId)
                        }
                        .setNegativeButton("取消", null)
                        .show()
                }
                .setNegativeButton("关闭", null)
                .show()
        } catch (_: Exception) {
            showPortalNotice("本机加密票夹无法读取。仍可使用已保存的二维码截图查验。")
        }
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        val url = when (intent.getStringExtra(EXTRA_DESTINATION)) {
            "stage" -> STAGE
            "showcase" -> SHOWCASE
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
            text = "活动速签 · 免登录一码通"
            textSize = 18f
            setTextColor(ink)
            setTypeface(null, android.graphics.Typeface.BOLD)
        }
        val subtitle = TextView(this).apply {
            text = "活动列表免登录 · 本机加密保存 · 请截图备份 · 仅虚构资料"
            textSize = 11f
            setTextColor(Color.parseColor(if (dark) "#B9C8E1" else "#506887"))
            setPadding(0, dp(5), 0, 0)
        }
        header.addView(back)
        header.addView(title)
        header.addView(subtitle)
        if (url == STAGE) {
            val localShelf = TextView(this).apply {
                text = "▣ 我的活动（本机加密票夹）"
                textSize = 14f
                setTextColor(ink)
                setPadding(0, dp(12), 0, dp(8))
                isClickable = true
                isFocusable = true
                contentDescription = "查看本机保存的参与活动，必要时联网验证"
                setOnClickListener { openLocalPassShelf() }
            }
            header.addView(localShelf)
        }
        content.addView(header)

        loadNoticeText = TextView(this).apply {
            textSize = 14f
            setTextColor(ink)
            setPadding(0, 0, 0, dp(10))
        }
        val retry = TextView(this).apply {
            text = "重试连接"
            textSize = 15f
            setTextColor(Color.parseColor(if (dark) "#AFC9FF" else "#245DA8"))
            isClickable = true
            isFocusable = true
            contentDescription = "重试加载活动测试站"
            setOnClickListener { loadPortal(url) }
        }
        loadNotice = LinearLayout(this).apply {
            orientation = LinearLayout.VERTICAL
            setPadding(dp(17), dp(15), dp(17), dp(15))
            setBackgroundColor(Color.parseColor(if (dark) "#344052" else "#E8F0FC"))
            visibility = View.GONE
            addView(loadNoticeText)
            addView(retry)
        }
        content.addView(loadNotice)

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
        if (url == STAGE) {
            // Fail closed if WebView lacks the exact-origin listener feature.
            // Ordinary website enrollment and screenshot recovery still work.
            installActivityVaultBridge()
        }
        webView.webViewClient = object : WebViewClient() {
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
                showPortalNotice("活动站证书验证失败，已阻止不安全连接。请检查网络后重试。", failed = true)
            }

            override fun onReceivedError(
                view: WebView, request: WebResourceRequest, error: WebResourceError
            ) {
                if (request.isForMainFrame) {
                    showPortalNotice("活动测试站加载失败。请检查校园网认证及网络连接后重试。", failed = true)
                }
            }

            override fun onPageCommitVisible(view: WebView, url: String) {
                pageCommitted = true
                if (!pageLoadFailed) loadNotice.visibility = View.GONE
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
                val picker = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                    type = "image/*"
                    addCategory(Intent.CATEGORY_OPENABLE)
                    addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                    putExtra(Intent.EXTRA_ALLOW_MULTIPLE, false)
                }
                return try {
                    startActivityForResult(
                        Intent.createChooser(picker, "选择相册或文件中的一码通截图"),
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
        loadPortal(url)
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
            val result = if (resultCode == RESULT_OK) {
                WebChromeClient.FileChooserParams.parseResult(resultCode, data)
                    ?: data?.data?.let { arrayOf(it) }
                    ?: data?.clipData?.let { clip ->
                        Array(clip.itemCount) { index -> clip.getItemAt(index).uri }
                    }
            } else null
            callback?.onReceiveValue(result)
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
        ++loadGeneration
        loadHandler.removeCallbacksAndMessages(null)
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

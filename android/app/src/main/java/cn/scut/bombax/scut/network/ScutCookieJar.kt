package cn.scut.bombax.scut.network

import cn.scut.bombax.scut.ScutEndpoints
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

/**
 * In-memory cookie store.
 *
 * Session cookies (TGC, locSession, JSESSIONID) stay in this process and are
 * never persisted and never handed to the WebView. Only SCUT hosts are trusted;
 * anything else gets nothing back.
 *
 * The DXC chain additionally sets explicit Cookie headers, mirroring the old
 * implementation. Values are kept until a device trace proves they are
 * unnecessary, so nothing is dropped here.
 */
class ScutCookieJar : CookieJar {

    private val lock = Any()
    private val byHost = LinkedHashMap<String, LinkedHashMap<String, Cookie>>()

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        if (!ScutEndpoints.isScutHost(url.host)) return
        synchronized(lock) {
            val hostBucket = byHost.getOrPut(url.host) { LinkedHashMap() }
            for (cookie in cookies) {
                if (cookie.expiresAt in 1 until System.currentTimeMillis()) {
                    hostBucket.remove(cookie.name)
                } else {
                    hostBucket[cookie.name] = cookie
                }
            }
        }
    }

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        if (!ScutEndpoints.isScutHost(url.host)) return emptyList()
        val now = System.currentTimeMillis()
        synchronized(lock) {
            val hostBucket = byHost[url.host] ?: return emptyList()
            val out = ArrayList<Cookie>(hostBucket.size)
            val expired = ArrayList<String>()
            for ((name, cookie) in hostBucket) {
                if (cookie.expiresAt in 1 until now) {
                    expired.add(name)
                } else if (cookie.matches(url)) {
                    out.add(cookie)
                }
            }
            expired.forEach { hostBucket.remove(it) }
            return out
        }
    }

    /** Value of a stored cookie by name, for the DXC redirect chain. */
    fun value(name: String): String? = synchronized(lock) {
        byHost.values.asSequence()
            .flatMap { it.entries.asSequence() }
            .filter { it.key == name }
            .lastOrNull()
            ?.value
            ?.value
    }

    fun has(name: String): Boolean = value(name) != null

    fun snapshotNames(): List<String> = synchronized(lock) {
        byHost.values.flatMap { it.keys }.distinct().sorted()
    }

    fun clear() {
        synchronized(lock) {
            byHost.clear()
        }
    }
}

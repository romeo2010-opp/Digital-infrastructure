package com.example.smartlink.data.network

import android.content.Context
import okhttp3.Cookie
import okhttp3.CookieJar
import okhttp3.HttpUrl

class PersistentCookieJar(context: Context) : CookieJar {
    private val preferences = context.getSharedPreferences("smartlink_cookie_jar", Context.MODE_PRIVATE)

    override fun loadForRequest(url: HttpUrl): List<Cookie> {
        val all = preferences.all.values.mapNotNull { value ->
            runCatching { Cookie.parse(url, value as? String ?: return@mapNotNull null) }.getOrNull()
        }
        val now = System.currentTimeMillis()
        val valid = all.filter { it.expiresAt > now && domainMatches(url.host, it.domain) && pathMatches(url.encodedPath, it.path) }
        if (valid.size != all.size) {
            persist(valid)
        }
        return valid
    }

    override fun saveFromResponse(url: HttpUrl, cookies: List<Cookie>) {
        val current = loadForRequest(url).associateBy { it.name }
        val merged = current.toMutableMap()
        cookies.forEach { cookie ->
            if (cookie.expiresAt <= System.currentTimeMillis()) {
                merged.remove(cookie.name)
            } else {
                merged[cookie.name] = cookie
            }
        }
        persist(merged.values.toList())
    }

    fun clear() {
        preferences.edit().clear().apply()
    }

    private fun persist(cookies: List<Cookie>) {
        val editor = preferences.edit().clear()
        cookies.forEachIndexed { index, cookie ->
            editor.putString("cookie_$index", cookie.toString())
        }
        editor.apply()
    }

    private fun domainMatches(host: String, domain: String): Boolean {
        val normalizedDomain = domain.removePrefix(".")
        return host == normalizedDomain || host.endsWith(".$normalizedDomain")
    }

    private fun pathMatches(path: String, cookiePath: String): Boolean {
        return path == cookiePath || path.startsWith(cookiePath)
    }
}

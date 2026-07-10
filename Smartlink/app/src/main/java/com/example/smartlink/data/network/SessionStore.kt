package com.example.smartlink.data.network

import android.content.Context

/** Stores only the authenticated SmartLink Schools session. */
class SessionStore(context: Context) {
    private val preferences = context.getSharedPreferences("smartlink_schools_session", Context.MODE_PRIVATE)

    var accessToken: String
        get() = preferences.getString(KEY_ACCESS_TOKEN, "").orEmpty()
        set(value) { preferences.edit().putString(KEY_ACCESS_TOKEN, value.trim()).apply() }

    fun clearAuth() { preferences.edit().clear().apply() }

    private companion object { const val KEY_ACCESS_TOKEN = "access_token" }
}

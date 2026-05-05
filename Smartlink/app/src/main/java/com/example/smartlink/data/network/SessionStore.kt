package com.example.smartlink.data.network

import android.content.Context
import android.content.SharedPreferences

class SessionStore(context: Context) {
    private val preferences: SharedPreferences =
        context.getSharedPreferences("smartlink_user_session", Context.MODE_PRIVATE)

    var accessToken: String
        get() = preferences.getString(KEY_ACCESS_TOKEN, "").orEmpty()
        set(value) {
            preferences.edit().putString(KEY_ACCESS_TOKEN, value.trim()).apply()
        }

    var sessionJson: String
        get() = preferences.getString(KEY_SESSION_JSON, "").orEmpty()
        set(value) {
            preferences.edit().putString(KEY_SESSION_JSON, value).apply()
        }

    var activeQueueJoinId: String
        get() = preferences.getString(KEY_ACTIVE_QUEUE_JOIN_ID, "").orEmpty()
        set(value) {
            preferences.edit().putString(KEY_ACTIVE_QUEUE_JOIN_ID, value.trim()).apply()
        }

    var activeFuelOrderId: String
        get() = preferences.getString(KEY_ACTIVE_FUEL_ORDER_ID, "").orEmpty()
        set(value) {
            preferences.edit().putString(KEY_ACTIVE_FUEL_ORDER_ID, value.trim()).apply()
        }

    var favoriteStationIds: Set<String>
        get() = preferences.getStringSet(KEY_FAVORITES, emptySet()).orEmpty()
        set(value) {
            preferences.edit().putStringSet(KEY_FAVORITES, value).apply()
        }

    var themePreference: String
        get() = preferences.getString(KEY_THEME, "light").orEmpty()
        set(value) {
            preferences.edit().putString(KEY_THEME, value).apply()
        }

    fun clearAuth() {
        preferences.edit()
            .remove(KEY_ACCESS_TOKEN)
            .remove(KEY_SESSION_JSON)
            .remove(KEY_ACTIVE_QUEUE_JOIN_ID)
            .remove(KEY_ACTIVE_FUEL_ORDER_ID)
            .apply()
    }

    companion object {
        private const val KEY_ACCESS_TOKEN = "access_token"
        private const val KEY_SESSION_JSON = "session_json"
        private const val KEY_ACTIVE_QUEUE_JOIN_ID = "active_queue_join_id"
        private const val KEY_ACTIVE_FUEL_ORDER_ID = "active_fuel_order_id"
        private const val KEY_FAVORITES = "favorite_station_ids"
        private const val KEY_THEME = "theme_preference"
    }
}

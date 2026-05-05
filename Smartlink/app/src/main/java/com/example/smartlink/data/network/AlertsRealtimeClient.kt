package com.example.smartlink.data.network

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.Request
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import okio.ByteString

class AlertsRealtimeClient(private val apiClient: SmartlinkApiClient) {
    private val json = Json { ignoreUnknownKeys = true }
    private var socket: WebSocket? = null

    fun connect(
        accessToken: String,
        onMessage: (type: String, payload: kotlinx.serialization.json.JsonObject) -> Unit,
        onClosed: (code: Int, reason: String) -> Unit,
        onFailure: (Throwable) -> Unit,
    ) {
        disconnect()
        val url = apiClient.userAlertsWebSocketUrl(accessToken)
        val request = Request.Builder().url(url).build()
        socket = apiClient.websocketClient().newWebSocket(request, object : WebSocketListener() {
            override fun onMessage(webSocket: WebSocket, text: String) {
                runCatching {
                    val root = json.parseToJsonElement(text).jsonObject
                    val type = root["type"]?.jsonPrimitive?.content.orEmpty()
                    val data = root["data"]?.jsonObject ?: EmptyJsonObject
                    onMessage(type, data)
                }.onFailure(onFailure)
            }

            override fun onMessage(webSocket: WebSocket, bytes: ByteString) {
                onMessage(webSocket, bytes.utf8())
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                onClosed(code, reason)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: okhttp3.Response?) {
                onFailure(t)
            }
        })
    }

    fun disconnect() {
        socket?.close(1000, "client_disconnect")
        socket = null
    }
}

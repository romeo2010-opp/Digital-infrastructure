package com.example.smartlink.data.network

import android.content.Context
import com.example.smartlink.BuildConfig
import okhttp3.HttpUrl.Companion.toHttpUrl
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.logging.HttpLoggingInterceptor
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.IOException
import java.util.concurrent.TimeUnit

class SmartlinkApiClient(context: Context) {
    private val sessionStore = SessionStore(context)
    private val cookieJar = PersistentCookieJar(context)
    private val json = Json {
        ignoreUnknownKeys = true
        isLenient = true
    }
    private val baseUrl = BuildConfig.API_BASE_URL.toHttpUrl()
    private val mediaType = "application/json".toMediaType()

    private val httpClient = OkHttpClient.Builder()
        .cookieJar(cookieJar)
        .connectTimeout(20, TimeUnit.SECONDS)
        .readTimeout(30, TimeUnit.SECONDS)
        .addInterceptor(HttpLoggingInterceptor().apply {
            level = HttpLoggingInterceptor.Level.BASIC
        })
        .build()

    fun sessionStore(): SessionStore = sessionStore

    fun clearSession() {
        sessionStore.clearAuth()
        cookieJar.clear()
    }

    suspend fun register(fullName: String, phone: String, email: String, password: String): JsonObject =
        publicRequest(
            "/auth/register",
            body = jsonObjectOf(
                "fullName" to stringElement(fullName),
                "phone" to stringElement(phone),
                "email" to stringElement(email),
                "password" to stringElement(password),
            )
        )

    suspend fun login(identifier: String, password: String): JsonObject {
        val trimmed = identifier.trim()
        val isEmail = trimmed.contains("@")
        return publicRequest(
            "/auth/login",
            body = jsonObjectOf(
                ((if (isEmail) "email" else "phone") to stringElement(trimmed)),
                "password" to stringElement(password),
            )
        )
    }

    suspend fun refresh(): String {
        val data = publicRequest("/auth/refresh", method = "POST")
        val token = data.string("accessToken")
        if (token.isBlank()) throw IOException("Refresh did not return access token")
        sessionStore.accessToken = token
        return token
    }

    suspend fun me(): JsonObject = authRequest("/auth/me", method = "GET")

    suspend fun updateProfile(fullName: String, phone: String, email: String): JsonObject =
        authRequest(
            "/auth/me",
            method = "PATCH",
            body = jsonObjectOf(
                "fullName" to stringElement(fullName),
                "phone" to stringElement(phone),
                "email" to stringElement(email),
            )
        )

    suspend fun logout(): JsonObject = authRequest("/api/auth/logout", method = "POST")

    suspend fun listStations(): JsonArray = authRequest("/api/user/stations", method = "GET").asArray()
    suspend fun stationFuelStatus(stationPublicId: String): JsonObject =
        authRequest("/api/user/stations/${encode(stationPublicId)}/fuel-status", method = "GET")
    suspend fun stationPromotionPreview(stationPublicId: String, fuelTypeCode: String, litres: Int, paymentMethod: String): JsonObject =
        authRequest(
            "/api/user/stations/${encode(stationPublicId)}/promotions/preview?fuelTypeCode=${encode(fuelTypeCode)}&litres=$litres&paymentMethod=${encode(paymentMethod)}",
            method = "GET",
        )

    suspend fun activeQueue(): JsonObject = authRequest("/api/user/queue/active", method = "GET")
    suspend fun queueStatus(queueJoinId: String): JsonObject = authRequest("/api/user/queue/${encode(queueJoinId)}/status", method = "GET")
    suspend fun joinQueue(stationPublicId: String, fuelType: String, maskedPlate: String?, requestedLiters: Int?, prepay: Boolean?): JsonObject =
        authRequest(
            "/api/user/stations/${encode(stationPublicId)}/queue/join",
            body = jsonObjectOf(
                "fuelType" to stringElement(fuelType),
                "maskedPlate" to stringElement(maskedPlate),
                "requestedLiters" to requestedLiters?.let { JsonPrimitive(it) },
                "prepay" to booleanElement(prepay),
            )
        )
    suspend fun scanPumpQr(queueJoinId: String, qrToken: String): JsonObject =
        authRequest("/api/user/queue/${encode(queueJoinId)}/pump-scan", body = jsonObjectOf("qrToken" to stringElement(qrToken)))
    suspend fun dispenseRequest(queueJoinId: String, liters: Int, prepay: Boolean?): JsonObject =
        authRequest("/api/user/queue/${encode(queueJoinId)}/dispense-request", body = jsonObjectOf("liters" to JsonPrimitive(liters), "prepay" to booleanElement(prepay)))
    suspend fun leaveQueue(queueJoinId: String, reason: String? = null): JsonObject =
        authRequest("/api/user/queue/${encode(queueJoinId)}/leave", body = jsonObjectOf("reason" to stringElement(reason)))
    suspend fun reportQueueIssue(queueJoinId: String, issueType: String, message: String): JsonObject =
        authRequest("/api/user/queue/${encode(queueJoinId)}/report-issue", body = jsonObjectOf("issueType" to stringElement(issueType), "message" to stringElement(message)))

    suspend fun reservationSlots(stationPublicId: String, fuelType: String = "PETROL", lookAhead: Int = 8): JsonObject =
        authRequest("/api/user/stations/${encode(stationPublicId)}/reservations/slots?fuelType=${encode(fuelType)}&lookAhead=$lookAhead&_ts=${System.currentTimeMillis()}", method = "GET")
    suspend fun createReservation(stationPublicId: String, body: JsonObject): JsonObject =
        authRequest("/api/user/stations/${encode(stationPublicId)}/reservations", body = body)
    suspend fun reservations(): JsonArray = authRequest("/api/user/reservations", method = "GET").asArray()
    suspend fun cancelReservation(reservationPublicId: String, reason: String? = null): JsonObject =
        authRequest("/api/user/reservations/${encode(reservationPublicId)}/cancel", body = jsonObjectOf("reason" to stringElement(reason)))
    suspend fun checkInReservation(reservationPublicId: String, body: JsonObject): JsonObject =
        authRequest("/api/user/reservations/${encode(reservationPublicId)}/check-in", body = body)

    suspend fun walletSummary(): JsonObject = authRequest("/api/user/wallet/me", method = "GET")
    suspend fun walletTransactions(page: Int = 1, limit: Int = 20, type: String? = null, status: String? = null): JsonObject {
        val query = buildList {
            add("page=$page")
            add("limit=$limit")
            type?.takeIf { it.isNotBlank() }?.let { add("type=${encode(it)}") }
            status?.takeIf { it.isNotBlank() }?.let { add("status=${encode(it)}") }
        }.joinToString("&")
        return authRequest("/api/user/wallet/me/transactions?$query", method = "GET")
    }
    suspend fun walletHolds(status: String = "ACTIVE", limit: Int = 20): JsonObject =
        authRequest("/api/user/wallet/me/holds?status=${encode(status)}&limit=$limit", method = "GET")
    suspend fun walletRecipientQr(): JsonObject = authRequest("/api/user/wallet/me/transfers/recipient-qr", method = "GET")
    suspend fun walletTransferPreview(body: JsonObject): JsonObject = authRequest("/api/user/wallet/me/transfers/preview", body = body)
    suspend fun createWalletTransfer(body: JsonObject): JsonObject = authRequest("/api/user/wallet/me/transfers", body = body)
    suspend fun walletTransferHistory(page: Int = 1, limit: Int = 20): JsonObject =
        authRequest("/api/user/wallet/me/transfers/history?page=$page&limit=$limit", method = "GET")
    suspend fun walletStationLockedBalances(): JsonObject = authRequest("/api/user/wallet/me/station-locked-balances", method = "GET")
    suspend fun createWalletTopup(amount: Double, note: String? = null): JsonObject =
        authRequest("/api/user/wallet/me/topups", body = jsonObjectOf("amount" to JsonPrimitive(amount), "note" to stringElement(note)))
    suspend fun walletRefunds(): JsonObject = authRequest("/api/user/wallet/me/refunds", method = "GET")
    suspend fun createWalletRefund(transactionPublicId: String, amount: Double, reason: String): JsonObject =
        authRequest("/api/user/wallet/me/refunds", body = jsonObjectOf("transactionPublicId" to stringElement(transactionPublicId), "amount" to JsonPrimitive(amount), "reason" to stringElement(reason)))

    suspend fun createManualFuelOrder(body: JsonObject): JsonObject = authRequest("/api/fuel-orders/manual-wallet", body = body)
    suspend fun fuelOrder(fuelOrderId: String): JsonObject = authRequest("/api/fuel-orders/${encode(fuelOrderId)}", method = "GET")
    suspend fun cancelFuelOrder(fuelOrderId: String, reason: String? = null): JsonObject =
        authRequest("/api/fuel-orders/${encode(fuelOrderId)}/cancel", body = jsonObjectOf("reason" to stringElement(reason)))

    suspend fun history(from: String? = null, to: String? = null): JsonObject {
        val query = buildList {
            from?.takeIf { it.isNotBlank() }?.let { add("from=${encode(it)}") }
            to?.takeIf { it.isNotBlank() }?.let { add("to=${encode(it)}") }
        }.joinToString("&")
        return authRequest("/api/user/history${if (query.isNotBlank()) "?$query" else ""}", method = "GET")
    }

    suspend fun alerts(limit: Int = 100): JsonObject = authRequest("/api/user/alerts?limit=$limit", method = "GET")
    suspend fun archivedAlerts(limit: Int = 200): JsonObject = authRequest("/api/user/alerts/archived?limit=$limit", method = "GET")
    suspend fun markAlertRead(alertPublicId: String): JsonObject = authRequest("/api/user/alerts/${encode(alertPublicId)}/read", body = EmptyJsonObject)
    suspend fun archiveAlert(alertPublicId: String): JsonObject = authRequest("/api/user/alerts/${encode(alertPublicId)}/archive", body = EmptyJsonObject)

    suspend fun supportConfig(): JsonObject = authRequest("/api/support/config", method = "GET")
    suspend fun supportTickets(): JsonObject = authRequest("/api/support/tickets", method = "GET")

    suspend fun resolveScanAndGo(code: String): JsonObject = authRequest("/api/user/scan-and-go/resolve", body = jsonObjectOf("code" to stringElement(code)))
    suspend fun payScanAndGo(code: String): JsonObject = authRequest("/api/user/scan-and-go/pay", body = jsonObjectOf("code" to stringElement(code)))

    suspend fun assistantRespond(message: String, sessionToken: String = "", actionId: String = "", actionPayload: JsonObject = EmptyJsonObject, currentLocation: JsonObject? = null): JsonObject =
        authRequest(
            "/api/user/assistant/respond",
            body = jsonObjectOf(
                "message" to stringElement(message),
                "sessionToken" to stringElement(sessionToken),
                "actionId" to stringElement(actionId),
                "actionPayload" to actionPayload,
                "currentLocation" to currentLocation,
            )
        )
    suspend fun assistantConfirm(confirmationToken: String): JsonObject =
        authRequest("/api/user/assistant/confirm", body = jsonObjectOf("confirmationToken" to stringElement(confirmationToken)))

    suspend fun beginPasskeyLogin(): JsonObject = publicRequest("/auth/passkeys/login/options", method = "POST")
    suspend fun completePasskeyLogin(body: JsonObject): JsonObject = publicRequest("/auth/passkeys/login/verify", body = body)
    suspend fun beginPasskeyRegistration(): JsonObject = authRequest("/auth/passkeys/register/options", body = EmptyJsonObject)
    suspend fun completePasskeyRegistration(body: JsonObject): JsonObject = authRequest("/auth/passkeys/register/verify", body = body)
    suspend fun listPasskeys(): JsonObject = authRequest("/auth/passkeys", method = "GET")
    suspend fun removePasskey(passkeyPublicId: String): JsonObject = authRequest("/auth/passkeys/${encode(passkeyPublicId)}", method = "DELETE")

    fun websocketUrl(path: String, params: Map<String, String>): String {
        val builder = baseUrl.newBuilder().encodedPath(path)
        params.forEach { (key, value) -> builder.addQueryParameter(key, value) }
        val url = builder.build().toString()
        return if (baseUrl.isHttps) {
            url.replaceFirst("https://", "wss://")
        } else {
            url.replaceFirst("http://", "ws://")
        }
    }

    fun userAlertsWebSocketUrl(accessToken: String): String =
        websocketUrl("/ws/user-alerts", mapOf("accessToken" to accessToken))

    fun userQueueWebSocketUrl(accessToken: String, queueJoinId: String): String =
        websocketUrl("/ws/user-queue", mapOf("accessToken" to accessToken, "queueJoinId" to queueJoinId))

    fun userStationChangesWebSocketUrl(accessToken: String, stationPublicId: String): String =
        websocketUrl("/ws/user-station-changes", mapOf("accessToken" to accessToken, "stationPublicId" to stationPublicId))

    fun websocketClient(): OkHttpClient = httpClient

    private suspend fun publicRequest(
        path: String,
        method: String = "POST",
        body: JsonObject? = null,
    ): JsonObject = performRequest(path, method, body, null, retryOnAuth = false)

    private suspend fun authRequest(
        path: String,
        method: String = "POST",
        body: JsonObject? = null,
    ): JsonObject {
        val token = sessionStore.accessToken.ifBlank { refresh() }
        return performRequest(path, method, body, token, retryOnAuth = true)
    }

    private suspend fun performRequest(
        path: String,
        method: String,
        body: JsonObject?,
        token: String?,
        retryOnAuth: Boolean,
    ): JsonObject = withContext(Dispatchers.IO) {
        val requestBuilder = Request.Builder().url(baseUrl.newBuilder().encodedPath(path.substringBefore("?")).apply {
            path.substringAfter("?", "").takeIf { it.isNotBlank() }?.let { encodedQuery(it) }
        }.build())
        if (!token.isNullOrBlank()) {
            requestBuilder.header("Authorization", "Bearer $token")
        }
        val requestBody = body?.toString()?.toRequestBody(mediaType)
        when (method.uppercase()) {
            "GET" -> requestBuilder.get()
            "DELETE" -> requestBuilder.delete(requestBody)
            "PATCH" -> requestBuilder.patch(requestBody ?: EmptyJsonObject.toString().toRequestBody(mediaType))
            "POST" -> requestBuilder.post(requestBody ?: EmptyJsonObject.toString().toRequestBody(mediaType))
            else -> requestBuilder.method(method.uppercase(), requestBody)
        }

        httpClient.newCall(requestBuilder.build()).execute().use { response ->
            val payload = response.body?.string().orEmpty()
            val parsed = parseEnvelope(payload, response.code)
            if (response.code == 401 && retryOnAuth) {
                val refreshed = refresh()
                performRequest(path, method, body, refreshed, false)
            } else {
                if (!response.isSuccessful) {
                    throw IOException(parsed.second.ifBlank { "Request failed (${response.code})" })
                }
                parsed.first
            }
        }
    }

    private fun parseEnvelope(payload: String, code: Int): Pair<JsonObject, String> {
        if (payload.isBlank()) return EmptyJsonObject to "Request failed ($code)"
        val root = json.parseToJsonElement(payload).jsonObject
        val ok = root["ok"]?.jsonPrimitive?.contentOrNull?.toBooleanStrictOrNull()
            ?: root["ok"]?.jsonPrimitive?.booleanOrNull
            ?: true
        val error = root["error"]?.jsonPrimitive?.contentOrNull.orEmpty()
        val data = root["data"]?.jsonObject ?: root["data"]?.let { if (it is JsonObject) it else JsonObject(mapOf("items" to it)) } ?: EmptyJsonObject
        if (!ok) {
            return data to error
        }
        return data to error
    }

    private fun JsonObject.asArray(): JsonArray {
        return this["items"] as? JsonArray ?: EmptyJsonArray
    }

    private fun encode(value: String): String = java.net.URLEncoder.encode(value, "UTF-8")
}

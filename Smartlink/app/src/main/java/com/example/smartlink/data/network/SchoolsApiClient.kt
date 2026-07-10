package com.example.smartlink.data.network

import android.content.Context
import com.example.smartlink.BuildConfig
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import java.io.IOException
import java.util.concurrent.TimeUnit

/** Small API layer mirroring smartlink-schools/client/src/app/lib/portalApi.ts. */
class SchoolsApiClient(context: Context) {
    private val store = SessionStore(context)
    private val json = Json { ignoreUnknownKeys = true; isLenient = true }
    private val client = OkHttpClient.Builder().connectTimeout(15, TimeUnit.SECONDS).readTimeout(25, TimeUnit.SECONDS).build()
    private val base = BuildConfig.API_BASE_URL.trimEnd('/')
    private val type = "application/json".toMediaType()

    data class Session(val token: String, val name: String, val role: String, val school: String)
    fun savedToken() = store.accessToken
    fun clear() = store.clearAuth()

    suspend fun login(identifier: String, password: String, studentLogin: Boolean): Session {
        val body = buildMap<String, JsonElement> {
            put(if (studentLogin) "studentCode" else "email", JsonPrimitive(identifier.trim()))
            put("password", JsonPrimitive(password))
            put("loginType", JsonPrimitive(if (studentLogin) "student" else "staff"))
        }
        val payload = request("/api/auth/login", "POST", JsonObject(body), null)
        val token = payload.text("token").ifBlank { payload.text("accessToken") }
        if (token.isBlank()) throw IOException("The school server did not return a session token.")
        store.accessToken = token
        val user = payload["user"] as? JsonObject ?: payload
        return Session(token, user.text("name").ifBlank { user.text("fullName") }.ifBlank { "SmartLink member" }, user.text("role").ifBlank { if (studentLogin) "STUDENT" else "STAFF" }, user.text("schoolName").ifBlank { "SmartLink Schools" })
    }

    suspend fun session(): Session? = runCatching {
        val p = request("/api/auth/me", "GET", null, savedToken())
        val u = p["user"] as? JsonObject ?: p
        Session(savedToken(), u.text("name").ifBlank { u.text("fullName") }, u.text("role"), u.text("schoolName").ifBlank { "SmartLink Schools" })
    }.getOrNull()
    suspend fun dashboard(token: String) = request("/api/dashboard", "GET", null, token)
    suspend fun studentPortal(token: String) = request("/api/student-portal", "GET", null, token)
    suspend fun todayDrill(token: String) = request("/api/drills/today", "GET", null, token)
    suspend fun answerDrill(token: String, drillId: String, questionId: String, answer: String) = request("/api/drills/$drillId/answer", "POST", JsonObject(mapOf("session_question_id" to JsonPrimitive(questionId), "answer" to JsonPrimitive(answer))), token)
    suspend fun submitDrill(token: String, drillId: String) = request("/api/drills/$drillId/submit", "POST", null, token)
    suspend fun reactToAnnouncement(token: String, announcementId: String, reaction: String) = request("/api/student-portal/announcements/$announcementId/reaction", "POST", JsonObject(mapOf("reaction" to JsonPrimitive(reaction))), token)
    suspend fun downloadReportCard(token: String, reportId: String): ByteArray = download("/api/report-cards/$reportId/pdf", token)
    suspend fun students(token: String) = request("/api/students?limit=30", "GET", null, token)
    suspend fun fees(token: String) = request("/api/fees/dashboard", "GET", null, token)
    suspend fun teacherToday(token: String) = request("/api/teacher/today", "GET", null, token)
    suspend fun notifications(token: String) = request("/api/notifications?limit=20", "GET", null, token)

    private suspend fun request(path: String, method: String, body: JsonObject?, token: String?): JsonObject = withContext(Dispatchers.IO) {
        val builder = Request.Builder().url(base + path).header("Accept", "application/json")
        if (!token.isNullOrBlank()) builder.header("Authorization", "Bearer $token")
        when (method) { "POST" -> builder.post((body ?: JsonObject(emptyMap())).toString().toRequestBody(type)); else -> builder.get() }
        client.newCall(builder.build()).execute().use { response ->
            val raw = response.body?.string().orEmpty()
            val root = runCatching { json.parseToJsonElement(raw).jsonObject }.getOrElse { JsonObject(emptyMap()) }
            val message = root.text("error").ifBlank { root.text("message") }
            if (!response.isSuccessful || root["ok"]?.jsonPrimitive?.contentOrNull == "false") throw IOException(message.ifBlank { "Request failed (${response.code})" })
            (root["data"] as? JsonObject) ?: root
        }
    }

    private suspend fun download(path: String, token: String): ByteArray = withContext(Dispatchers.IO) {
        val request = Request.Builder().url(base + path).header("Authorization", "Bearer $token").build()
        client.newCall(request).execute().use { response ->
            if (!response.isSuccessful) throw IOException("Unable to download report (${response.code})")
            response.body?.bytes() ?: throw IOException("The report download was empty.")
        }
    }
}

fun JsonObject.text(key: String): String = this[key]?.jsonPrimitive?.contentOrNull.orEmpty()

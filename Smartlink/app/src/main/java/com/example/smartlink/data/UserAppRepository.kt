package com.example.smartlink.data

import android.content.Context
import com.example.smartlink.data.network.AlertsRealtimeClient
import com.example.smartlink.data.network.EmptyJsonObject
import com.example.smartlink.data.network.SessionStore
import com.example.smartlink.data.network.SmartlinkApiClient
import com.example.smartlink.data.network.arrayOrEmpty
import com.example.smartlink.data.network.boolean
import com.example.smartlink.data.network.double
import com.example.smartlink.data.network.int
import com.example.smartlink.data.network.jsonObjectOf
import com.example.smartlink.data.network.objectOrNull
import com.example.smartlink.data.network.string
import com.example.smartlink.data.network.stringElement
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlin.math.roundToInt

class UserAppRepository(context: Context) {
    private val api = SmartlinkApiClient(context)
    private val alertsRealtimeClient = AlertsRealtimeClient(api)
    val sessionStore: SessionStore = api.sessionStore()

    suspend fun restoreSession(): UserProfile? {
        if (sessionStore.accessToken.isBlank()) {
            runCatching { api.refresh() }.getOrNull() ?: return null
        }
        return runCatching { mapProfile(api.me()) }.getOrNull()
    }

    suspend fun login(identifier: String, password: String): UserProfile {
        val response = api.login(identifier, password)
        val token = response.string("accessToken")
        if (token.isNotBlank()) {
            sessionStore.accessToken = token
        }
        val profile = mapProfile(api.me())
        ensureUserRole(profile)
        return profile
    }

    suspend fun register(fullName: String, phone: String, email: String, password: String): UserProfile {
        val response = api.register(fullName, phone, email, password)
        val token = response.string("accessToken")
        if (token.isNotBlank()) {
            sessionStore.accessToken = token
        }
        val profile = mapProfile(api.me())
        ensureUserRole(profile)
        return profile
    }

    suspend fun logout() {
        runCatching { api.logout() }
        alertsRealtimeClient.disconnect()
        api.clearSession()
    }

    suspend fun updateProfile(fullName: String, phone: String, email: String): UserProfile {
        return mapProfile(api.updateProfile(fullName, phone, email))
    }

    // --- Station Domain ---

    suspend fun stations(): List<Station> =
        api.listStations().mapNotNull { element ->
            (element as? JsonObject)?.let(::mapStation)
        }

    suspend fun stationFuelStatus(stationPublicId: String): StationFuelStatus {
        val data = api.stationFuelStatus(stationPublicId)
        return StationFuelStatus(
            stationPublicId = data.string("stationPublicId"),
            statuses = data.arrayOrEmpty("statuses").mapNotNull { entry ->
                (entry as? JsonObject)?.let {
                    FuelStatusEntry(
                        code = it.string("code"),
                        label = it.string("label"),
                        status = it.string("status"),
                    )
                }
            },
            updatedAt = data.string("updatedAt"),
        )
    }

    suspend fun promotionPreview(
        stationPublicId: String,
        fuelType: String,
        litres: Int,
        paymentMethod: String
    ): PromotionPreviewData {
        val data = api.stationPromotionPreview(stationPublicId, fuelType, litres, paymentMethod)
        return PromotionPreviewData(
            finalPrice = data.double("finalPrice") ?: 0.0,
            originalPrice = data.double("originalPrice") ?: 0.0,
            discountAmount = data.double("discountAmount") ?: 0.0,
            message = data.string("message"),
        )
    }

    // --- Queue Domain ---

    suspend fun activeQueue(): QueueSnapshot? =
        runCatching { mapQueue(api.activeQueue()) }.getOrNull()

    suspend fun joinQueue(
        stationPublicId: String,
        fuelType: String,
        maskedPlate: String,
        requestedLiters: Int,
        prepay: Boolean
    ): QueueSnapshot {
        val payload = api.joinQueue(
            stationPublicId = stationPublicId,
            fuelType = fuelType,
            maskedPlate = maskedPlate,
            requestedLiters = requestedLiters,
            prepay = prepay,
        )
        val queueJoinId = payload.string("queueJoinId").ifBlank { payload.string("publicId") }
        if (queueJoinId.isNotBlank()) {
            sessionStore.activeQueueJoinId = queueJoinId
            return mapQueue(api.queueStatus(queueJoinId))
        }
        return mapQueue(payload)
    }

    suspend fun queueStatus(queueJoinId: String): QueueSnapshot =
        mapQueue(api.queueStatus(queueJoinId))

    suspend fun scanPumpQr(queueJoinId: String, qrToken: String): JsonObject =
        api.scanPumpQr(queueJoinId, qrToken)

    suspend fun dispenseRequest(queueJoinId: String, liters: Int, prepay: Boolean): JsonObject =
        api.dispenseRequest(queueJoinId, liters, prepay)

    suspend fun leaveQueue(queueJoinId: String, reason: String? = null): JsonObject {
        val res = api.leaveQueue(queueJoinId, reason)
        if (sessionStore.activeQueueJoinId == queueJoinId) {
            sessionStore.activeQueueJoinId = ""
        }
        return res
    }

    suspend fun reportQueueIssue(queueJoinId: String, issueType: String, message: String): JsonObject =
        api.reportQueueIssue(queueJoinId, issueType, message)

    // --- Reservation Domain ---

    suspend fun reservationSlots(stationPublicId: String, fuelType: String = "PETROL", lookAhead: Int = 8): JsonArray =
        api.reservationSlots(stationPublicId, fuelType, lookAhead).arrayOrEmpty("slots")

    suspend fun createReservation(stationPublicId: String, body: JsonObject): List<Reservation> {
        api.createReservation(stationPublicId, body)
        return reservations()
    }

    suspend fun reservations(): List<Reservation> =
        mapReservations(api.reservations())

    suspend fun cancelReservation(reservationPublicId: String, reason: String? = null): JsonObject =
        api.cancelReservation(reservationPublicId, reason)

    suspend fun checkInReservation(reservationPublicId: String, method: String, lat: Double? = null, lng: Double? = null, qrToken: String? = null): JsonObject {
        val body = when (method) {
            "GPS" -> jsonObjectOf(
                "method" to JsonPrimitive("GPS"),
                "userLat" to lat?.let { JsonPrimitive(it) },
                "userLng" to lng?.let { JsonPrimitive(it) }
            )
            "QR" -> jsonObjectOf(
                "method" to JsonPrimitive("QR"),
                "qrToken" to qrToken?.let { JsonPrimitive(it) }
            )
            else -> EmptyJsonObject
        }
        return api.checkInReservation(reservationPublicId, body)
    }

    // --- Wallet Domain ---

    suspend fun walletSummary(): WalletSummary {
        val data = api.walletSummary()
        val wallet = data.objectOrNull("wallet") ?: data
        val currency = wallet.string("currencyCode").ifBlank { "MWK" }
        val available = wallet.double("availableBalance") ?: wallet.double("available_balance") ?: 0.0
        val locked = wallet.double("lockedBalance") ?: wallet.double("locked_balance") ?: 0.0
        return WalletSummary(
            walletId = wallet.string("walletId"),
            walletPublicId = wallet.string("walletPublicId"),
            walletNumber = wallet.string("walletNumber"),
            status = wallet.string("status").ifBlank { "ACTIVE" },
            currencyCode = currency,
            ledgerBalance = wallet.double("ledgerBalance") ?: 0.0,
            availableBalance = available,
            lockedBalance = locked,
            pendingInflow = wallet.double("pendingInflow") ?: 0.0,
            pendingOutflow = wallet.double("pendingOutflow") ?: 0.0,
            activeHoldAmount = wallet.double("activeHoldAmount") ?: 0.0,
            balanceLabel = formatMoney(available, currency),
            lockedBalanceLabel = formatMoney(locked, currency),
        )
    }

    suspend fun walletTransactions(page: Int = 1, limit: Int = 20): List<WalletTransaction> {
        val data = api.walletTransactions(page, limit)
        val items = data.arrayOrEmpty("items")
        return items.mapNotNull { (it as? JsonObject)?.let(::mapWalletTransaction) }
    }

    suspend fun walletHolds(): List<WalletHold> {
        val data = api.walletHolds()
        val items = data.arrayOrEmpty("items")
        val currency = "MWK" // Default
        return items.mapNotNull { item ->
            (item as? JsonObject)?.let { row ->
                WalletHold(
                    id = row.string("id").ifBlank { row.string("publicId") },
                    amount = row.double("amount") ?: 0.0,
                    amountLabel = formatMoney(row.double("amount") ?: 0.0, currency),
                    status = row.string("status"),
                    expiresAt = row.string("expiresAt"),
                    reason = row.string("reason"),
                )
            }
        }
    }

    suspend fun walletRecipientQr(): String {
        val data = api.walletRecipientQr()
        return data.string("qrPayload").ifBlank { data.string("qrImage") }
    }

    suspend fun previewTransfer(recipientUserId: String, amountMwk: Double, mode: String = "NORMAL", stationPublicId: String? = null): String {
        val payload = api.walletTransferPreview(
            jsonObjectOf(
                "recipientUserId" to stringElement(recipientUserId),
                "amountMwk" to JsonPrimitive(amountMwk),
                "transferMode" to stringElement(mode),
                "stationPublicId" to stringElement(stationPublicId),
            )
        )
        return payload.string("message").ifBlank {
            "Transfer preview ready for ${recipientUserId.trim()} at ${formatMoney(amountMwk, "MWK")}."
        }
    }

    suspend fun createTransfer(recipientUserId: String, amountMwk: Double, mode: String, note: String, stationPublicId: String? = null): JsonObject {
        return api.createWalletTransfer(
            jsonObjectOf(
                "recipientUserId" to stringElement(recipientUserId),
                "amountMwk" to JsonPrimitive(amountMwk),
                "transferMode" to stringElement(mode),
                "note" to stringElement(note),
                "stationPublicId" to stringElement(stationPublicId),
                "idempotencyKey" to stringElement(java.util.UUID.randomUUID().toString())
            )
        )
    }

    suspend fun createWalletTopup(amount: Double, note: String? = null): JsonObject =
        api.createWalletTopup(amount, note)

    suspend fun createWalletRefund(transactionPublicId: String, amount: Double, reason: String): JsonObject =
        api.createWalletRefund(transactionPublicId, amount, reason)

    // --- Manual Fuel Orders ---

    suspend fun createManualFuelOrder(stationPublicId: String, fuelType: String, amountMwk: Double?, liters: Double?): ManualFuelOrder {
        val data = api.createManualFuelOrder(
            jsonObjectOf(
                "stationPublicId" to stringElement(stationPublicId),
                "fuelType" to stringElement(fuelType),
                "requestedAmountMwk" to amountMwk?.let { JsonPrimitive(it) },
                "requestedLitres" to liters?.let { JsonPrimitive(it) }
            )
        )
        return mapManualFuelOrder(data)
    }

    suspend fun fuelOrder(fuelOrderId: String): ManualFuelOrder =
        mapManualFuelOrder(api.fuelOrder(fuelOrderId))

    suspend fun cancelFuelOrder(fuelOrderId: String, reason: String? = null): JsonObject =
        api.cancelFuelOrder(fuelOrderId, reason)

    // --- History and Alerts ---

    suspend fun history(from: String? = null, to: String? = null): List<HistoryEntry> {
        val data = api.history(from, to)
        val items = data.arrayOrEmpty("items")
        return items.mapNotNull { (it as? JsonObject)?.let(::mapHistory) }
    }

    suspend fun alerts(limit: Int = 100): List<UserAlert> {
        val data = api.alerts(limit)
        val items = data.arrayOrEmpty("items")
        return items.mapNotNull { (it as? JsonObject)?.let(::mapAlert) }
    }

    suspend fun archivedAlerts(limit: Int = 200): List<UserAlert> {
        val data = api.archivedAlerts(limit)
        val items = data.arrayOrEmpty("items")
        return items.mapNotNull { (it as? JsonObject)?.let(::mapAlert) }
    }

    suspend fun markAlertRead(alertPublicId: String): JsonObject = api.markAlertRead(alertPublicId)
    suspend fun archiveAlert(alertPublicId: String): JsonObject = api.archiveAlert(alertPublicId)

    // --- Support and Assistant ---

    suspend fun supportContact(): SupportContact {
        val data = api.supportConfig()
        return SupportContact(
            phone = data.string("phone"),
            whatsapp = data.string("whatsapp"),
            email = data.string("email"),
            hours = data.string("hours"),
        )
    }

    suspend fun supportTickets(): List<SupportTicket> {
        val data = api.supportTickets()
        val items = data.arrayOrEmpty("items")
        return items.mapNotNull { (it as? JsonObject)?.let(::mapSupportTicket) }
    }

    suspend fun assistantRespond(message: String): String {
        val payload = api.assistantRespond(message)
        return payload.string("reply")
            .ifBlank { payload.string("message") }
            .ifBlank { "Assistant response received." }
    }

    // --- Realtime ---

    fun connectAlerts(
        onReplace: (List<UserAlert>) -> Unit,
        onUpsert: (UserAlert) -> Unit,
        onMarkRead: (String) -> Unit,
        onArchive: (String) -> Unit,
    ) {
        val token = sessionStore.accessToken
        if (token.isBlank()) return
        alertsRealtimeClient.connect(
            accessToken = token,
            onMessage = { type, payload ->
                when (type) {
                    "user_alert:new" -> onUpsert(mapAlert(payload))
                    "user_alert:read" -> onMarkRead(payload.string("publicId"))
                    "user_alert:archived" -> onArchive(payload.string("publicId"))
                }
            },
            onClosed = { _, _ -> },
            onFailure = { },
        )
    }

    fun disconnectAlerts() {
        alertsRealtimeClient.disconnect()
    }

    suspend fun markAllAlertsRead(alerts: List<UserAlert>): List<UserAlert> {
        alerts.filter { !it.isRead }.forEach { runCatching { api.markAlertRead(it.id) } }
        return this.alerts()
    }

    // --- Mappings ---

    private fun ensureUserRole(profile: UserProfile) {
        if (profile.role.uppercase() != "USER") {
            throw IllegalStateException("This account is signed in as ${profile.role}. Use the station staff app instead.")
        }
    }

    private fun mapProfile(data: JsonObject): UserProfile {
        val user = data.objectOrNull("user") ?: data
        val role = data.string("role").ifBlank { user.string("role").ifBlank { "USER" } }
        val profile = UserProfile(
            fullName = user.string("fullName").ifBlank { user.string("name").ifBlank { "SmartLink User" } },
            phone = user.string("phone"),
            email = user.string("email"),
            publicId = user.string("publicId").ifBlank { user.string("id") },
            role = role,
        )
        sessionStore.sessionJson = data.toString()
        return profile
    }

    private fun mapStation(row: JsonObject): Station? {
        val id = row.string("id").ifBlank { row.string("publicId") }
        val publicId = row.string("publicId").ifBlank { id }
        val name = row.string("name")
        if (id.isBlank() || name.isBlank()) return null
        return Station(
            id = id,
            publicId = publicId,
            name = name,
            address = row.string("address").ifBlank { name },
            latitude = row.double("latitude") ?: row.double("lat") ?: 0.0,
            longitude = row.double("longitude") ?: row.double("lng") ?: 0.0,
            distanceKm = row.double("distanceKm") ?: 0.0,
            etaMin = row.int("etaMin") ?: 0,
            rating = row.double("rating") ?: 0.0,
            reviewsCount = row.int("reviewsCount") ?: 0,
            status = row.string("status").ifBlank { "Available" },
            fuelLevel = row.string("fuelLevel").ifBlank { "high" },
            hoursLabel = row.string("hoursLabel").ifBlank { "Open 24h" },
            openingTime = row.string("openingTime"),
            closingTime = row.string("closingTime"),
            workingHours = row.string("workingHours").ifBlank { "Mon - Sun 00:00 - 23:59" },
            facilities = row.arrayOrEmpty("facilities").mapNotNull {
                (it as? JsonPrimitive)?.contentOrNull
            },
            prices = row.arrayOrEmpty("prices").mapNotNull { price ->
                (price as? JsonObject)?.let {
                    FuelPrice(
                        label = it.string("label"),
                        value = it.string("value"),
                    )
                }
            },
            phone = row.string("phone"),
            heroImage = row.string("heroImage"),
            subscriptionPlanCode = row.string("subscriptionPlanCode"),
            queuePlanEnabled = row.boolean("queuePlanEnabled") ?: false,
            reservationPlanEnabled = row.boolean("reservationPlanEnabled") ?: false,
            chipLabel = row.string("chipLabel").ifBlank { name },
        )
    }

    private fun mapQueue(data: JsonObject): QueueSnapshot {
        val station = data.objectOrNull("station") ?: EmptyJsonObject
        val guarantee = data.objectOrNull("guarantee") ?: EmptyJsonObject
        val queueId = data.string("queueJoinId").ifBlank { data.string("publicId").ifBlank { data.string("id") } }
        return QueueSnapshot(
            queueJoinId = queueId,
            stationName = station.string("name").ifBlank { data.string("stationName").ifBlank { "Station" } },
            position = data.int("position") ?: 0,
            carsAhead = data.int("carsAhead") ?: 0,
            totalQueued = data.int("totalQueued") ?: 0,
            etaMinutes = data.int("etaMinutes") ?: 0,
            fuelType = data.string("fuelType").ifBlank { "Petrol" },
            liters = (data.double("requestedLiters") ?: data.double("liters") ?: 0.0).roundToInt(),
            paymentMode = data.string("paymentMode").ifBlank { "Pay at pump" },
            guaranteeState = guarantee.string("state").ifBlank { data.string("guaranteeState").ifBlank { "Unknown" } },
            progressMessage = data.string("message").ifBlank { "Keep this screen open for live queue movement." },
            status = data.string("status").ifBlank { "PENDING" },
            nowServing = data.int("nowServing") ?: 0,
            lastMovement = data.string("lastMovement"),
            movementState = data.string("movementState"),
            paused = data.boolean("paused") ?: false,
            pauseReason = data.string("pauseReason"),
        )
    }

    private fun mapReservations(items: JsonArray): List<Reservation> =
        items.mapNotNull { item ->
            (item as? JsonObject)?.let { row ->
                Reservation(
                    id = row.string("id").ifBlank { row.string("publicId") },
                    publicId = row.string("publicId").ifBlank { row.string("id") },
                    stationName = row.objectOrNull("station")?.string("name")?.ifBlank {
                        row.string("stationName").ifBlank { "Station" }
                    } ?: row.string("stationName").ifBlank { "Station" },
                    liters = row.double("litersReserved") ?: row.double("expectedLiters") ?: 0.0,
                    fuelType = row.string("fuelType").ifBlank { "Petrol" },
                    dateLabel = row.string("slotDateLabel").ifBlank { row.string("joinedAt").ifBlank { "Date unavailable" } },
                    timeSlot = row.string("slotLabel").ifBlank { row.string("slotStart").ifBlank { "Time slot unavailable" } },
                    status = row.string("status").ifBlank { "Pending" },
                    depositAmount = row.double("depositAmount") ?: 0.0,
                    depositLabel = formatMoney(row.double("depositAmount") ?: 0.0, "MWK"),
                    slotStart = row.string("slotStart"),
                    slotEnd = row.string("slotEnd"),
                )
            }
        }

    private fun mapWalletTransaction(row: JsonObject): WalletTransaction {
        val currency = row.string("currencyCode").ifBlank { "MWK" }
        val amount = row.double("amount") ?: row.double("netAmount") ?: 0.0
        val direction = row.string("direction").ifBlank { "NEUTRAL" }
        val prefix = if (direction == "INFLOW") "+" else if (direction == "OUTFLOW") "-" else ""
        return WalletTransaction(
            id = row.string("id").ifBlank { row.string("reference") },
            publicId = row.string("publicId").ifBlank { row.string("id") },
            reference = row.string("reference"),
            title = row.string("type").ifBlank { row.string("typeGroup").ifBlank { "Transaction" } },
            subtitle = row.string("description").ifBlank { row.string("reference") },
            amount = amount,
            amountLabel = prefix + formatMoney(amount, currency),
            direction = direction,
            status = row.string("status").ifBlank { "PENDING" },
            type = row.string("type"),
            createdAt = row.string("createdAt"),
        )
    }

    private fun mapManualFuelOrder(row: JsonObject): ManualFuelOrder =
        ManualFuelOrder(
            id = row.string("id").ifBlank { row.string("publicId") },
            publicId = row.string("publicId").ifBlank { row.string("id") },
            stationName = row.objectOrNull("station")?.string("name") ?: "",
            fuelType = row.string("fuelType"),
            amountMwk = row.double("requestedAmountMwk"),
            liters = row.double("requestedLitres"),
            status = row.string("status"),
            createdAt = row.string("createdAt"),
        )

    private fun mapAlert(row: JsonObject): UserAlert =
        UserAlert(
            id = row.string("publicId").ifBlank { row.string("id") },
            publicId = row.string("publicId").ifBlank { row.string("id") },
            title = row.string("title").ifBlank { "Alert" },
            message = row.string("message").ifBlank { row.string("body").ifBlank { "You have a new alert." } },
            category = row.string("category").ifBlank { "SYSTEM" },
            timeLabel = row.string("createdAt").ifBlank { "Now" },
            isRead = row.string("status").uppercase() == "READ" || row.string("readAt").isNotBlank(),
        )

    private fun mapHistory(row: JsonObject): HistoryEntry =
        HistoryEntry(
            id = row.string("id").ifBlank { row.string("reference") },
            title = row.string("title").ifBlank { row.string("type").ifBlank { "History item" } },
            subtitle = row.string("stationName").ifBlank { row.string("description").ifBlank { "-" } },
            amountLabel = row.string("amountLabel").ifBlank {
                row.double("amount")?.let { formatMoney(it, row.string("currencyCode").ifBlank { "MWK" }) } ?: "-"
            },
            status = row.string("status").ifBlank { "Recorded" },
            dateLabel = row.string("createdAt").ifBlank { row.string("updatedAt").ifBlank { "-" } },
        )

    private fun mapSupportTicket(row: JsonObject): SupportTicket =
        SupportTicket(
            id = row.string("id").ifBlank { row.string("casePublicId") },
            title = row.string("title").ifBlank { "Support request" },
            stationName = row.string("stationName").ifBlank { "Station" },
            category = row.string("category").ifBlank { "General" },
            status = row.string("status").ifBlank { row.string("caseStatus").ifBlank { "OPEN" } },
            severity = row.string("severity").ifBlank { row.string("casePriority").ifBlank { "MEDIUM" } },
            description = row.string("description"),
            responseMessage = row.string("responseMessage").ifBlank { null },
            updatedLabel = row.string("updatedAt").ifBlank { row.string("createdAt").ifBlank { "-" } },
        )

    private fun formatMoney(value: Double, currencyCode: String): String {
        return "$currencyCode ${value.toInt().toString().reversed().chunked(3).joinToString(",").reversed()}"
    }
}

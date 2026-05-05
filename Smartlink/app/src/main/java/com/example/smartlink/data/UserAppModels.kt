package com.example.smartlink.data

import kotlinx.serialization.Serializable

@Serializable
data class FuelPrice(
    val label: String,
    val value: String,
)

@Serializable
data class Station(
    val id: String,
    val publicId: String,
    val name: String,
    val address: String,
    val latitude: Double,
    val longitude: Double,
    val distanceKm: Double,
    val etaMin: Int,
    val rating: Double,
    val reviewsCount: Int = 0,
    val status: String,
    val fuelLevel: String,
    val hoursLabel: String,
    val openingTime: String? = null,
    val closingTime: String? = null,
    val workingHours: String,
    val facilities: List<String>,
    val prices: List<FuelPrice>,
    val phone: String,
    val heroImage: String? = null,
    val subscriptionPlanCode: String? = null,
    val queuePlanEnabled: Boolean = false,
    val reservationPlanEnabled: Boolean = false,
    val chipLabel: String = "",
)

@Serializable
data class StationFuelStatus(
    val stationPublicId: String,
    val statuses: List<FuelStatusEntry>,
    val updatedAt: String,
)

@Serializable
data class FuelStatusEntry(
    val code: String,
    val label: String,
    val status: String,
)

@Serializable
data class PromotionPreview(
    val ok: Boolean,
    val data: PromotionPreviewData? = null,
    val error: String? = null,
)

@Serializable
data class PromotionPreviewData(
    val finalPrice: Double,
    val originalPrice: Double,
    val discountAmount: Double,
    val message: String? = null,
)

@Serializable
data class QueueSnapshot(
    val queueJoinId: String,
    val stationName: String = "",
    val position: Int,
    val carsAhead: Int,
    val totalQueued: Int = 0,
    val etaMinutes: Int,
    val fuelType: String,
    val liters: Int,
    val paymentMode: String = "",
    val guaranteeState: String = "",
    val progressMessage: String = "",
    val status: String = "PENDING",
    val nowServing: Int = 0,
    val lastMovement: String? = null,
    val movementState: String? = null,
    val paused: Boolean = false,
    val pauseReason: String? = null,
)

@Serializable
data class WalletSummary(
    val walletId: String = "",
    val walletPublicId: String = "",
    val walletNumber: String = "",
    val status: String = "ACTIVE",
    val currencyCode: String = "MWK",
    val ledgerBalance: Double = 0.0,
    val availableBalance: Double = 0.0,
    val lockedBalance: Double = 0.0,
    val pendingInflow: Double = 0.0,
    val pendingOutflow: Double = 0.0,
    val activeHoldAmount: Double = 0.0,
    val balanceLabel: String = "",
    val lockedBalanceLabel: String = "",
    val userId: String = "",
)

@Serializable
data class WalletTransaction(
    val id: String,
    val publicId: String = "",
    val reference: String = "",
    val title: String,
    val subtitle: String,
    val amount: Double = 0.0,
    val amountLabel: String = "",
    val direction: String = "NEUTRAL",
    val status: String = "PENDING",
    val type: String = "",
    val createdAt: String = "",
)

@Serializable
data class WalletHold(
    val id: String,
    val amount: Double,
    val amountLabel: String = "",
    val status: String,
    val expiresAt: String,
    val reason: String,
)

@Serializable
data class Reservation(
    val id: String,
    val publicId: String = "",
    val stationName: String,
    val liters: Double,
    val fuelType: String,
    val dateLabel: String,
    val timeSlot: String,
    val status: String,
    val depositAmount: Double = 0.0,
    val depositLabel: String,
    val slotStart: String = "",
    val slotEnd: String = "",
)

@Serializable
data class ManualFuelOrder(
    val id: String,
    val publicId: String = "",
    val stationName: String = "",
    val fuelType: String,
    val amountMwk: Double? = null,
    val liters: Double? = null,
    val status: String,
    val createdAt: String,
)

@Serializable
data class HistoryEntry(
    val id: String,
    val title: String,
    val subtitle: String,
    val amountLabel: String,
    val status: String,
    val dateLabel: String,
)

@Serializable
data class UserAlert(
    val id: String,
    val publicId: String = "",
    val title: String,
    val message: String,
    val category: String,
    val timeLabel: String,
    val isRead: Boolean,
)

@Serializable
data class SupportTicket(
    val id: String,
    val title: String,
    val stationName: String,
    val category: String,
    val status: String,
    val severity: String,
    val description: String,
    val responseMessage: String?,
    val updatedLabel: String,
)

@Serializable
data class UserProfile(
    val fullName: String,
    val phone: String,
    val email: String,
    val publicId: String,
    val role: String = "USER",
)

@Serializable
data class SupportContact(
    val phone: String,
    val whatsapp: String,
    val email: String,
    val hours: String,
)

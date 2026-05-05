package com.example.smartlink.data.network

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

fun JsonObject.string(name: String): String =
    this[name]?.jsonPrimitive?.contentOrNull.orEmpty()

fun JsonObject.requiredString(name: String): String =
    string(name).ifBlank { throw IllegalStateException("Missing field: $name") }

fun JsonObject.int(name: String): Int? =
    this[name]?.jsonPrimitive?.intOrNull

fun JsonObject.double(name: String): Double? =
    this[name]?.jsonPrimitive?.doubleOrNull

fun JsonObject.boolean(name: String): Boolean? =
    this[name]?.jsonPrimitive?.booleanOrNull

fun JsonObject.objectOrNull(name: String): JsonObject? =
    this[name]?.jsonObject

fun JsonObject.arrayOrEmpty(name: String): JsonArray =
    (this[name] as? JsonArray) ?: JsonArray(emptyList())

fun jsonObjectOf(vararg pairs: Pair<String, JsonElement?>): JsonObject =
    JsonObject(
        pairs.mapNotNull { (key, value) ->
            value?.let { key to it }
        }.toMap()
    )

fun stringElement(value: String?): JsonElement? =
    value?.takeIf { it.isNotBlank() }?.let { JsonPrimitive(it) }

fun numberElement(value: Number?): JsonElement? =
    value?.let { JsonPrimitive(it) }

fun booleanElement(value: Boolean?): JsonElement? =
    value?.let { JsonPrimitive(it) }

val EmptyJsonObject = JsonObject(emptyMap())
val EmptyJsonArray = JsonArray(emptyList())
val JsonNil: JsonElement = JsonNull

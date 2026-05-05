package com.example.smartlink.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.darkColorScheme
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color

private val DarkColorScheme = darkColorScheme(
    primary = SmartlinkMint,
    secondary = Color(0xFF80CBD3),
    background = Color(0xFF08131C),
    surface = Color(0xFF101A23),
    onPrimary = SmartlinkInk,
    onBackground = Color(0xFFF4F8FB),
    onSurface = Color(0xFFF4F8FB),
)

private val LightColorScheme = lightColorScheme(
    primary = SmartlinkNavy,
    secondary = SmartlinkTeal,
    tertiary = SmartlinkMint,
    background = SmartlinkSand,
    surface = SmartlinkCard,
    onPrimary = Color.White,
    onSecondary = Color.White,
    onTertiary = SmartlinkInk,
    onBackground = SmartlinkInk,
    onSurface = SmartlinkInk,
    onSurfaceVariant = SmartlinkSlate,
)

@Composable
fun SmartlinkTheme(
    darkTheme: Boolean = false,
    content: @Composable () -> Unit
) {
    val colorScheme = if (darkTheme) DarkColorScheme else LightColorScheme

    MaterialTheme(
        colorScheme = colorScheme,
        typography = Typography,
        content = content
    )
}

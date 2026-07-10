package com.example.smartlink.ui.components

import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material3.*
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.smartlink.ui.theme.SmartLinkRadius

@Composable fun SmartLinkSectionHeader(title: String, subtitle: String = "", action: (@Composable () -> Unit)? = null) = Row(Modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) { Column(Modifier.weight(1f)) { Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium); if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant) }; action?.invoke() }
@Composable fun SmartLinkDashboardCard(title: String, subtitle: String = "", content: @Composable ColumnScope.() -> Unit) = Surface(shape = RoundedCornerShape(SmartLinkRadius.card), tonalElevation = 1.dp, shadowElevation = 2.dp) { Column(Modifier.padding(16.dp)) { Text(title, fontWeight = FontWeight.Medium); if (subtitle.isNotBlank()) Text(subtitle, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 3.dp)); Spacer(Modifier.height(14.dp)); content() } }
@Composable fun SmartLinkStatCard(label: String, value: String, icon: ImageVector, modifier: Modifier = Modifier) = Surface(modifier, shape = RoundedCornerShape(SmartLinkRadius.card), tonalElevation = 1.dp, shadowElevation = 2.dp) { Column(Modifier.padding(16.dp)) { Text(label, fontWeight = FontWeight.Medium); Spacer(Modifier.height(14.dp)); Row(verticalAlignment = Alignment.CenterVertically) { Icon(icon, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(10.dp)); Text(value.ifBlank { "—" }, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold) } } }
@Composable fun SmartLinkListItem(title: String, detail: String, status: String = "", icon: ImageVector? = null) = Surface(shape = RoundedCornerShape(SmartLinkRadius.card), tonalElevation = 1.dp) { Row(Modifier.fillMaxWidth().padding(14.dp), verticalAlignment = Alignment.CenterVertically) { icon?.let { Icon(it, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(12.dp)) }; Column(Modifier.weight(1f)) { Text(title, fontWeight = FontWeight.Medium); Text(detail.ifBlank { "No additional details" }, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = MaterialTheme.colorScheme.onSurfaceVariant) }; if (status.isNotBlank()) SmartLinkStatusBadge(status) } }
@Composable fun SmartLinkStatusBadge(label: String) { val color = when (label.lowercase()) { "paid", "active", "complete", "completed" -> Color(0xFF0F766E); "overdue", "absent", "late" -> Color(0xFFB45309); else -> Color(0xFF1D4ED8) }; Surface(color = color.copy(alpha = .12f), shape = RoundedCornerShape(99.dp)) { Text(label.replaceFirstChar { it.uppercase() }, color = color, style = MaterialTheme.typography.labelSmall, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp)) } }
@Composable fun SmartLinkLoadingState() = Box(Modifier.fillMaxSize(), contentAlignment = Alignment.Center) { CircularProgressIndicator() }
@Composable fun SmartLinkEmptyState(message: String) = Box(Modifier.fillMaxSize().padding(32.dp), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.Inbox, null, tint = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.size(44.dp)); Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 12.dp)) } }
@Composable fun SmartLinkErrorState(message: String, retry: () -> Unit) = Box(Modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) { Column(horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.ErrorOutline, null, tint = MaterialTheme.colorScheme.error, modifier = Modifier.size(42.dp)); Text(message, modifier = Modifier.padding(vertical = 12.dp), color = MaterialTheme.colorScheme.onSurfaceVariant); Button(onClick = retry) { Text("Try again") } } }

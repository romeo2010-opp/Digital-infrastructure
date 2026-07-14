package com.example.smartlink.ui.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ColumnScope
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Inbox
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.example.smartlink.domain.model.SchoolListItem
import com.example.smartlink.domain.model.StaffMetric
import com.example.smartlink.ui.theme.SmartLinkRadius
import com.example.smartlink.ui.theme.SmartLinkTone

@Composable
fun SmartLinkSectionHeader(
    title: String,
    subtitle: String = "",
    modifier: Modifier = Modifier,
    action: (@Composable () -> Unit)? = null,
) = Row(modifier.fillMaxWidth(), verticalAlignment = Alignment.CenterVertically) {
    Column(Modifier.weight(1f)) {
        Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.SemiBold, color = SmartLinkTone.Ink)
        if (subtitle.isNotBlank()) {
            Text(
                subtitle,
                style = MaterialTheme.typography.bodySmall,
                color = SmartLinkTone.Muted,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
                modifier = Modifier.padding(top = 2.dp),
            )
        }
    }
    action?.invoke()
}

@Composable
fun SmartLinkDashboardCard(
    title: String,
    subtitle: String = "",
    modifier: Modifier = Modifier,
    tone: Color = SmartLinkTone.Panel,
    content: @Composable ColumnScope.() -> Unit,
) = Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(SmartLinkRadius.card),
    color = tone,
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
    border = BorderStroke(1.dp, SmartLinkTone.Border),
) {
    Column(Modifier.padding(16.dp)) {
        Text(title, fontWeight = FontWeight.SemiBold, color = SmartLinkTone.Ink, maxLines = 2, overflow = TextOverflow.Ellipsis)
        if (subtitle.isNotBlank()) {
            Text(subtitle, style = MaterialTheme.typography.bodySmall, color = SmartLinkTone.Muted, modifier = Modifier.padding(top = 3.dp), maxLines = 2, overflow = TextOverflow.Ellipsis)
        }
        Spacer(Modifier.height(14.dp))
        content()
    }
}

@Composable
fun SmartLinkStatCard(
    label: String,
    value: String,
    icon: ImageVector,
    modifier: Modifier = Modifier,
    helper: String = "",
    tone: String = "neutral",
) = Surface(
    modifier = modifier,
    shape = RoundedCornerShape(SmartLinkRadius.card),
    color = SmartLinkTone.Panel,
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
    border = BorderStroke(1.dp, SmartLinkTone.Border),
) {
    Column(Modifier.padding(14.dp), verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Row(verticalAlignment = Alignment.CenterVertically) {
            Surface(shape = RoundedCornerShape(7.dp), color = badgeColor(tone).copy(alpha = 0.12f)) {
                Icon(icon, null, tint = badgeColor(tone), modifier = Modifier.padding(6.dp).size(16.dp))
            }
            Spacer(Modifier.width(8.dp))
            Text(label, style = MaterialTheme.typography.labelMedium, fontWeight = FontWeight.SemiBold, color = SmartLinkTone.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
        }
        Text(value.ifBlank { "-" }, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold, color = SmartLinkTone.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
        if (helper.isNotBlank()) Text(helper, style = MaterialTheme.typography.labelMedium, color = SmartLinkTone.Muted, maxLines = 1, overflow = TextOverflow.Ellipsis)
    }
}

@Composable
fun SmartLinkMetricStrip(metrics: List<StaffMetric>, icons: List<ImageVector>, modifier: Modifier = Modifier) {
    Column(modifier, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        metrics.chunked(2).forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(10.dp)) {
                row.forEachIndexed { index, metric ->
                    SmartLinkStatCard(
                        label = metric.label,
                        value = metric.value,
                        helper = metric.helper,
                        tone = metric.tone,
                        icon = icons.getOrElse(index) { icons.first() },
                        modifier = Modifier.weight(1f),
                    )
                }
                if (row.size == 1) Spacer(Modifier.weight(1f))
            }
        }
    }
}

@Composable
fun SmartLinkListItem(item: SchoolListItem, icon: ImageVector? = null, modifier: Modifier = Modifier) = Surface(
    modifier = modifier.fillMaxWidth(),
    shape = RoundedCornerShape(SmartLinkRadius.card),
    color = SmartLinkTone.Panel,
    tonalElevation = 0.dp,
    shadowElevation = 0.dp,
    border = BorderStroke(1.dp, SmartLinkTone.BorderSoft),
) {
    Row(Modifier.fillMaxWidth().padding(13.dp), verticalAlignment = Alignment.CenterVertically) {
        icon?.let {
            Surface(shape = RoundedCornerShape(7.dp), color = SmartLinkTone.MutedPanel) {
                Icon(it, null, tint = SmartLinkTone.Navy, modifier = Modifier.padding(7.dp).size(17.dp))
            }
            Spacer(Modifier.width(12.dp))
        }
        Column(Modifier.weight(1f)) {
            Text(item.title.ifBlank { "Untitled" }, fontWeight = FontWeight.SemiBold, color = SmartLinkTone.Ink, maxLines = 1, overflow = TextOverflow.Ellipsis)
            Text(item.detail.ifBlank { "No additional details" }, style = MaterialTheme.typography.bodySmall, maxLines = 2, overflow = TextOverflow.Ellipsis, color = SmartLinkTone.Muted, modifier = Modifier.padding(top = 2.dp))
        }
        if (item.status.isNotBlank()) {
            Spacer(Modifier.width(8.dp))
            SmartLinkStatusBadge(item.status)
        }
    }
}

@Composable
fun SmartLinkStatusBadge(label: String) {
    val color = badgeColor(label)
    Surface(color = color.copy(alpha = 0.12f), shape = RoundedCornerShape(99.dp), border = BorderStroke(1.dp, color.copy(alpha = 0.18f))) {
        Text(label.cleanLabel(), color = color, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.SemiBold, modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp), maxLines = 1)
    }
}

@Composable
fun SmartLinkLoadingState(message: String = "Loading school workspace") = Box(Modifier.fillMaxSize().background(SmartLinkTone.AppBg), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        CircularProgressIndicator(color = SmartLinkTone.Navy, strokeWidth = 2.dp)
        Text(message, color = SmartLinkTone.Muted, style = MaterialTheme.typography.bodySmall)
    }
}

@Composable
fun SmartLinkEmptyState(message: String, modifier: Modifier = Modifier) = Box(modifier.fillMaxSize().padding(28.dp), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(10.dp)) {
        Icon(Icons.Default.Inbox, null, tint = SmartLinkTone.Muted, modifier = Modifier.size(42.dp))
        Text(message, color = SmartLinkTone.Muted, style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
fun SmartLinkErrorState(message: String, retry: () -> Unit) = Box(Modifier.fillMaxSize().background(SmartLinkTone.AppBg).padding(28.dp), contentAlignment = Alignment.Center) {
    Column(horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Icon(Icons.Default.ErrorOutline, null, tint = SmartLinkTone.Danger, modifier = Modifier.size(42.dp))
        Text(message, color = SmartLinkTone.Muted, style = MaterialTheme.typography.bodyMedium)
        Button(
            onClick = retry,
            colors = ButtonDefaults.buttonColors(containerColor = SmartLinkTone.Navy, contentColor = Color.White),
            shape = RoundedCornerShape(SmartLinkRadius.control),
        ) { Text("Try again") }
    }
}

private fun badgeColor(value: String): Color = when (value.lowercase().replace("_", " ")) {
    "paid", "active", "complete", "completed", "present", "good" -> SmartLinkTone.Success
    "overdue", "absent", "late", "warn", "pending", "open" -> SmartLinkTone.Warning
    "bad", "failed", "suspended" -> SmartLinkTone.Danger
    else -> SmartLinkTone.Info
}

private fun String.cleanLabel() = replace("_", " ").replaceFirstChar { it.uppercase() }

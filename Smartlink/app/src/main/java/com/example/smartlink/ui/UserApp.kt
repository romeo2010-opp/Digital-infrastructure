package com.example.smartlink.ui

import androidx.compose.animation.*
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.isSystemInDarkTheme
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.BasicTextField
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.*
import androidx.compose.material.icons.automirrored.outlined.ReceiptLong
import androidx.compose.material.icons.filled.*
import androidx.compose.material.icons.outlined.Bookmark
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.shadow
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import com.example.smartlink.data.*
import com.mapbox.geojson.Point
import com.mapbox.maps.Style
import com.mapbox.maps.extension.compose.MapboxMap
import com.mapbox.maps.extension.compose.animation.viewport.rememberMapViewportState
import com.mapbox.maps.extension.compose.annotation.generated.PointAnnotation
import com.mapbox.maps.extension.compose.style.MapStyle
import kotlinx.coroutines.launch

private sealed interface UserRoute {
    data object Login : UserRoute
    data object Home : UserRoute
    data object Orders : UserRoute
    data object Queue : UserRoute
    data object Wallet : UserRoute
    data object More : UserRoute
    data object Stations : UserRoute
    data class StationDetails(val stationId: String) : UserRoute
    data class Directions(val stationId: String) : UserRoute
    data object Saved : UserRoute
    data object Reservations : UserRoute
    data object History : UserRoute
    data object Alerts : UserRoute
    data object Help : UserRoute
    data object Settings : UserRoute
    data object Account : UserRoute
    data object Assistant : UserRoute
    data object SendCredit : UserRoute
}

private enum class BottomTab(val label: String, val icon: ImageVector) {
    Home("Home", Icons.Default.Home),
    Orders("Orders", Icons.Default.QrCodeScanner),
    Queue("Queue", Icons.Default.Timelapse),
    Wallet("Wallet", Icons.Default.Payments),
    More("More", Icons.Default.Tune),
}

@Composable
fun SmartlinkUserApp() {
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val repository = remember { UserAppRepository(context) }
    
    var stations by remember { mutableStateOf(emptyList<Station>()) }
    var profile by remember { mutableStateOf<UserProfile?>(null) }
    var walletSummary by remember { mutableStateOf<WalletSummary?>(null) }
    var queueSnapshot by remember { mutableStateOf<QueueSnapshot?>(null) }
    val reservations = remember { mutableStateListOf<Reservation>() }
    val alerts = remember { mutableStateListOf<UserAlert>() }
    var history by remember { mutableStateOf(emptyList<HistoryEntry>()) }
    var supportContact by remember { mutableStateOf<SupportContact?>(null) }
    var supportTickets by remember { mutableStateOf(emptyList<SupportTicket>()) }
    var walletTransactions by remember { mutableStateOf(emptyList<WalletTransaction>()) }
    val favorites = remember { mutableStateListOf(*repository.sessionStore.favoriteStationIds.toTypedArray()) }
    
    var route by remember { mutableStateOf<UserRoute>(UserRoute.Login) }
    val backStack = remember { mutableStateListOf<UserRoute>() }
    var notificationsEnabled by rememberSaveable { mutableStateOf(true) }
    var darkThemeEnabled by rememberSaveable { mutableStateOf(repository.sessionStore.themePreference == "dark") }
    var globalError by rememberSaveable { mutableStateOf("") }
    var isLoggedIn by rememberSaveable { mutableStateOf(repository.sessionStore.accessToken.isNotBlank()) }
    var isLoading by remember { mutableStateOf(false) }

    fun navigate(next: UserRoute) {
        if (route == next) return
        backStack.add(route)
        route = next
    }

    fun goBack() {
        if (backStack.isNotEmpty()) {
            route = backStack.removeAt(backStack.lastIndex)
        }
    }

    suspend fun loadLiveData() {
        isLoading = true
        runCatching { repository.stations() }.onSuccess { if (it.isNotEmpty()) stations = it }
        runCatching { repository.walletSummary() }.onSuccess { walletSummary = it }
        runCatching { repository.walletTransactions() }.onSuccess { walletTransactions = it }
        runCatching { repository.reservations() }.onSuccess {
            reservations.clear()
            reservations.addAll(it)
        }
        runCatching { repository.alerts() }.onSuccess {
            alerts.clear()
            alerts.addAll(it)
        }
        runCatching { repository.history() }.onSuccess { history = it }
        runCatching { repository.supportContact() }.onSuccess { supportContact = it }
        runCatching { repository.supportTickets() }.onSuccess { supportTickets = it }
        runCatching { repository.activeQueue() }.onSuccess { queueSnapshot = it }
        isLoading = false
    }

    LaunchedEffect(Unit) {
        if (isLoggedIn) {
            repository.restoreSession()?.let {
                profile = it
                loadLiveData()
                if (route == UserRoute.Login) route = UserRoute.Home
            } ?: run {
                isLoggedIn = false
                route = UserRoute.Login
            }
        }
    }

    LaunchedEffect(isLoggedIn) {
        if (!isLoggedIn) {
            repository.disconnectAlerts()
            return@LaunchedEffect
        }
        repository.connectAlerts(
            onReplace = { nextAlerts ->
                alerts.clear()
                alerts.addAll(nextAlerts)
            },
            onUpsert = { nextAlert ->
                val index = alerts.indexOfFirst { it.id == nextAlert.id || (it.publicId.isNotBlank() && it.publicId == nextAlert.publicId) }
                if (index >= 0) alerts[index] = nextAlert else alerts.add(0, nextAlert)
            },
            onMarkRead = { alertId ->
                val index = alerts.indexOfFirst { it.id == alertId || it.publicId == alertId }
                if (index >= 0) alerts[index] = alerts[index].copy(isRead = true)
            },
            onArchive = { alertId ->
                alerts.removeAll { it.id == alertId || it.publicId == alertId }
            },
        )
    }

    MaterialTheme(
        colorScheme = if (darkThemeEnabled) darkColorScheme(
            primary = Color(0xFF4CAF50),
            secondary = Color(0xFF81C784),
            surface = Color(0xFF101A23),
            background = Color(0xFF07111A),
            onSurface = Color(0xFFF2F7FB),
            onBackground = Color(0xFFF2F7FB),
        ) else lightColorScheme(
            primary = Color(0xFF2E7D32),
            surface = Color.White,
            background = Color(0xFFF8F9FA)
        ),
    ) {
        if (!isLoggedIn) {
            LoginScreen(
                error = globalError,
                onSignIn = { identifier, password, createMode, fullName, phone, email ->
                    scope.launch {
                        globalError = ""
                        runCatching {
                            profile = if (createMode) {
                                repository.register(fullName, phone, email, password)
                            } else {
                                repository.login(identifier, password)
                            }
                            isLoggedIn = true
                            route = UserRoute.Home
                            backStack.clear()
                            loadLiveData()
                        }.onFailure {
                            globalError = it.message ?: "Authentication failed"
                        }
                    }
                }
            )
            return@MaterialTheme
        }

        val currentStation = when (val currentRoute = route) {
            is UserRoute.StationDetails -> stations.find { it.id == currentRoute.stationId || it.publicId == currentRoute.stationId }
            is UserRoute.Directions -> stations.find { it.id == currentRoute.stationId || it.publicId == currentRoute.stationId }
            else -> null
        }

        Scaffold(
            bottomBar = {
                if (route != UserRoute.Home && route != UserRoute.Assistant) {
                    NavigationBar(containerColor = MaterialTheme.colorScheme.surface) {
                        BottomTab.entries.forEach { tab ->
                            NavigationBarItem(
                                selected = activeTab(route) == tab,
                                onClick = {
                                    route = when (tab) {
                                        BottomTab.Home -> UserRoute.Home
                                        BottomTab.Orders -> UserRoute.Orders
                                        BottomTab.Queue -> UserRoute.Queue
                                        BottomTab.Wallet -> UserRoute.Wallet
                                        BottomTab.More -> UserRoute.More
                                    }
                                    backStack.clear()
                                },
                                icon = { Icon(tab.icon, contentDescription = tab.label) },
                                label = { Text(tab.label) },
                            )
                        }
                    }
                }
            }
        ) { innerPadding ->
            Surface(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(if (route == UserRoute.Home || route == UserRoute.Assistant) PaddingValues(0.dp) else innerPadding),
                color = MaterialTheme.colorScheme.background,
            ) {
                Box {
                    Column(modifier = Modifier.fillMaxSize()) {
                        when (val currentRoute = route) {
                            UserRoute.Home -> HomeMapScreen(
                                stations = stations,
                                onOpenStation = { navigate(UserRoute.StationDetails(it)) },
                                onTabSelected = { 
                                    route = when (it) {
                                        BottomTab.Home -> UserRoute.Home
                                        BottomTab.Orders -> UserRoute.Orders
                                        BottomTab.Queue -> UserRoute.Queue
                                        BottomTab.Wallet -> UserRoute.Wallet
                                        BottomTab.More -> UserRoute.More
                                    }
                                    backStack.clear()
                                }
                            )
                            UserRoute.Orders -> OrdersScreen(
                                onOpenWallet = { route = UserRoute.Wallet },
                                onCreateOrder = { sid, fuel, amount, liters ->
                                    scope.launch {
                                        runCatching { repository.createManualFuelOrder(sid, fuel, amount, liters) }.onSuccess {
                                            loadLiveData()
                                            route = UserRoute.Queue
                                        }.onFailure { globalError = it.message ?: "Failed to create order" }
                                    }
                                }
                            )
                            UserRoute.Queue -> QueueScreen(
                                snapshot = queueSnapshot,
                                onBrowseStations = { route = UserRoute.Home },
                                onLeave = { 
                                    scope.launch { 
                                        queueSnapshot?.let { 
                                            runCatching { repository.leaveQueue(it.queueJoinId) }.onSuccess { queueSnapshot = null } 
                                        }
                                    } 
                                },
                                onDispense = { liters -> 
                                    scope.launch { 
                                        queueSnapshot?.let {
                                            runCatching { repository.dispenseRequest(it.queueJoinId, liters, false) }.onSuccess { loadLiveData(); route = UserRoute.History } 
                                        }
                                    } 
                                }
                            )
                            UserRoute.Wallet -> WalletScreen(
                                summary = walletSummary,
                                transactions = walletTransactions,
                                onSendCredit = { navigate(UserRoute.SendCredit) }
                            )
                            UserRoute.More -> MoreScreen(
                                unreadAlerts = alerts.count { !it.isRead },
                                onNavigate = { navigate(it) },
                                onLogout = { scope.launch { repository.logout(); isLoggedIn = false; route = UserRoute.Login } }
                            )
                            UserRoute.Stations -> StationsScreen(
                                stations = stations,
                                onSelectStation = { navigate(UserRoute.StationDetails(it)) },
                                onBack = { goBack() }
                            )
                            is UserRoute.StationDetails -> currentStation?.let {
                                StationDetailsScreen(
                                    station = it,
                                    isFavorite = favorites.contains(it.publicId),
                                    onToggleFavorite = {
                                        if (favorites.contains(it.publicId)) {
                                            favorites.remove(it.publicId)
                                            repository.sessionStore.favoriteStationIds = favorites.toSet()
                                        } else {
                                            favorites.add(it.publicId)
                                            repository.sessionStore.favoriteStationIds = favorites.toSet()
                                        }
                                    },
                                    onDirections = { navigate(UserRoute.Directions(it.publicId)) },
                                    onJoinQueue = { navigate(UserRoute.Orders) }, // Simple flow
                                    onReserve = { navigate(UserRoute.Reservations) },
                                    onBack = { goBack() }
                                )
                            }
                            is UserRoute.Directions -> currentStation?.let { DirectionsScreen(it, onBack = { goBack() }) }
                            UserRoute.Saved -> SavedScreen(
                                stations = stations.filter { favorites.contains(it.publicId) },
                                onOpenStation = { navigate(UserRoute.StationDetails(it)) },
                                onBack = { goBack() }
                            )
                            UserRoute.Reservations -> ReservationsScreen(
                                reservations = reservations,
                                onCheckIn = { resId -> scope.launch { runCatching { repository.checkInReservation(resId, "GPS") }.onSuccess { loadLiveData() } } },
                                onCancel = { resId -> scope.launch { runCatching { repository.cancelReservation(resId) }.onSuccess { loadLiveData() } } },
                                onBack = { goBack() }
                            )
                            UserRoute.History -> HistoryScreen(history, onBack = { goBack() })
                            UserRoute.Alerts -> AlertsScreen(
                                alerts = alerts,
                                onMarkAllRead = { scope.launch { runCatching { repository.markAllAlertsRead(alerts) }.onSuccess { loadLiveData() } } },
                                onArchive = { alertId -> scope.launch { runCatching { repository.archiveAlert(alertId) }.onSuccess { alerts.removeAll { a -> a.publicId == alertId } } } },
                                onBack = { goBack() }
                            )
                            UserRoute.Help -> HelpScreen(supportContact, supportTickets, onBack = { goBack() })
                            UserRoute.Settings -> SettingsScreen(
                                darkThemeEnabled = darkThemeEnabled,
                                notificationsEnabled = notificationsEnabled,
                                onToggleTheme = { darkThemeEnabled = !darkThemeEnabled; repository.sessionStore.themePreference = if (darkThemeEnabled) "dark" else "light" },
                                onToggleNotifications = { notificationsEnabled = !notificationsEnabled },
                                onBack = { goBack() }
                            )
                            UserRoute.Account -> AccountScreen(
                                profile = profile,
                                onOpenSettings = { navigate(UserRoute.Settings) },
                                onOpenWallet = { route = UserRoute.Wallet },
                                onBack = { goBack() }
                            )
                            UserRoute.Assistant -> AssistantScreen(
                                onAsk = { repository.assistantRespond(it) },
                                onBack = { goBack() }
                            )
                            UserRoute.SendCredit -> SendCreditScreen(
                                walletSummary = walletSummary,
                                onPreview = { r, a -> repository.previewTransfer(r, a) },
                                onSend = { r, a, n -> repository.createTransfer(r, a, "NORMAL", n); loadLiveData() },
                                onBack = { goBack() }
                            )
                            else -> {}
                        }
                    }

                    if (isLoading) {
                        Box(modifier = Modifier.fillMaxSize().background(Color.Black.copy(alpha = 0.3f)), contentAlignment = Alignment.Center) {
                            CircularProgressIndicator(color = MaterialTheme.colorScheme.primary)
                        }
                    }

                    if (globalError.isNotBlank() && route != UserRoute.Login) {
                        Snackbar(
                            modifier = Modifier.align(Alignment.BottomCenter).padding(16.dp),
                            action = {
                                TextButton(onClick = { globalError = "" }) { Text("Dismiss") }
                            }
                        ) { Text(globalError) }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun HomeMapScreen(
    stations: List<Station>,
    onOpenStation: (String) -> Unit,
    onTabSelected: (BottomTab) -> Unit
) {
    var query by rememberSaveable { mutableStateOf("") }
    var selectedFilter by rememberSaveable { mutableStateOf("All Stations") }
    var showFilterPopover by remember { mutableStateOf(false) }
    var selectedStation by remember { mutableStateOf<Station?>(null) }
    val scaffoldState = rememberBottomSheetScaffoldState(
        bottomSheetState = rememberStandardBottomSheetState(initialValue = SheetValue.PartiallyExpanded)
    )
    val isDark = isSystemInDarkTheme()

    val viewportState = rememberMapViewportState {
        setCameraOptions {
            center(Point.fromLngLat(35.0, -15.8))
            zoom(12.0)
        }
    }

    val filteredStations = stations.filter {
        val matchesQuery = query.isBlank() || it.name.contains(query, ignoreCase = true) || it.address.contains(query, ignoreCase = true)
        val matchesFilter = when (selectedFilter) {
            "Available" -> it.status.equals("Available", ignoreCase = true)
            "In Use" -> it.status.equals("In Use", ignoreCase = true)
            "Low Fuel" -> it.fuelLevel.equals("low", ignoreCase = true)
            "Medium Fuel" -> it.fuelLevel.equals("medium", ignoreCase = true)
            "Open 24h" -> it.hoursLabel.contains("24h", ignoreCase = true)
            else -> true
        }
        matchesQuery && matchesFilter
    }

    BottomSheetScaffold(
        scaffoldState = scaffoldState,
        sheetPeekHeight = 200.dp,
        sheetContainerColor = MaterialTheme.colorScheme.surface.copy(alpha = 0.98f),
        sheetShadowElevation = 16.dp,
        sheetDragHandle = { BottomSheetDefaults.DragHandle() },
        sheetContent = {
            Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 16.dp).heightIn(min = 400.dp, max = 600.dp)) {
                if (selectedStation != null) {
                    StationDrawerSummary(selectedStation!!, onOpenStation = onOpenStation)
                    Spacer(Modifier.height(24.dp))
                    HorizontalDivider(modifier = Modifier.padding(horizontal = 8.dp))
                    Spacer(Modifier.height(16.dp))
                }
                Text("Nearby Stations", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(8.dp))
                LazyColumn(modifier = Modifier.fillMaxWidth()) {
                    items(filteredStations) { station ->
                        StationRowCard(station, onClick = { selectedStation = station })
                        Spacer(Modifier.height(8.dp))
                    }
                }
            }
        }
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            MapboxMap(
                modifier = Modifier.fillMaxSize(),
                mapViewportState = viewportState,
                style = {
                    MapStyle(style = if (isDark) Style.DARK else Style.MAPBOX_STREETS)
                }
            ) {
                filteredStations.forEach { station ->
                    PointAnnotation(
                        point = Point.fromLngLat(station.longitude, station.latitude),
                        onClick = {
                            selectedStation = station
                            true
                        },
                    )
                }
            }

            // Search Pill
            Column(
                modifier = Modifier
                    .statusBarsPadding()
                    .padding(horizontal = 16.dp, vertical = 8.dp)
                    .fillMaxWidth()
            ) {
                Surface(
                    modifier = Modifier.fillMaxWidth().height(56.dp).shadow(6.dp, RoundedCornerShape(28.dp)),
                    shape = RoundedCornerShape(28.dp),
                    color = MaterialTheme.colorScheme.surface.copy(alpha = 0.96f),
                    border = BorderStroke(0.5.dp, MaterialTheme.colorScheme.outlineVariant)
                ) {
                    Row(modifier = Modifier.fillMaxSize().padding(horizontal = 16.dp), verticalAlignment = Alignment.CenterVertically) {
                        Icon(Icons.Default.Search, null, tint = MaterialTheme.colorScheme.onSurfaceVariant)
                        Spacer(Modifier.width(12.dp))
                        Box(modifier = Modifier.weight(1f)) {
                            if (query.isEmpty()) Text("Search Station", color = MaterialTheme.colorScheme.onSurfaceVariant)
                            BasicTextField(value = query, onValueChange = { query = it }, textStyle = MaterialTheme.typography.bodyLarge.copy(color = MaterialTheme.colorScheme.onSurface), modifier = Modifier.fillMaxWidth(), singleLine = true)
                        }
                        IconButton(onClick = { showFilterPopover = !showFilterPopover }, modifier = Modifier.size(40.dp).clip(RoundedCornerShape(10.dp)).background(if (selectedFilter != "All Stations") MaterialTheme.colorScheme.primaryContainer else Color.Transparent)) {
                            Icon(Icons.Default.FilterList, null, tint = if (selectedFilter != "All Stations") MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant)
                        }
                    }
                }
                if (showFilterPopover) {
                    Card(modifier = Modifier.padding(top = 8.dp).width(200.dp).align(Alignment.End), elevation = CardDefaults.cardElevation(12.dp)) {
                        Column(modifier = Modifier.padding(vertical = 8.dp)) {
                            listOf("All Stations", "Available", "In Use", "Low Fuel", "Medium Fuel", "Open 24h").forEach { filter ->
                                Text(filter, modifier = Modifier.fillMaxWidth().clickable { selectedFilter = filter; showFilterPopover = false }.background(if (selectedFilter == filter) MaterialTheme.colorScheme.primaryContainer.copy(alpha = 0.5f) else Color.Transparent).padding(horizontal = 20.dp, vertical = 12.dp))
                            }
                        }
                    }
                }
            }

            // Bottom Navigation Pill
            Surface(
                modifier = Modifier.align(Alignment.BottomCenter).padding(bottom = 32.dp, start = 16.dp, end = 16.dp).fillMaxWidth().height(64.dp).shadow(12.dp, RoundedCornerShape(32.dp)),
                shape = RoundedCornerShape(32.dp), color = MaterialTheme.colorScheme.surface.copy(alpha = 0.98f)
            ) {
                Row(modifier = Modifier.fillMaxSize(), horizontalArrangement = Arrangement.SpaceEvenly, verticalAlignment = Alignment.CenterVertically) {
                    BottomTab.entries.forEach { tab ->
                        val selected = tab == BottomTab.Home
                        IconButton(onClick = { onTabSelected(tab) }) {
                            Icon(tab.icon, null, tint = if (selected) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f))
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun StationDrawerSummary(station: Station, onOpenStation: (String) -> Unit) {
    Column(modifier = Modifier.fillMaxWidth().padding(horizontal = 8.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Row(modifier = Modifier.fillMaxWidth(), verticalAlignment = Alignment.Top) {
            Column(modifier = Modifier.weight(1f)) {
                Text(station.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                Text(station.address, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant, maxLines = 1)
            }
            Surface(shape = CircleShape, color = Color(0xFF43A047), modifier = Modifier.size(44.dp).clickable { onOpenStation(station.publicId) }) {
                Box(contentAlignment = Alignment.Center) { Icon(Icons.AutoMirrored.Filled.ArrowForward, null, tint = Color.White, modifier = Modifier.size(20.dp)) }
            }
        }
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            StatusPill(station.status)
            RatingRow(station.rating, station.reviewsCount)
            IconLabel(Icons.Default.Directions, "${station.distanceKm} km")
        }
        Button(onClick = { onOpenStation(station.publicId) }, modifier = Modifier.fillMaxWidth().height(48.dp), shape = RoundedCornerShape(12.dp)) {
            Text("View Station Details", fontWeight = FontWeight.Bold)
        }
    }
}

@Composable
private fun AccountScreen(profile: UserProfile?, onOpenSettings: () -> Unit, onOpenWallet: () -> Unit, onBack: () -> Unit) {
    Scaffold(topBar = { AppTopBar("Account", true, onBack) }) { p ->
        profile?.let { user ->
            LazyColumn(modifier = Modifier.fillMaxSize().padding(p), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(20.dp)) {
                item {
                    Card(modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(24.dp)) {
                        Column(modifier = Modifier.padding(24.dp).fillMaxWidth(), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
                            Surface(modifier = Modifier.size(80.dp), shape = CircleShape, color = MaterialTheme.colorScheme.primaryContainer) {
                                Box(contentAlignment = Alignment.Center) { Text(user.fullName.take(1).uppercase(), style = MaterialTheme.typography.headlineLarge, color = MaterialTheme.colorScheme.primary, fontWeight = FontWeight.Bold) }
                            }
                            Text(user.fullName, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold)
                            Text(user.email, style = MaterialTheme.typography.bodyMedium, color = MaterialTheme.colorScheme.onSurfaceVariant)
                            Surface(modifier = Modifier.padding(top = 12.dp), shape = RoundedCornerShape(12.dp), color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f)) {
                                Row(modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp), verticalAlignment = Alignment.CenterVertically) {
                                    Text("UID: ", style = MaterialTheme.typography.labelLarge, color = MaterialTheme.colorScheme.onSurfaceVariant)
                                    Text(user.publicId, style = MaterialTheme.typography.labelLarge, fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
                                }
                            }
                        }
                    }
                }
                item { Row(horizontalArrangement = Arrangement.spacedBy(16.dp), modifier = Modifier.fillMaxWidth()) {
                    Button(onClick = onOpenWallet, modifier = Modifier.weight(1f).height(56.dp), shape = RoundedCornerShape(16.dp)) { Icon(Icons.Default.AccountBalanceWallet, null); Spacer(Modifier.width(8.dp)); Text("Wallet") }
                    OutlinedButton(onClick = onOpenSettings, modifier = Modifier.weight(1f).height(56.dp), shape = RoundedCornerShape(16.dp)) { Icon(Icons.Default.Settings, null); Spacer(Modifier.width(8.dp)); Text("Settings") }
                } }
                item { SectionTitle("Activity") }
                items(listOf("Reservations" to Icons.Default.Schedule, "History" to Icons.AutoMirrored.Filled.ReceiptLong)) { (name, icon) ->
                    ListItem(headlineContent = { Text(name) }, leadingContent = { Icon(icon, null, tint = MaterialTheme.colorScheme.primary) }, trailingContent = { Icon(Icons.Default.ChevronRight, null) }, modifier = Modifier.clip(RoundedCornerShape(16.dp)).clickable { })
                }
            }
        }
    }
}

@Composable
private fun WalletScreen(summary: WalletSummary?, transactions: List<WalletTransaction>, onSendCredit: () -> Unit) {
    var showQr by remember { mutableStateOf(false) }
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Card(shape = RoundedCornerShape(28.dp), colors = CardDefaults.cardColors(containerColor = Color(0xFF101C2B))) {
                Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                    Text("Total Balance", color = Color.White.copy(alpha = 0.6f))
                    Text(summary?.balanceLabel ?: "MWK 0", color = Color.White, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.Bold)
                    Row(modifier = Modifier.padding(top = 12.dp).fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                        Button(onClick = onSendCredit, modifier = Modifier.weight(1f), colors = ButtonDefaults.buttonColors(containerColor = Color.White, contentColor = Color(0xFF101C2B)), shape = RoundedCornerShape(12.dp)) { Icon(Icons.AutoMirrored.Filled.Send, null, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Send") }
                        OutlinedButton(onClick = { showQr = true }, modifier = Modifier.weight(1f), border = BorderStroke(1.dp, Color.White.copy(alpha = 0.3f)), shape = RoundedCornerShape(12.dp)) { Icon(Icons.Default.QrCode, null, tint = Color.White, modifier = Modifier.size(18.dp)); Spacer(Modifier.width(8.dp)); Text("Receive", color = Color.White) }
                    }
                }
            }
        }
        item { SectionTitle("Activity") }
        items(transactions) { tx ->
            ListItem(headlineContent = { Text(tx.title, fontWeight = FontWeight.SemiBold) }, supportingContent = { Text(tx.subtitle) }, trailingContent = { Text(tx.amountLabel, fontWeight = FontWeight.Bold, color = if (tx.amount >= 0) Color(0xFF43A047) else MaterialTheme.colorScheme.onSurface) })
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp), color = MaterialTheme.colorScheme.outlineVariant.copy(alpha = 0.3f))
        }
    }
    if (showQr) { Dialog(onDismissRequest = { showQr = false }) {
        Card(shape = RoundedCornerShape(28.dp)) { Column(modifier = Modifier.padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Text("Your ID", style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Box(modifier = Modifier.size(180.dp).background(Color.White).padding(16.dp)) { Icon(Icons.Default.QrCode, null, modifier = Modifier.fillMaxSize(), tint = Color.Black) }
            Text(summary?.walletPublicId ?: "USR-ID", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary)
            Button(onClick = { showQr = false }, modifier = Modifier.fillMaxWidth()) { Text("Close") }
        } }
    } }
}

@Composable
private fun QueueScreen(snapshot: QueueSnapshot?, onBrowseStations: () -> Unit, onLeave: () -> Unit, onDispense: (Int) -> Unit) {
    if (snapshot == null) {
        Column(modifier = Modifier.fillMaxSize().padding(40.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.Center) {
            Icon(Icons.Default.Timer, null, modifier = Modifier.size(80.dp), tint = MaterialTheme.colorScheme.primary.copy(alpha = 0.1f))
            Text("No Active Queue", modifier = Modifier.padding(top = 24.dp), style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
            Button(onClick = onBrowseStations, modifier = Modifier.padding(top = 32.dp), shape = RoundedCornerShape(16.dp)) { Text("Explore Stations") }
        }
    } else {
        LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item {
                Box(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Brush.verticalGradient(listOf(Color(0xFF0F2636), Color(0xFF1B4D5E)))).padding(24.dp)) {
                    Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                        Text(snapshot.stationName, color = Color.White.copy(alpha = 0.7f))
                        Text("Position #${snapshot.position}", color = Color.White, style = MaterialTheme.typography.displaySmall, fontWeight = FontWeight.ExtraBold)
                        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) { IconLabelWhite(Icons.Default.Group, "${snapshot.carsAhead} ahead"); IconLabelWhite(Icons.Default.Schedule, "${snapshot.etaMinutes} min") }
                    }
                }
            }
            item { Card(shape = RoundedCornerShape(20.dp)) { Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Fuel Type"); Text(snapshot.fuelType, fontWeight = FontWeight.Bold) }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Volume"); Text("${snapshot.liters}L", fontWeight = FontWeight.Bold) }
                Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text("Guarantee"); StatusPill(snapshot.guaranteeState) }
            } } }
            item { Button(onClick = { onDispense(snapshot.liters) }, modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(16.dp)) { Icon(Icons.Default.LocalGasStation, null); Spacer(Modifier.width(12.dp)); Text("Request Dispense") } }
            item { OutlinedButton(onClick = onLeave, modifier = Modifier.fillMaxWidth().height(56.dp), colors = ButtonDefaults.outlinedButtonColors(contentColor = MaterialTheme.colorScheme.error), border = BorderStroke(1.dp, MaterialTheme.colorScheme.error.copy(alpha = 0.3f)), shape = RoundedCornerShape(16.dp)) { Text("Leave Queue") } }
        }
    }
}

@Composable
private fun OrdersScreen(onOpenWallet: () -> Unit, onCreateOrder: (String, String, Double?, Double?) -> Unit) {
    var sid by remember { mutableStateOf("") }
    var fuel by remember { mutableStateOf("PETROL") }
    var amt by remember { mutableStateOf("") }
    var lts by remember { mutableStateOf("") }
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
        item {
            Box(modifier = Modifier.fillMaxWidth().clip(RoundedCornerShape(28.dp)).background(Brush.linearGradient(listOf(Color(0xFF0F2636), Color(0xFF2E6B7A)))).padding(24.dp)) {
                Column(verticalArrangement = Arrangement.spacedBy(8.dp)) {
                    Text("Wallet Orders", color = Color.White.copy(alpha = 0.7f))
                    Text("Reserve Fuel", style = MaterialTheme.typography.headlineSmall, color = Color.White, fontWeight = FontWeight.Bold)
                    Text("Hold funds for fuel dispense soon.", color = Color.White.copy(alpha = 0.9f))
                }
            }
        }
        item { Card(shape = RoundedCornerShape(24.dp)) { Column(modifier = Modifier.padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            OutlinedTextField(value = sid, onValueChange = { sid = it }, label = { Text("Station ID") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp))
            Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { listOf("PETROL", "DIESEL").forEach { type -> FilterChip(selected = fuel == type, onClick = { fuel = type }, label = { Text(type) }) } }
            OutlinedTextField(value = amt, onValueChange = { amt = it }, label = { Text("Amount (MWK)") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp))
            Text("— OR —", modifier = Modifier.fillMaxWidth(), textAlign = TextAlign.Center)
            OutlinedTextField(value = lts, onValueChange = { lts = it }, label = { Text("Liters") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp))
            Button(onClick = { onCreateOrder(sid, fuel, amt.toDoubleOrNull(), lts.toDoubleOrNull()) }, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(16.dp), enabled = sid.isNotBlank()) { Text("Create Order") }
        } } }
        item { OutlinedButton(onClick = onOpenWallet, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp)) { Text("Go to Wallet") } }
    }
}

@Composable
private fun AssistantScreen(onAsk: suspend (String) -> String, onBack: () -> Unit) {
    var msg by remember { mutableStateOf("") }
    val chat = remember { mutableStateListOf<Pair<String, Boolean>>() }
    val scope = rememberCoroutineScope()
    Scaffold(topBar = { AppTopBar("Assistant", true, onBack) }) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            LazyColumn(modifier = Modifier.weight(1f).padding(horizontal = 16.dp), verticalArrangement = Arrangement.spacedBy(12.dp), contentPadding = PaddingValues(vertical = 16.dp)) {
                items(chat) { (text, isUser) -> Box(modifier = Modifier.fillMaxWidth(), contentAlignment = if (isUser) Alignment.CenterEnd else Alignment.CenterStart) { Surface(color = if (isUser) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.surfaceVariant, shape = RoundedCornerShape(topStart = 16.dp, topEnd = 16.dp, bottomStart = if (isUser) 16.dp else 0.dp, bottomEnd = if (isUser) 0.dp else 16.dp)) { Text(text, modifier = Modifier.padding(12.dp), color = if (isUser) Color.White else MaterialTheme.colorScheme.onSurface) } } } }
            }
            Surface(tonalElevation = 4.dp) { Row(modifier = Modifier.padding(16.dp).navigationBarsPadding(), verticalAlignment = Alignment.CenterVertically, horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                OutlinedTextField(value = msg, onValueChange = { msg = it }, modifier = Modifier.weight(1f), placeholder = { Text("Ask SmartLink...") }, shape = RoundedCornerShape(24.dp))
                FloatingActionButton(onClick = { if (msg.isNotBlank()) { val u = msg; chat.add(u to true); msg = ""; scope.launch { val r = onAsk(u); chat.add(r to false) } } }, modifier = Modifier.size(52.dp)) { Icon(Icons.AutoMirrored.Filled.Send, null) }
            } }
        }
    }

@Composable
private fun SendCreditScreen(walletSummary: WalletSummary?, onPreview: suspend (String, Double) -> String, onSend: suspend (String, Double, String) -> Unit, onBack: () -> Unit) {
    var rec by remember { mutableStateOf("") }
    var valAmt by remember { mutableStateOf("") }
    var nte by remember { mutableStateOf("") }
    var prv by remember { mutableStateOf<String?>(null) }
    var sdn by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()
    Scaffold(topBar = { AppTopBar("Send Credit", true, onBack) }) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding).padding(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            Card { Row(modifier = Modifier.padding(16.dp), verticalAlignment = Alignment.CenterVertically) { Icon(Icons.Default.AccountBalanceWallet, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(12.dp)); Text("Available: ${walletSummary?.balanceLabel ?: "-"}") } }
            OutlinedTextField(value = rec, onValueChange = { rec = it }, label = { Text("Recipient UID") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp))
            OutlinedTextField(value = valAmt, onValueChange = { valAmt = it }, label = { Text("Amount (MWK)") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp))
            OutlinedTextField(value = nte, onValueChange = { nte = it }, label = { Text("Note") }, modifier = Modifier.fillMaxWidth(), shape = RoundedCornerShape(16.dp))
            prv?.let { Card(colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.primaryContainer)) { Text(it, modifier = Modifier.padding(16.dp)) } }
            Button(onClick = { scope.launch { if (prv == null) prv = onPreview(rec, valAmt.toDoubleOrNull() ?: 0.0) else { sdn = true; runCatching { onSend(rec, valAmt.toDoubleOrNull() ?: 0.0, nte) }.onSuccess { onBack() }.onFailure { prv = it.message }; sdn = false } } }, modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(16.dp), enabled = !sdn && rec.isNotBlank()) { if (sdn) CircularProgressIndicator(modifier = Modifier.size(24.dp)) else Text(if (prv == null) "Preview" else "Confirm & Send") }
        }
    }
}

@Composable
private fun LoginScreen(error: String, onSignIn: (String, String, Boolean, String, String, String) -> Unit) {
    var idn by rememberSaveable { mutableStateOf("") }
    var pwd by rememberSaveable { mutableStateOf("") }
    var cre by rememberSaveable { mutableStateOf(false) }
    var fnm by rememberSaveable { mutableStateOf("") }
    var phn by rememberSaveable { mutableStateOf("") }
    var eml by rememberSaveable { mutableStateOf("") }
    Column(modifier = Modifier.fillMaxSize().background(Brush.verticalGradient(listOf(Color(0xFF082336), Color(0xFF133B56), Color(0xFFF4F8FB)))), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
        Card(modifier = Modifier.padding(24.dp), shape = RoundedCornerShape(28.dp), colors = CardDefaults.cardColors(containerColor = Color.White.copy(alpha = 0.95f))) {
            Column(modifier = Modifier.padding(24.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
                Text("SmartLink", style = MaterialTheme.typography.headlineMedium, fontWeight = FontWeight.ExtraBold)
                OutlinedTextField(value = idn, onValueChange = { idn = it }, label = { Text("Email or Phone") }, modifier = Modifier.fillMaxWidth())
                OutlinedTextField(value = pwd, onValueChange = { pwd = it }, label = { Text("Password") }, visualTransformation = PasswordVisualTransformation(), modifier = Modifier.fillMaxWidth())
                if (cre) {
                    OutlinedTextField(value = fnm, onValueChange = { fnm = it }, label = { Text("Full Name") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = phn, onValueChange = { phn = it }, label = { Text("Phone") }, modifier = Modifier.fillMaxWidth())
                    OutlinedTextField(value = eml, onValueChange = { eml = it }, label = { Text("Email") }, modifier = Modifier.fillMaxWidth())
                }
                Button(onClick = { onSignIn(idn, pwd, cre, fnm, phn, eml) }, modifier = Modifier.fillMaxWidth().height(52.dp), shape = RoundedCornerShape(16.dp)) { Text(if (cre) "Sign Up" else "Sign In") }
                if (error.isNotBlank()) Text(error, color = MaterialTheme.colorScheme.error)
                TextButton(onClick = { cre = !cre }) { Text(if (cre) "Already have an account? Sign In" else "New here? Create account") }
            }
        }
    }
}

@Composable
private fun StationsScreen(stations: List<Station>, onSelectStation: (String) -> Unit, onBack: () -> Unit) {
    var q by rememberSaveable { mutableStateOf("") }
    Scaffold(topBar = { AppTopBar("Stations", true, onBack) }) { p ->
        val filtered = stations.filter { it.name.contains(q, true) || it.address.contains(q, true) }
        Column(modifier = Modifier.padding(p)) {
            OutlinedTextField(value = q, onValueChange = { q = it }, modifier = Modifier.fillMaxWidth().padding(16.dp), placeholder = { Text("Search...") }, leadingIcon = { Icon(Icons.Default.Search, null) }, shape = RoundedCornerShape(16.dp))
            LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) {
                items(filtered) { s -> StationRowCard(s, onClick = { onSelectStation(s.publicId) }) }
            }
        }
    }
}

@Composable
private fun StationDetailsScreen(station: Station, isFavorite: Boolean, onToggleFavorite: () -> Unit, onDirections: () -> Unit, onJoinQueue: () -> Unit, onReserve: () -> Unit, onBack: () -> Unit) {
    Scaffold(topBar = { AppTopBar("Station Details", true, onBack) }) { p ->
        LazyColumn(modifier = Modifier.fillMaxSize().padding(p), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(16.dp)) {
            item { Box(modifier = Modifier.fillMaxWidth().height(200.dp).clip(RoundedCornerShape(24.dp)).background(Color(0xFFE2F0F5)), contentAlignment = Alignment.Center) { Icon(Icons.Default.LocalGasStation, null, modifier = Modifier.size(64.dp), tint = Color(0xFF28556D)) } }
            item { Column { Text(station.name, style = MaterialTheme.typography.headlineSmall, fontWeight = FontWeight.Bold); Text(station.address, color = MaterialTheme.colorScheme.onSurfaceVariant) } }
            item { Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) { Button(onClick = onJoinQueue, modifier = Modifier.weight(1f), shape = RoundedCornerShape(16.dp)) { Text("Join Queue") }; OutlinedButton(onClick = onReserve, modifier = Modifier.weight(1f), shape = RoundedCornerShape(16.dp)) { Text("Reserve") } } }
            item { Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(12.dp)) { OutlinedButton(onClick = onDirections, modifier = Modifier.weight(1f), shape = RoundedCornerShape(16.dp)) { Icon(Icons.Default.Directions, null); Text(" Directions") }; OutlinedButton(onClick = onToggleFavorite, modifier = Modifier.weight(1f), shape = RoundedCornerShape(16.dp)) { Icon(if (isFavorite) Icons.Default.Bookmark else Icons.Outlined.Bookmark, null); Text(if (isFavorite) " Saved" else " Save") } } }
            item { SectionTitle("Prices") }
            items(station.prices) { pr -> Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.SpaceBetween) { Text(pr.label); Text(pr.value, fontWeight = FontWeight.Bold) } }
        }
    }
}

@Composable
private fun DirectionsScreen(station: Station, onBack: () -> Unit) { Scaffold(topBar = { AppTopBar("Directions", true, onBack) }) { p -> Box(modifier = Modifier.fillMaxSize().padding(p), contentAlignment = Alignment.Center) { Text("Directions for ${station.name}") } } }

@Composable
private fun SavedScreen(stations: List<Station>, onOpenStation: (String) -> Unit, onBack: () -> Unit) { Scaffold(topBar = { AppTopBar("Saved", true, onBack) }) { p -> if (stations.isEmpty()) EmptyStateCard("Empty", "No saved stations.") else LazyColumn(modifier = Modifier.fillMaxSize().padding(p), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { items(stations) { s -> StationRowCard(s, onClick = { onOpenStation(s.publicId) }) } } } }

@Composable
private fun ReservationsScreen(reservations: List<Reservation>, onCheckIn: (String) -> Unit, onCancel: (String) -> Unit, onBack: () -> Unit) { 
    Scaffold(topBar = { AppTopBar("Reservations", true, onBack) }) { p -> LazyColumn(modifier = Modifier.fillMaxSize().padding(p), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { items(reservations) { r -> Card { Column(modifier = Modifier.padding(16.dp), verticalArrangement = Arrangement.spacedBy(8.dp)) { Text(r.stationName, fontWeight = FontWeight.Bold); Text("${r.liters}L ${r.fuelType} • ${r.timeSlot}"); BadgeText(r.status); Row(modifier = Modifier.fillMaxWidth(), horizontalArrangement = Arrangement.spacedBy(8.dp)) { Button(onClick = { onCheckIn(r.publicId) }, modifier = Modifier.weight(1f)) { Text("Check In") }; OutlinedButton(onClick = { onCancel(r.publicId) }, modifier = Modifier.weight(1f)) { Text("Cancel") } } } } } } } 
}

@Composable
private fun HistoryScreen(history: List<HistoryEntry>, onBack: () -> Unit) { Scaffold(topBar = { AppTopBar("History", true, onBack) }) { p -> LazyColumn(modifier = Modifier.fillMaxSize().padding(p), contentPadding = PaddingValues(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { items(history) { e -> ListItem(headlineContent = { Text(e.title) }, trailingContent = { Text(e.amountLabel) }) } } } }

@Composable
private fun AlertsScreen(alerts: List<UserAlert>, onMarkAllRead: () -> Unit, onArchive: (String) -> Unit, onBack: () -> Unit) { Scaffold(topBar = { AppTopBar("Alerts", true, onBack) }, floatingActionButton = { FloatingActionButton(onClick = onMarkAllRead) { Icon(Icons.Default.DoneAll, null) } }) { p -> LazyColumn(modifier = Modifier.fillMaxSize().padding(p)) { items(alerts) { a -> ListItem(headlineContent = { Text(a.title, fontWeight = if (a.isRead) FontWeight.Normal else FontWeight.Bold) }, supportingContent = { Text(a.message) }, trailingContent = { IconButton(onClick = { onArchive(a.publicId) }) { Icon(Icons.Default.Archive, null) } }) } } } }

@Composable
private fun HelpScreen(contact: SupportContact?, tickets: List<SupportTicket>, onBack: () -> Unit) { Scaffold(topBar = { AppTopBar("Help", true, onBack) }) { p -> LazyColumn(modifier = Modifier.fillMaxSize().padding(p), contentPadding = PaddingValues(16.dp)) { items(tickets) { t -> Card(modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp)) { Column(modifier = Modifier.padding(16.dp)) { Text(t.title, fontWeight = FontWeight.Bold); BadgeText(t.status) } } } } } }

@Composable
private fun SettingsScreen(darkThemeEnabled: Boolean, notificationsEnabled: Boolean, onToggleTheme: () -> Unit, onToggleNotifications: () -> Unit, onBack: () -> Unit) { Scaffold(topBar = { AppTopBar("Settings", true, onBack) }) { p -> Column(modifier = Modifier.padding(p).padding(16.dp), verticalArrangement = Arrangement.spacedBy(12.dp)) { ListItem(headlineContent = { Text("Dark Mode") }, trailingContent = { Switch(darkThemeEnabled, { onToggleTheme() }) }); ListItem(headlineContent = { Text("Notifications") }, trailingContent = { Switch(notificationsEnabled, { onToggleNotifications() }) }) } } }

@Composable
private fun MoreScreen(unreadAlerts: Int, onNavigate: (UserRoute) -> Unit, onLogout: () -> Unit) {
    val items = listOf(Triple("Account", Icons.Default.AccountCircle, UserRoute.Account), Triple("Notifications", Icons.Default.Notifications, UserRoute.Alerts), Triple("Appearance", Icons.Default.Tune, UserRoute.Settings), Triple("Help", Icons.AutoMirrored.Filled.HelpOutline, UserRoute.Help), Triple("Saved", Icons.Default.BookmarkBorder, UserRoute.Saved), Triple("Reservations", Icons.Default.Schedule, UserRoute.Reservations), Triple("History", Icons.AutoMirrored.Outlined.ReceiptLong, UserRoute.History), Triple("Assistant", Icons.Default.Assistant, UserRoute.Assistant))
    LazyColumn(modifier = Modifier.fillMaxSize(), contentPadding = PaddingValues(20.dp), verticalArrangement = Arrangement.spacedBy(14.dp)) { items(items) { i -> Card(modifier = Modifier.fillMaxWidth().clickable { onNavigate(i.third) }, colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) { Row(modifier = Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) { Icon(i.second, null, tint = MaterialTheme.colorScheme.primary); Spacer(Modifier.width(14.dp)); Text(i.first, modifier = Modifier.weight(1f), fontWeight = FontWeight.SemiBold); if (i.third == UserRoute.Alerts && unreadAlerts > 0) BadgeText("$unreadAlerts"); Icon(Icons.Default.ChevronRight, null) } } }; item { OutlinedButton(onClick = onLogout, modifier = Modifier.fillMaxWidth().height(56.dp), shape = RoundedCornerShape(16.dp)) { Text("Sign out") } } }
}

@Composable private fun SectionTitle(text: String) { Text(text, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold, modifier = Modifier.padding(vertical = 4.dp)) }
@Composable private fun BadgeText(text: String) { Box(modifier = Modifier.clip(RoundedCornerShape(6.dp)).background(MaterialTheme.colorScheme.surfaceVariant).padding(horizontal = 8.dp, vertical = 2.dp)) { Text(text, color = MaterialTheme.colorScheme.onSurfaceVariant, style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold) } }
@OptIn(ExperimentalMaterial3Api::class)
@Composable private fun AppTopBar(title: String, showBack: Boolean, onBack: () -> Unit) { TopAppBar(title = { Text(title, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold) }, navigationIcon = { if (showBack) IconButton(onClick = onBack) { Icon(Icons.AutoMirrored.Filled.ArrowBack, "Back") } }, colors = TopAppBarDefaults.topAppBarColors(containerColor = MaterialTheme.colorScheme.background)) }
@Composable private fun StationRowCard(station: Station, onClick: () -> Unit) { Card(modifier = Modifier.fillMaxWidth().clickable(onClick = onClick), colors = CardDefaults.cardColors(containerColor = MaterialTheme.colorScheme.surface)) { Row(modifier = Modifier.padding(18.dp), verticalAlignment = Alignment.CenterVertically) { Box(modifier = Modifier.size(42.dp).clip(CircleShape).background(Color(0xFFE2F0F5)), contentAlignment = Alignment.Center) { Icon(Icons.Default.LocalGasStation, null, tint = Color(0xFF28556D)) }; Spacer(Modifier.width(14.dp)); Column(modifier = Modifier.weight(1f)) { Text(station.name, fontWeight = FontWeight.SemiBold); Text("${station.distanceKm} km • ${station.hoursLabel}", color = MaterialTheme.colorScheme.onSurfaceVariant) }; Text("${station.etaMin} min", fontWeight = FontWeight.Bold, color = MaterialTheme.colorScheme.primary) } } }
@Composable private fun EmptyStateCard(title: String, message: String) { Column(modifier = Modifier.fillMaxWidth().padding(32.dp), horizontalAlignment = Alignment.CenterHorizontally) { Text(title, style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Bold); Text(message, color = MaterialTheme.colorScheme.onSurfaceVariant, textAlign = TextAlign.Center) } }

@Composable
private fun IconLabelWhite(icon: ImageVector, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, modifier = Modifier.size(16.dp), tint = Color.White.copy(alpha = 0.8f))
        Spacer(Modifier.width(6.dp))
        Text(label, color = Color.White.copy(alpha = 0.9f), style = MaterialTheme.typography.bodyMedium)
    }
}

@Composable
private fun RatingRow(rating: Double, count: Int) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(Icons.Filled.Star, contentDescription = null, tint = Color(0xFFFFB300), modifier = Modifier.size(16.dp))
        Text(" $rating", fontWeight = FontWeight.Bold)
        Text(" ($count)", color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun IconLabel(icon: ImageVector, label: String) {
    Row(verticalAlignment = Alignment.CenterVertically) {
        Icon(icon, null, modifier = Modifier.size(16.dp), tint = MaterialTheme.colorScheme.onSurfaceVariant)
        Spacer(Modifier.width(6.dp))
        Text(label, style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant)
    }
}

@Composable
private fun StatusPill(status: String) {
    val color = when (status.lowercase()) {
        "available" -> Color(0xFF43A047)
        "in use" -> Color(0xFFFB8C00)
        "low" -> Color(0xFFE53935)
        else -> Color(0xFF757575)
    }
    Surface(color = color.copy(alpha = 0.1f), shape = RoundedCornerShape(50), border = BorderStroke(1.dp, color.copy(alpha = 0.4f))) {
        Text(status, modifier = Modifier.padding(horizontal = 10.dp, vertical = 4.dp), style = MaterialTheme.typography.labelSmall, color = color, fontWeight = FontWeight.ExtraBold)
    }
}

private fun activeTab(route: UserRoute): BottomTab = when (route) {
    UserRoute.Orders -> BottomTab.Orders
    UserRoute.Queue -> BottomTab.Queue
    UserRoute.Wallet, UserRoute.SendCredit -> BottomTab.Wallet
    UserRoute.More, UserRoute.Saved, UserRoute.Reservations, UserRoute.History, UserRoute.Alerts, UserRoute.Help, UserRoute.Settings, UserRoute.Account, UserRoute.Assistant -> BottomTab.More
    else -> BottomTab.Home
}

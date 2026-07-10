package com.example.smartlink.ui.screens

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.unit.dp

@Composable fun SchoolLoginScreen(loading: Boolean, error: String?, onLogin: (String, String, Boolean) -> Unit) {
    var identifier by remember { mutableStateOf("") }; var password by remember { mutableStateOf("") }; var student by remember { mutableStateOf(true) }
    Column(Modifier.fillMaxSize().background(Color(0xFFEEEEEE)).padding(24.dp), verticalArrangement = Arrangement.Center) { Surface(Modifier.fillMaxWidth(), shape = RoundedCornerShape(15.dp), shadowElevation = 2.dp) { Column(Modifier.padding(28.dp), horizontalAlignment = Alignment.CenterHorizontally) { Icon(Icons.Default.School, null, tint = MaterialTheme.colorScheme.primary, modifier = Modifier.size(42.dp)); Text("SMARTLINK SCHOOLS - PORTAL", style = MaterialTheme.typography.titleMedium, fontWeight = FontWeight.Medium, modifier = Modifier.padding(top = 14.dp)); Text(if (student) "Students can open results, fees, homework and notices here" else "Staff can enter the school workspace", style = MaterialTheme.typography.bodySmall, color = MaterialTheme.colorScheme.onSurfaceVariant, modifier = Modifier.padding(top = 6.dp)); Spacer(Modifier.height(22.dp)); Row { FilterChip(student, { student = true }, label = { Text("Student") }); Spacer(Modifier.width(8.dp)); FilterChip(!student, { student = false }, label = { Text("Staff") }) }; Spacer(Modifier.height(14.dp)); OutlinedTextField(identifier, { identifier = it }, label = { Text(if (student) "Student ID / Admission No" else "Email address") }, leadingIcon = { Icon(Icons.Default.Person, null) }, modifier = Modifier.fillMaxWidth(), singleLine = true); Spacer(Modifier.height(10.dp)); OutlinedTextField(password, { password = it }, label = { Text(if (student) "Date of Birth" else "Password") }, placeholder = { if (student) Text("YYYY-MM-DD") }, leadingIcon = { Icon(Icons.Default.Lock, null) }, visualTransformation = if (student) androidx.compose.ui.text.input.VisualTransformation.None else PasswordVisualTransformation(), keyboardOptions = KeyboardOptions(keyboardType = if (student) KeyboardType.Text else KeyboardType.Password), modifier = Modifier.fillMaxWidth(), singleLine = true); if (!error.isNullOrBlank()) Text(error, color = MaterialTheme.colorScheme.error, style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(top = 10.dp)); Spacer(Modifier.height(18.dp)); Button({ onLogin(identifier, password, student) }, enabled = identifier.isNotBlank() && password.isNotBlank() && !loading, modifier = Modifier.fillMaxWidth().height(44.dp), shape = RoundedCornerShape(6.dp), colors = ButtonDefaults.buttonColors(containerColor = Color(0xFF6BDD9E), contentColor = Color(0xFF111111))) { if (loading) CircularProgressIndicator(Modifier.size(18.dp), color = Color(0xFF111111), strokeWidth = 2.dp) else Text("Sign in") } } } }
}

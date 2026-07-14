package com.example.smartlink.ui.screens

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.School
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.OutlinedTextFieldDefaults
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.input.PasswordVisualTransformation
import androidx.compose.ui.text.input.VisualTransformation
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.example.smartlink.ui.theme.SmartLinkRadius
import com.example.smartlink.ui.theme.SmartLinkTone

@Composable
fun SchoolLoginScreen(loading: Boolean, error: String?, onLogin: (String, String, Boolean) -> Unit) {
    var identifier by remember { mutableStateOf("") }
    var password by remember { mutableStateOf("") }
    var student by remember { mutableStateOf(true) }

    Column(
        Modifier
            .fillMaxSize()
            .background(Color(0xFFEEEEEE))
            .padding(horizontal = 22.dp, vertical = 28.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Surface(
            modifier = Modifier.fillMaxWidth(),
            shape = RoundedCornerShape(15.dp),
            color = Color.White,
            tonalElevation = 0.dp,
            shadowElevation = 0.dp,
            border = BorderStroke(1.dp, Color(0xFFE2E2E2)),
        ) {
            Column(Modifier.padding(horizontal = 26.dp, vertical = 30.dp), horizontalAlignment = Alignment.CenterHorizontally) {
                Surface(shape = RoundedCornerShape(10.dp), color = SmartLinkTone.Navy) {
                    Icon(Icons.Default.School, null, tint = Color.White, modifier = Modifier.padding(10.dp).size(22.dp))
                }
                Text(
                    "SMARTLINK SCHOOLS - PORTAL",
                    style = MaterialTheme.typography.titleMedium,
                    fontWeight = FontWeight.Medium,
                    color = Color(0xFF191919),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 16.dp),
                )
                Text(
                    if (student) "Students and guardians can open results, fees, homework and notices here" else "Staff can enter their email and password to access the school workspace",
                    style = MaterialTheme.typography.bodySmall,
                    color = Color(0xFF747474),
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 6.dp),
                )

                Spacer(Modifier.height(22.dp))
                Row(horizontalArrangement = Arrangement.spacedBy(8.dp), modifier = Modifier.fillMaxWidth()) {
                    FilterChip(selected = student, onClick = { student = true; password = "" }, label = { Text("Student") }, modifier = Modifier.weight(1f))
                    FilterChip(selected = !student, onClick = { student = false; password = "" }, label = { Text("Staff") }, modifier = Modifier.weight(1f))
                }
                Spacer(Modifier.height(14.dp))
                PortalTextField(
                    value = identifier,
                    onValueChange = { identifier = it },
                    label = if (student) "Student ID / Admission No" else "Staff Email",
                    placeholder = if (student) "SL-P1-001" else "admin@greenhill.mw",
                    icon = Icons.Default.Person,
                    keyboardType = if (student) KeyboardType.Text else KeyboardType.Email,
                )
                Spacer(Modifier.height(10.dp))
                PortalTextField(
                    value = password,
                    onValueChange = { password = it },
                    label = if (student) "Date of Birth" else "Password",
                    placeholder = if (student) "YYYY-MM-DD" else "Enter password",
                    icon = Icons.Default.Lock,
                    keyboardType = if (student) KeyboardType.Text else KeyboardType.Password,
                    visualTransformation = if (student) VisualTransformation.None else PasswordVisualTransformation(),
                )
                if (!error.isNullOrBlank()) {
                    Surface(
                        modifier = Modifier.fillMaxWidth().padding(top = 12.dp),
                        color = Color(0xFFFFF1F1),
                        shape = RoundedCornerShape(6.dp),
                        border = BorderStroke(1.dp, Color(0xFFEFCACA)),
                    ) {
                        Text(error, color = Color(0xFF9B3838), style = MaterialTheme.typography.bodySmall, modifier = Modifier.padding(10.dp))
                    }
                }
                Spacer(Modifier.height(20.dp))
                Button(
                    onClick = { onLogin(identifier, password, student) },
                    enabled = identifier.isNotBlank() && password.isNotBlank() && !loading,
                    modifier = Modifier.fillMaxWidth().height(44.dp),
                    shape = RoundedCornerShape(SmartLinkRadius.control),
                    colors = ButtonDefaults.buttonColors(containerColor = SmartLinkTone.Mint, contentColor = Color(0xFF111111)),
                ) {
                    if (loading) CircularProgressIndicator(Modifier.size(18.dp), color = Color(0xFF111111), strokeWidth = 2.dp) else Text(if (student) "Student Login" else "Staff Login", fontWeight = FontWeight.SemiBold)
                }
                Text(
                    if (student) "Are you an admin? Switch to staff login." else "Student or guardian? Switch to student login.",
                    color = Color(0xFF747474),
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    modifier = Modifier.padding(top = 14.dp),
                )
            }
        }
    }
}

@Composable
private fun PortalTextField(
    value: String,
    onValueChange: (String) -> Unit,
    label: String,
    placeholder: String,
    icon: androidx.compose.ui.graphics.vector.ImageVector,
    keyboardType: KeyboardType,
    visualTransformation: VisualTransformation = VisualTransformation.None,
) {
    OutlinedTextField(
        value = value,
        onValueChange = onValueChange,
        label = { Text(label) },
        placeholder = { Text(placeholder) },
        leadingIcon = { Icon(icon, null) },
        visualTransformation = visualTransformation,
        keyboardOptions = KeyboardOptions(keyboardType = keyboardType),
        modifier = Modifier.fillMaxWidth(),
        singleLine = true,
        shape = RoundedCornerShape(6.dp),
        colors = OutlinedTextFieldDefaults.colors(
            focusedBorderColor = SmartLinkTone.Navy,
            unfocusedBorderColor = Color(0xFFD6D6D6),
            focusedContainerColor = Color(0xFFFDFDFD),
            unfocusedContainerColor = Color(0xFFFDFDFD),
        ),
    )
}

package com.example.smartlink

import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import com.example.smartlink.ui.SmartlinkUserApp
import com.example.smartlink.ui.theme.SmartlinkTheme

class MainActivity : ComponentActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            SmartlinkTheme {
                SmartlinkUserApp()
            }
        }
    }
}

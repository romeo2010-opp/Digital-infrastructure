package com.example.smartlink.navigation

enum class StudentRoute(val label: String) {
    Home("Home"),
    Results("Results"),
    Fees("Fees"),
    Homework("Homework"),
    Attendance("Attendance"),
    Timetable("Timetable"),
    Drills("Practice"),
    Notices("Notices"),
    Profile("Profile"),
}

enum class StaffRoute(val label: String, val portal: String) {
    Command("Dashboard", "School Operations"),
    Students("Students", "School Operations"),
    Attendance("Attendance", "School Operations"),
    Finance("Finance", "Bursar Portal"),
    Learning("Learning", "Teaching & Learning"),
    Results("Results", "Teaching & Learning"),
    Messages("Messages", "Communication"),
    Settings("Settings", "Workspace"),
}

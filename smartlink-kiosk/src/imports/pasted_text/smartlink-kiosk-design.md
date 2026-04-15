Design a professional, enterprise-grade touchscreen kiosk interface for a fuel station operations system called “SmartLink”.

The interface must be optimized for real-world attendants under pressure. Focus on clarity, speed, and zero ambiguity. Avoid decorative UI, gradients, or startup-style visuals. The design should feel industrial, structured, and highly functional.

Canvas size: 1920x1080 (landscape touchscreen kiosk)

Layout structure: 3-column grid

LEFT PANEL (Queue Management - 30% width):

* Title: “Queue”
* Vertical list of customers
* Each row contains:

  * Queue position (large number)
  * User type badge:

    * SmartLink user (blue)
    * Walk-in (yellow)
  * Fuel type (Petrol/Diesel)
  * Requested litres or amount
  * Wait time
  * Status badge (READY, ARRIVED, NO-SHOW)
* First item in queue must be visually highlighted
* Each row has a large “SELECT” button

CENTER PANEL (Active Session - 40% width):

* Title: “Active Session”
* Displays currently selected customer:

  * Name or Walk-in ID
  * Fuel type
  * Requested litres
  * Assigned pump
* Large status indicator:

  * Green: Dispensing
  * Yellow: Waiting
  * Red: Error
* Primary action buttons (very large, touch-friendly):

  * START DISPENSING (primary)
  * CANCEL
  * SWITCH PUMP
  * REPORT ISSUE

RIGHT PANEL (Pump Status - 30% width):

* Title: “Pump Status”
* Grid of pump cards
* Each card shows:

  * Pump ID
  * Fuel types available
  * Status:

    * Idle (green)
    * Dispensing (blue)
    * Offline (red)
  * Live litres counter (if active)

TOP BAR:

* Station name (left)
* Current time (center)
* Connection status indicator (online/offline)
* Active attendant name (right)

BOTTOM SECTION:

* Persistent QR scanning zone with label:
  “Scan Customer QR”
* Large visible scan area

FLOATING BUTTON:

* Bottom-right corner:
  “Report Issue” button
* Opens modal with:

  * Reason dropdown (No fuel dispensed, Wrong litres, Pump error)
  * Submit button

STYLE REQUIREMENTS:

* Color palette:

  * Primary: Deep navy (#0B1F3A)
  * Secondary: Steel blue
  * Status colors: Green, Yellow, Red (clear contrast)
* Typography: Clean sans-serif (Inter or similar)
* Large touch targets (minimum 48px height)
* Thin borders, subtle shadows
* No rounded playful UI — keep it sharp and professional
* No charts, no analytics, no decorative elements

INTERACTION NOTES:

* First queue item is always auto-highlighted
* Actions must be achievable in 1–2 taps
* Real-time updates implied (no loading-heavy UI)

Goal:
This interface must feel like a mission-critical infrastructure system used in a busy fuel station, not a consumer app.

export const helpContent = {
  categories: [
    {
      key: "pumps",
      title: "Pumps & Dispensing",
      items: [
        {
          id: "pump-offline-dispensing",
          title: "Pump shows OFFLINE but fuel is dispensing",
          symptoms:
            "Nozzle is physically dispensing but SmartLink status remains OFFLINE or PAUSED.",
          steps: [
            "Confirm nozzle and pump status in Settings > Pumps.",
            "Check if the pump/nozzle was manually paused.",
            "Refresh Digital Queue snapshot to force latest status pull.",
            "Record a test transaction from Transactions Test to validate mapping.",
            "If issue continues, restart local pump controller and retry.",
          ],
          linksToRoutes: [
            { label: "Digital Queue", to: "/digitalQueue" },
            { label: "Settings", to: "/settings" },
            { label: "Transactions Test", to: "/transactions-test" },
          ],
          escalateText: "If this persists, report issue with screenshot and pump/nozzle ID.",
        },
        {
          id: "sale-not-reflecting",
          title: "Sale was made but transaction does not appear",
          symptoms:
            "Customer paid and was served, but transaction list or report totals did not update.",
          steps: [
            "Check connection status and pending sync count.",
            "If OFFLINE, wait for SYNCING/ONLINE and refresh page.",
            "Open Reports and verify selected date/filter scope.",
            "Validate nozzle mapping in Settings for the affected pump.",
            "Retry with a small test transaction to confirm ingestion.",
          ],
          linksToRoutes: [
            { label: "Transactions Test", to: "/transactions-test" },
            { label: "Reports", to: "/reports" },
            { label: "Settings", to: "/settings" },
          ],
          escalateText: "If this persists, report issue with screenshot and transaction details.",
        },
      ],
    },
    {
      key: "tanks",
      title: "Tank Monitoring & Deliveries",
      items: [
        {
          id: "delivery-no-stock-change",
          title: "Delivery recorded but stock did not change",
          symptoms:
            "Delivery submission succeeded but reconciliation still shows no stock movement.",
          steps: [
            "Verify correct tank row/tank ID was selected.",
            "Confirm delivery litres were entered as positive value.",
            "Refresh Reports snapshot after submission.",
            "Check if reading is missing for opening/closing balance.",
            "Retry delivery entry once with a clear supplier reference.",
          ],
          linksToRoutes: [
            { label: "Reports", to: "/reports" },
            { label: "Settings", to: "/settings" },
          ],
          escalateText: "If this persists, report issue with screenshot and tank name.",
        },
      ],
    },
    {
      key: "queue",
      title: "Digital Queue",
      items: [
        {
          id: "queue-stuck",
          title: "Queue appears stuck (cannot move next customer)",
          symptoms:
            "Call Next/Recall actions fail or queue position does not update after actions.",
          steps: [
            "Refresh queue snapshot from header refresh button.",
            "Check if queue is paused in Queue Rules.",
            "Confirm station queue capacity is not exceeded.",
            "Review recent queue audit actions for invalid transitions.",
            "Retry call-next after confirming one WAITING/LATE entry exists.",
          ],
          linksToRoutes: [{ label: "Digital Queue", to: "/digitalQueue" }],
          escalateText: "If this persists, report issue with screenshot and entry ID.",
        },
      ],
    },
    {
      key: "reservations",
      title: "Reservations",
      items: [
        {
          id: "reservation-missing",
          title: "Reservation is missing from queue/list",
          symptoms:
            "Customer confirms reservation but reservation list does not show expected record.",
          steps: [
            "Check search/filter status in Reservations page.",
            "Confirm reservation slot/date and customer details.",
            "Add reservation manually if customer is present and urgent.",
            "Notify customer from reservation action buttons.",
            "Log mismatch details for follow-up.",
          ],
          linksToRoutes: [{ label: "Reservations", to: "/reservations" }],
          escalateText: "If this persists, report issue with screenshot and reservation details.",
        },
      ],
    },
    {
      key: "reports",
      title: "Reports & Day Closing",
      items: [
        {
          id: "report-mismatch",
          title: "Daily report numbers do not match expected totals",
          symptoms:
            "Book sales, recorded sales, or variance percentages appear unexpectedly high/low.",
          steps: [
            "Check filter range (from/to date, fuel type, pump).",
            "Confirm opening and closing readings are entered for active tanks.",
            "Review deliveries entered for selected period.",
            "Inspect missing nozzle transaction warning in Exceptions.",
            "Run refresh and verify no pending offline sync exists.",
          ],
          linksToRoutes: [{ label: "Reports", to: "/reports" }],
          escalateText: "If this persists, report issue with screenshot and selected filters.",
        },
      ],
    },
    {
      key: "staff",
      title: "Staff & Shifts",
      items: [
        {
          id: "shift-open-close",
          title: "Shift open/close readings are inconsistent",
          symptoms:
            "Opening/closing values appear missing, duplicated, or saved against wrong tank row.",
          steps: [
            "Ensure correct row/tank is selected before saving reading.",
            "Re-enter opening/closing values once to overwrite for the day.",
            "Confirm manager account has required permissions.",
            "Refresh report snapshot and check reconciliation values.",
            "Capture timestamp and operator name for audit trail.",
          ],
          linksToRoutes: [
            { label: "Reports", to: "/reports" },
            { label: "Settings", to: "/settings" },
          ],
          escalateText: "If this persists, report issue with screenshot and shift details.",
        },
      ],
    },
    {
      key: "offline",
      title: "Offline Mode & Sync",
      items: [
        {
          id: "offline-procedure",
          title: "Internet is down - safe offline procedure",
          symptoms:
            "Status shows OFFLINE and actions may queue for later sync.",
          steps: [
            "Continue recording sales, deliveries, and shift readings normally.",
            "Watch pending count in status chip and avoid duplicate manual retries.",
            "Do not clear browser storage while offline.",
            "When online returns, wait for SYNCING to finish.",
            "Verify reports/transactions after pending count reaches zero.",
          ],
          linksToRoutes: [
            { label: "Transactions Test", to: "/transactions-test" },
            { label: "Reports", to: "/reports" },
          ],
          escalateText: "If sync does not clear, report issue with screenshot of pending count.",
        },
      ],
    },
  ],
  scenarios: [
    {
      id: "scenario-sale-not-reflecting",
      title: "Fuel is selling but not reflecting in SmartLink",
      checklist: [
        "Confirm ONLINE/OFFLINE state and pending count.",
        "Check Transactions Test for latest entries.",
        "Refresh Reports snapshot for the same date range.",
        "Verify nozzle mapping under Settings.",
      ],
      linksToRoutes: [
        { label: "Transactions Test", to: "/transactions-test" },
        { label: "Reports", to: "/reports" },
        { label: "Settings", to: "/settings" },
      ],
    },
    {
      id: "scenario-power-off",
      title: "Power went off during operation",
      checklist: [
        "Restore power and confirm station systems are stable.",
        "Check pump/nozzle state in Digital Queue and Settings.",
        "Record any missed manual sales from shift notes.",
        "Reconcile opening/closing readings in Reports.",
      ],
      linksToRoutes: [
        { label: "Digital Queue", to: "/digitalQueue" },
        { label: "Reports", to: "/reports" },
      ],
    },
    {
      id: "scenario-no-internet",
      title: "Internet is down",
      checklist: [
        "Continue operations; SmartLink will queue supported actions.",
        "Avoid duplicate submissions while waiting for reconnect.",
        "Monitor pending count until it reaches zero after reconnect.",
        "Refresh reports to confirm data alignment.",
      ],
      linksToRoutes: [{ label: "Reports", to: "/reports" }],
    },
    {
      id: "scenario-pump-offline-dispensing",
      title: "Pump shows offline but it is dispensing",
      checklist: [
        "Check if pump/nozzle was manually paused.",
        "Refresh queue snapshot and compare status.",
        "Run a controlled test transaction to validate mapping.",
        "Escalate with pump ID and screenshot if still wrong.",
      ],
      linksToRoutes: [
        { label: "Digital Queue", to: "/digitalQueue" },
        { label: "Settings", to: "/settings" },
      ],
    },
    {
      id: "scenario-report-mismatch",
      title: "Daily report numbers do not match",
      checklist: [
        "Verify report filters and date range.",
        "Confirm opening/closing readings are complete.",
        "Confirm deliveries were saved to correct tanks.",
        "Review exceptions warnings and missing nozzle count.",
      ],
      linksToRoutes: [{ label: "Reports", to: "/reports" }],
    },
    {
      id: "scenario-delivery-mismatch",
      title: "Delivery recorded but stock did not change",
      checklist: [
        "Validate tank row used for delivery entry.",
        "Refresh snapshot and wait for sync if pending exists.",
        "Re-enter delivery with clear supplier reference.",
        "Escalate with tank name and time of entry.",
      ],
      linksToRoutes: [{ label: "Reports", to: "/reports" }],
    },
  ],
}

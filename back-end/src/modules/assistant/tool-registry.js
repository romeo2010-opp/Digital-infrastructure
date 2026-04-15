export const ASSISTANT_TOOL_IDS = Object.freeze({
  GUIDED_FUEL_REQUEST: "guided_fuel_request",
  EXPLAIN_QUEUE: "explain_queue",
  EXPLAIN_RESERVATION: "explain_reservation",
  COMPARE_QUEUE_RESERVATION: "compare_queue_reservation",
  FIND_FUEL_NEARBY: "find_fuel_nearby",
  JOIN_FASTEST_QUEUE: "join_fastest_queue",
  MAKE_RESERVATION: "make_reservation",
  CHECK_BOOKING: "check_booking",
  CANCEL_BOOKING: "cancel_booking",
  WALLET_HELP: "wallet_help",
  WALLET_SUMMARY: "wallet_summary",
})

export const ASSISTANT_ACTION_IDS = Object.freeze({
  RESET: "assistant.reset",
  CHOOSE_BOOKING_MODE: "assistant.choose_booking_mode",
  CHOOSE_FUEL_TYPE: "assistant.choose_fuel_type",
  CHOOSE_STATION: "assistant.choose_station",
  CHOOSE_LITRES: "assistant.choose_litres",
  CHOOSE_SLOT: "assistant.choose_slot",
  CHOOSE_CANCEL_TARGET: "assistant.choose_cancel_target",
  CONTINUE: "assistant.continue",
})

export function listAssistantTools() {
  return Object.values(ASSISTANT_TOOL_IDS)
}

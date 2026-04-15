export const SMARTLINK_USER_ALERT_EVENT = "smartlink:user-alert";

export function emitSmartlinkUserAlert(alertPayload = {}) {
  if (typeof window === "undefined" || typeof window.dispatchEvent !== "function") {
    return;
  }

  window.dispatchEvent(
    new CustomEvent(SMARTLINK_USER_ALERT_EVENT, {
      detail: alertPayload,
    }),
  );
}

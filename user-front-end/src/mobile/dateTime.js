export const APP_TIME_ZONE =
  import.meta.env.VITE_APP_TIME_ZONE || "Africa/Blantyre";

export const APP_TIME_OPTIONS = Object.freeze({
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export const APP_DATE_OPTIONS = Object.freeze({
  year: "numeric",
  month: "short",
  day: "2-digit",
});

export const APP_DATE_TIME_OPTIONS = Object.freeze({
  weekday: "short",
  day: "2-digit",
  month: "short",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

function toDate(value) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function withTimeZone(options = {}) {
  return {
    ...options,
    timeZone: APP_TIME_ZONE,
  };
}

export function formatDate(value, options = APP_DATE_OPTIONS, fallback = "-") {
  const date = toDate(value);
  if (!date) return fallback;
  try {
    return date.toLocaleDateString(undefined, withTimeZone(options));
  } catch {
    return date.toLocaleDateString(undefined, {
      timeZone: "Africa/Blantyre",
      ...options,
    });
  }
}

export function formatDateTime(value, options = APP_DATE_TIME_OPTIONS, fallback = "-") {
  const date = toDate(value);
  if (!date) return fallback;
  try {
    return date.toLocaleString(undefined, withTimeZone(options));
  } catch {
    return date.toLocaleString(undefined, {
      timeZone: "Africa/Blantyre",
      ...options,
    });
  }
}

export function formatTime(value, options = APP_TIME_OPTIONS, fallback = "-") {
  const date = toDate(value);
  if (!date) return fallback;
  try {
    return date.toLocaleTimeString(undefined, withTimeZone(options));
  } catch {
    return date.toLocaleTimeString(undefined, {
      timeZone: "Africa/Blantyre",
      ...options,
    });
  }
}

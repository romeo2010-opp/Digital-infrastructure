from datetime import datetime, timezone


SECONDS_PER_HOUR = 60 * 60


def _get(source, *keys, default=None):
    if not isinstance(source, dict):
        return default
    for key in keys:
        if key in source:
            return source.get(key)
    return default


def _as_number(value, default=0.0):
    if isinstance(value, bool):
        return default
    if isinstance(value, (int, float)):
        return float(value)
    if isinstance(value, str):
        try:
            return float(value.replace(",", "").strip())
        except ValueError:
            return default
    return default


def _round2(value):
    return round(float(value), 2)


def _parse_iso(timestamp):
    if not isinstance(timestamp, str) or not timestamp.strip():
        return None
    value = timestamp.strip()
    if value.endswith("Z"):
        value = f"{value[:-1]}+00:00"
    try:
        parsed = datetime.fromisoformat(value)
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def _hours_until(timestamp, now):
    parsed = _parse_iso(timestamp)
    if parsed is None:
        return None
    return (parsed - now).total_seconds() / SECONDS_PER_HOUR


def _within_next_hours(timestamp, now, hours):
    delta = _hours_until(timestamp, now)
    return delta is not None and 0 <= delta <= hours


def _fuel_type(value):
    return str(value or "fuel").strip().upper() or "FUEL"


def _status(value):
    return str(value or "").strip().lower()


def _tank_pct(tank):
    capacity = _as_number(_get(tank, "capacity_litres", "capacityLitres"))
    current = _as_number(_get(tank, "current_litres", "currentLitres"))
    if capacity <= 0:
        return None
    return (current / capacity) * 100


def _alert(severity, category, title, description):
    return {
        "severity": severity,
        "category": category,
        "title": title,
        "description": description,
    }


def _percent_change(current, previous):
    current = _as_number(current)
    previous = _as_number(previous)
    if previous == 0:
        if current == 0:
            return 0.0
        return 100.0 if current > 0 else -100.0
    return _round2(((current - previous) / previous) * 100)


def calculate_absence_hours(last_login_at: str) -> float:
    parsed = _parse_iso(last_login_at)
    if parsed is None:
        return 0.0
    hours = (datetime.now(timezone.utc) - parsed).total_seconds() / SECONDS_PER_HOUR
    return _round2(max(0.0, hours))


def calculate_deltas(sales: dict) -> dict:
    return {
        "revenue_change_pct": _percent_change(
            _get(sales, "total_revenue_mwk", "totalRevenueMWK"),
            _get(sales, "previous_day_revenue_mwk", "previousDayRevenueMWK"),
        ),
        "litres_change_pct": _percent_change(
            _get(sales, "total_litres", "totalLitres"),
            _get(sales, "previous_day_litres", "previousDayLitres"),
        ),
    }


def run_rules(station_data: dict) -> list[dict]:
    now = datetime.now(timezone.utc)
    alerts = []
    tanks = _get(station_data, "tanks", default=[]) or []
    pumps = _get(station_data, "pumps", default=[]) or []
    queue = _get(station_data, "queue", default={}) or {}
    sales = _get(station_data, "sales", default={}) or {}
    deliveries = _get(station_data, "deliveries", default=[]) or []

    for tank in tanks:
        pct = _tank_pct(tank)
        if pct is None:
            continue
        tank_id = _get(tank, "id", default="tank")
        fuel_type = _fuel_type(_get(tank, "fuel_type", "fuelType"))
        resupply_at = _get(tank, "resupply_scheduled_at", "resupplyScheduledAt")
        has_resupply_within_6_hours = _within_next_hours(resupply_at, now, 6)

        if pct < 10:
            alerts.append(
                _alert(
                    "critical",
                    "tanks",
                    f"{fuel_type} tank is critically low",
                    f"Tank {tank_id} is below 10% capacity at {_round2(pct)}%.",
                )
            )

        if pct < 15 and not has_resupply_within_6_hours:
            alerts.append(
                _alert(
                    "critical",
                    "tanks",
                    f"{fuel_type} tank needs urgent resupply",
                    f"Tank {tank_id} is at {_round2(pct)}% capacity with no resupply within 6 hours.",
                )
            )

        if pct < 25:
            alerts.append(
                _alert(
                    "warning",
                    "tanks",
                    f"{fuel_type} tank is running low",
                    f"Tank {tank_id} is below 25% capacity at {_round2(pct)}%.",
                )
            )

    for pump in pumps:
        pump_id = _get(pump, "id", default="pump")
        label = _get(pump, "label", default=pump_id)
        if _status(_get(pump, "status")) == "offline":
            alerts.append(
                _alert(
                    "critical",
                    "pumps",
                    f"{label} is offline",
                    f"Pump {pump_id} is offline and should be restored or isolated.",
                )
            )

        fault_events = _as_number(_get(pump, "fault_events", "faultEvents", "faultEventsCount"))
        if fault_events >= 3:
            alerts.append(
                _alert(
                    "warning",
                    "pumps",
                    f"{label} has repeated faults",
                    f"Pump {pump_id} recorded {int(fault_events)} fault events.",
                )
            )

    drop_offs = _as_number(_get(queue, "drop_offs", "dropOffs"))
    if drop_offs > 10:
        alerts.append(
            _alert(
                "warning",
                "queue",
                "Queue drop-offs are elevated",
                f"{int(drop_offs)} drivers dropped off before service.",
            )
        )

    avg_wait = _as_number(_get(queue, "avg_wait_minutes", "avgWaitMinutes"))
    target_wait = _as_number(_get(queue, "target_wait_minutes", "targetWaitMinutes"))
    wait_delta = avg_wait - target_wait
    if wait_delta > 5:
        alerts.append(
            _alert(
                "warning",
                "queue",
                "Queue wait time is above target",
                f"Average wait time is {_round2(wait_delta)} minutes above target.",
            )
        )

    for delivery in deliveries:
        if _status(_get(delivery, "status")) != "confirmed":
            continue
        scheduled_at = _get(delivery, "scheduled_at", "scheduledAt")
        if _within_next_hours(scheduled_at, now, 12):
            fuel_type = _fuel_type(_get(delivery, "fuel_type", "fuelType"))
            estimated_litres = _as_number(_get(delivery, "estimated_litres", "estimatedLitres"))
            alerts.append(
                _alert(
                    "info",
                    "deliveries",
                    f"{fuel_type} delivery is scheduled soon",
                    f"{_round2(estimated_litres)} litres are confirmed within 12 hours.",
                )
            )

    deltas = calculate_deltas(sales)
    if deltas["revenue_change_pct"] > 5:
        alerts.append(
            _alert(
                "success",
                "sales",
                "Revenue is up versus previous day",
                f"Revenue increased by {deltas['revenue_change_pct']}% versus the previous day.",
            )
        )

    return alerts


def select_insight(alerts, sales, queue) -> dict:
    critical = next((alert for alert in alerts if alert.get("severity") == "critical"), None)
    warning = next(
        (
            alert
            for alert in alerts
            if alert.get("severity") == "warning" and alert.get("category") != "queue"
        ),
        None,
    )
    queue_warning = next(
        (
            alert
            for alert in alerts
            if alert.get("severity") == "warning" and alert.get("category") == "queue"
        ),
        None,
    )
    positive = next(
        (alert for alert in alerts if alert.get("severity") in {"success", "info"}),
        None,
    )

    avg_wait = _as_number(_get(queue, "avg_wait_minutes", "avgWaitMinutes"))
    target_wait = _as_number(_get(queue, "target_wait_minutes", "targetWaitMinutes"))
    wait_delta = avg_wait - target_wait
    drop_offs = _as_number(_get(queue, "drop_offs", "dropOffs"))

    if critical:
        return {
            "priority": f"Act now: {critical.get('title', 'critical alert').lower()}.",
            "note": critical.get("description") or "A critical station issue needs immediate attention.",
        }

    if warning:
        return {
            "priority": f"Address warning: {warning.get('title', 'station warning').lower()}.",
            "note": warning.get("description") or "A station warning needs attention today.",
        }

    if queue_warning:
        return {
            "priority": f"Reduce queue pressure: {queue_warning.get('title', 'queue issue').lower()}.",
            "note": queue_warning.get("description") or "Queue conditions may be costing sales.",
        }

    if drop_offs > 0 or wait_delta > 0:
        return {
            "priority": "Monitor queue flow before it becomes a revenue leak.",
            "note": f"Queue waits are {_round2(wait_delta)} minutes versus target with {int(drop_offs)} drop-offs.",
        }

    if positive:
        return {
            "priority": f"Maintain momentum: {positive.get('title', 'positive trend').lower()}.",
            "note": positive.get("description") or "A positive station trend is visible in the data.",
        }

    deltas = calculate_deltas(sales)
    if deltas["revenue_change_pct"] > 0:
        return {
            "priority": "Maintain today's revenue trend.",
            "note": f"Revenue is up {deltas['revenue_change_pct']}% versus the previous day.",
        }

    return {
        "priority": "Keep monitoring station operations and maintain the current service rhythm.",
        "note": "No urgent operational issue stands out from the supplied data.",
    }

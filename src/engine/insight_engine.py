import argparse
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path

import data_fetcher
import rules_engine


GROQ_MODEL = "llama-3.1-8b-instant"
DEFAULT_GROQ_TIMEOUT_SECONDS = 10


def _utc_now_iso():
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")


def _log_error(message):
    print(f"[{_utc_now_iso()}] ERROR {message}", file=sys.stderr)


def _env_float(name, default):
    try:
        value = float(os.getenv(name, default))
    except (TypeError, ValueError):
        return float(default)
    return max(0.0, value)


def _load_environment():
    try:
        from dotenv import load_dotenv
    except Exception as exc:
        _log_error(f"python-dotenv unavailable: {exc}")
        return

    try:
        load_dotenv()
        repo_env = Path(__file__).resolve().parents[2] / ".env"
        if repo_env.exists():
            load_dotenv(dotenv_path=repo_env, override=False)
    except Exception as exc:
        _log_error(f"Failed to load .env: {exc}")


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
        return value
    if isinstance(value, str):
        try:
            return float(value.replace(",", "").strip())
        except ValueError:
            return default
    return default


def _round2(value):
    return round(float(value), 2)


def _strip_markdown_fences(content):
    value = str(content or "").strip()
    value = re.sub(r"^```(?:json)?\s*", "", value, flags=re.IGNORECASE)
    value = re.sub(r"\s*```$", "", value)
    return value.strip()


def _json_from_content(content):
    cleaned = _strip_markdown_fences(content)
    if not cleaned.startswith("{"):
        start = cleaned.find("{")
        end = cleaned.rfind("}")
        if start >= 0 and end > start:
            cleaned = cleaned[start : end + 1]
    return json.loads(cleaned)


def _string_or_none(value):
    if value is None:
        return None
    value = str(value).strip()
    return value or None


def _normalize_sales(raw_sales):
    deltas = rules_engine.calculate_deltas(raw_sales)
    by_fuel_type = []
    for row in _get(raw_sales, "by_fuel_type", "byFuelType", default=[]) or []:
        by_fuel_type.append(
            {
                "fuel_type": _get(row, "fuel_type", "fuelType"),
                "litres": _as_number(_get(row, "litres")),
                "revenue_mwk": _as_number(_get(row, "revenue_mwk", "revenueMWK"), default=None),
            }
        )

    return {
        "total_revenue_mwk": _as_number(_get(raw_sales, "total_revenue_mwk", "totalRevenueMWK")),
        "total_litres": _as_number(_get(raw_sales, "total_litres", "totalLitres")),
        "transaction_count": int(_as_number(_get(raw_sales, "transaction_count", "transactionCount"))),
        "revenue_change_pct": deltas["revenue_change_pct"],
        "litres_change_pct": deltas["litres_change_pct"],
        "by_fuel_type": by_fuel_type,
    }


def _normalize_queue(raw_queue):
    peak_hours = []
    for row in _get(raw_queue, "peak_hours", "peakHours", default=[]) or []:
        peak_hours.append(
            {
                "hour": _get(row, "hour"),
                "vehicle_count": int(_as_number(_get(row, "vehicle_count", "vehicleCount"))),
            }
        )

    return {
        "drivers_served": int(_as_number(_get(raw_queue, "drivers_served", "driversServed"))),
        "avg_wait_minutes": _as_number(_get(raw_queue, "avg_wait_minutes", "avgWaitMinutes")),
        "target_wait_minutes": _as_number(_get(raw_queue, "target_wait_minutes", "targetWaitMinutes")),
        "drop_offs": int(_as_number(_get(raw_queue, "drop_offs", "dropOffs"))),
        "peak_hours": peak_hours,
    }


def _tank_pct(tank):
    capacity = _as_number(_get(tank, "capacity_litres", "capacityLitres"))
    current = _as_number(_get(tank, "current_litres", "currentLitres"))
    if capacity <= 0:
        return None
    return _round2((current / capacity) * 100)


def _tank_levels(station_data):
    levels = []
    for tank in _get(station_data, "tanks", default=[]) or []:
        levels.append(
            {
                "fuel_type": _get(tank, "fuel_type", "fuelType"),
                "pct_remaining": _tank_pct(tank),
            }
        )
    return levels


def _safe_ai_advice(reason):
    return {
        "recommendations": [],
        "market_opportunity": None,
        "risk_flag": f"AI revenue advice unavailable: {reason}",
    }


def _normalize_ai_advice(parsed):
    if not isinstance(parsed, dict):
        raise ValueError("Groq advice response was not a JSON object")

    recommendations = []
    raw_recommendations = parsed.get("recommendations")
    if isinstance(raw_recommendations, list):
        for recommendation in raw_recommendations[:3]:
            if not isinstance(recommendation, dict):
                continue
            recommendations.append(
                {
                    "title": str(recommendation.get("title") or "Revenue recommendation").strip(),
                    "reasoning": str(recommendation.get("reasoning") or "").strip(),
                    "action": str(recommendation.get("action") or "").strip(),
                    "revenue_impact": str(recommendation.get("revenue_impact") or "unknown").strip(),
                }
            )

    return {
        "recommendations": recommendations,
        "market_opportunity": _string_or_none(parsed.get("market_opportunity")),
        "risk_flag": _string_or_none(parsed.get("risk_flag")),
    }


def _generate_ai_advice(payload):
    _load_environment()
    try:
        from groq import Groq
    except Exception as exc:
        raise RuntimeError(f"Groq SDK unavailable: {exc}") from exc

    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        raise RuntimeError("GROQ_API_KEY is not set")

    system_prompt = """You are SmartLink AI, a revenue advisor for fuel stations in Malawi.
Analyse the station data and market intelligence provided.
Give 2-3 specific, actionable recommendations to increase revenue today.
Ground every recommendation in the actual numbers given.
Reference MWK pricing and local Malawi fuel market context.
Treat Facebook and local news snippets as market signals only; do not present them as official pump prices unless the market data includes verified numeric MWK values.
Return ONLY valid JSON. No markdown. No preamble.
Schema:
{
  recommendations: [
    {
      title: string,
      reasoning: string (one sentence, data-driven),
      action: string (one sentence, specific and actionable),
      revenue_impact: string (estimated MWK or 'unknown')
    }
  ],
  market_opportunity: string | null,
  risk_flag: string | null
}"""

    client = Groq(
        api_key=api_key,
        timeout=_env_float("SMARTLINK_GROQ_TIMEOUT_SECONDS", DEFAULT_GROQ_TIMEOUT_SECONDS),
    )
    response = client.chat.completions.create(
        model=GROQ_MODEL,
        messages=[
            {"role": "system", "content": system_prompt},
            {"role": "user", "content": json.dumps(payload, ensure_ascii=True)},
        ],
        temperature=0.2,
    )
    content = response.choices[0].message.content
    return _normalize_ai_advice(_json_from_content(content))


def _ai_payload(station_data, absence_hours, alerts, sales, queue, market_data):
    return {
        "station_name": _get(station_data, "station_name", "stationName"),
        "absence_hours": absence_hours,
        "alerts": [
            {"severity": alert.get("severity"), "title": alert.get("title")}
            for alert in alerts
        ],
        "sales": sales,
        "queue": queue,
        "tank_levels": _tank_levels(station_data),
        "market_data": market_data,
    }


def generate_briefing(station_data: dict) -> dict:
    raw_sales = _get(station_data, "sales", default={}) or {}
    raw_queue = _get(station_data, "queue", default={}) or {}

    alerts = rules_engine.run_rules(station_data)
    market_data = data_fetcher.fetch_market_intelligence()
    absence_hours = rules_engine.calculate_absence_hours(
        _get(station_data, "last_login_at", "lastLoginAt")
    )
    sales = _normalize_sales(raw_sales)
    queue = _normalize_queue(raw_queue)
    insight = rules_engine.select_insight(alerts, sales, queue)

    payload = _ai_payload(station_data, absence_hours, alerts, sales, queue, market_data)
    try:
        ai_advice = _generate_ai_advice(payload)
    except Exception as exc:
        _log_error(f"Groq revenue advice failed: {exc}")
        ai_advice = _safe_ai_advice(str(exc))

    return {
        "generated_at": _utc_now_iso(),
        "absence_hours": absence_hours,
        "alerts": alerts,
        "sales": sales,
        "queue": queue,
        "market": market_data,
        "insight": insight,
        "ai_advice": ai_advice,
    }


def _read_station_data(path):
    try:
        return json.loads(Path(path).read_text(encoding="utf-8"))
    except Exception as exc:
        _log_error(f"Failed to read station data from {path}: {exc}")
        raise


def _severity_counts(alerts):
    counts = {"critical": 0, "warning": 0, "info": 0, "success": 0}
    for alert in alerts:
        severity = alert.get("severity")
        if severity in counts:
            counts[severity] += 1
    return counts


def _print_summary(briefing):
    counts = _severity_counts(briefing.get("alerts", []))
    recommendations = _get(briefing, "ai_advice", default={}).get("recommendations") or []
    top_recommendation = recommendations[0].get("title") if recommendations else "None"
    sales = briefing.get("sales") or {}

    print(
        "Alerts by severity: "
        f"critical={counts['critical']} "
        f"warning={counts['warning']} "
        f"info={counts['info']} "
        f"success={counts['success']}",
        file=sys.stderr,
    )
    print(f"Top priority action: {briefing.get('insight', {}).get('priority')}", file=sys.stderr)
    print(f"Top AI recommendation: {top_recommendation}", file=sys.stderr)
    print(
        "Total revenue: "
        f"{sales.get('total_revenue_mwk')} MWK "
        f"({sales.get('revenue_change_pct')}% vs previous day)",
        file=sys.stderr,
    )


def main(argv=None):
    parser = argparse.ArgumentParser(description="Generate a SmartLink station briefing.")
    parser.add_argument("--station-data", required=True, help="Path to station snapshot JSON.")
    parser.add_argument("--output", help="Optional path to write briefing JSON.")
    args = parser.parse_args(argv)

    try:
        station_data = _read_station_data(args.station_data)
        briefing = generate_briefing(station_data)
    except Exception:
        return 1

    output = json.dumps(briefing, indent=2, ensure_ascii=True)
    if args.output:
        try:
            Path(args.output).write_text(f"{output}\n", encoding="utf-8")
        except Exception as exc:
            _log_error(f"Failed to write briefing output to {args.output}: {exc}")
            return 1
        _print_summary(briefing)
    else:
        print(output)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())

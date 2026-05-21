from __future__ import annotations

import pandas as pd

from app.schemas import PredictionInput


FEATURE_COLUMNS = [
    "station_id",
    "district",
    "fuel_type",
    "hour_of_day",
    "day_of_week",
    "is_weekend",
    "is_payday_week",
    "is_rainy",
    "nearby_shortage_index",
    "current_queue_length",
    "active_pumps",
    "active_nozzles",
    "avg_service_time_sec_15m",
    "arrivals_last_15m",
    "departures_last_15m",
    "reservations_next_30m",
    "walk_in_ratio",
    "stock_litres",
    "delivery_eta_minutes",
    "pump_fault_count",
    "complaints_last_24h",
    "manual_overrides_last_24h",
]

TARGET_COLUMNS = [
    "queue_length_30m",
    "wait_time_minutes",
    "stockout_minutes",
    "congestion_level",
]

CATEGORICAL_COLUMNS = ["station_id", "district", "fuel_type"]
NUMERIC_COLUMNS = [column for column in FEATURE_COLUMNS if column not in CATEGORICAL_COLUMNS]


def _as_dict(payload: PredictionInput) -> dict:
    if hasattr(payload, "model_dump"):
        return payload.model_dump()
    return payload.dict()


def build_feature_frame(
    payload: PredictionInput,
    feature_columns: list[str] | None = None,
) -> pd.DataFrame:
    columns = feature_columns or FEATURE_COLUMNS
    row = _as_dict(payload)
    ordered = {column: row.get(column) for column in columns}
    return pd.DataFrame([ordered], columns=columns)

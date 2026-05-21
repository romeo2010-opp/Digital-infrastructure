from __future__ import annotations

import math
import os
from contextlib import asynccontextmanager
from typing import Any

from fastapi import FastAPI, HTTPException

from app.feature_builder import build_feature_frame
from app.model_loader import ModelNotReadyError, get_model_bundle, load_model_bundle
from app.schemas import PredictionInput, PredictionOutput


def startup_load_model() -> None:
    if os.getenv("SMARTLINK_ML_SKIP_STARTUP_LOAD", "").lower() in {"1", "true", "yes"}:
        return
    load_model_bundle(required=True)


@asynccontextmanager
async def lifespan(_app: FastAPI):
    startup_load_model()
    yield


app = FastAPI(
    title="SmartLink ML Operations Service",
    version="1.0.0",
    description="Operational ML predictions for SmartLink station queues, wait times, stockout risk, and congestion.",
    lifespan=lifespan,
)


def _predict_scalar(model: Any, frame) -> Any:
    prediction = model.predict(frame)
    return prediction[0]


def _metric(bundle: dict[str, Any], model_key: str, metric_name: str) -> float | None:
    value = bundle.get("metrics", {}).get(model_key, {}).get(metric_name)
    try:
        numeric = float(value)
    except (TypeError, ValueError):
        return None
    return numeric if math.isfinite(numeric) else None


def _wait_time_range(wait_minutes: float, bundle: dict[str, Any]) -> str:
    mae = _metric(bundle, "wait_time_minutes_model", "mae")
    margin = mae if mae is not None else max(5.0, wait_minutes * 0.15)
    lower = max(0.0, wait_minutes - margin)
    upper = max(lower, wait_minutes + margin)
    return f"{lower:.1f}-{upper:.1f} minutes"


def _stockout_risk(stockout_minutes: float) -> str:
    if stockout_minutes < 60:
        return "CRITICAL"
    if stockout_minutes < 180:
        return "HIGH"
    if stockout_minutes < 360:
        return "MEDIUM"
    return "LOW"


def _inputs_are_extreme(payload: PredictionInput) -> bool:
    return any(
        [
            payload.current_queue_length > 120,
            payload.arrivals_last_15m > 80,
            payload.reservations_next_30m > 80,
            payload.avg_service_time_sec_15m > 600,
            payload.nearby_shortage_index > 0.97,
            payload.stock_litres < 250,
            payload.active_pumps == 0,
            payload.active_nozzles == 0,
            payload.pump_fault_count >= 5,
        ]
    )


def _metrics_are_strong(bundle: dict[str, Any]) -> bool:
    regression_r2 = [
        _metric(bundle, "queue_length_30m_model", "r2"),
        _metric(bundle, "wait_time_minutes_model", "r2"),
        _metric(bundle, "stockout_minutes_model", "r2"),
    ]
    classifier_macro_f1 = _metric(bundle, "congestion_level_model", "macro_f1")
    return all(value is not None and value >= 0.70 for value in regression_r2) and (
        classifier_macro_f1 is not None and classifier_macro_f1 >= 0.75
    )


def _metrics_are_acceptable(bundle: dict[str, Any]) -> bool:
    regression_r2 = [
        _metric(bundle, "queue_length_30m_model", "r2"),
        _metric(bundle, "wait_time_minutes_model", "r2"),
        _metric(bundle, "stockout_minutes_model", "r2"),
    ]
    classifier_macro_f1 = _metric(bundle, "congestion_level_model", "macro_f1")
    return all(value is not None and value >= 0.45 for value in regression_r2) and (
        classifier_macro_f1 is not None and classifier_macro_f1 >= 0.55
    )


def _confidence(payload: PredictionInput, bundle: dict[str, Any]) -> str:
    if _inputs_are_extreme(payload):
        return "LOW"
    if _metrics_are_strong(bundle):
        return "HIGH"
    if _metrics_are_acceptable(bundle):
        return "MEDIUM"
    return "LOW"


def _recommendation(congestion_level: str, stockout_risk: str, queue_length: int, stockout_minutes: float) -> str:
    if stockout_risk == "CRITICAL":
        return "Stop accepting digital queue bookings and notify MERA dashboard."
    if congestion_level == "CRITICAL":
        return "Pause new reservations, redirect users to nearby stations, and alert station manager."
    if queue_length >= 45 and stockout_minutes >= 360:
        return "Increase active pump capacity or open an additional service lane."
    if congestion_level == "HIGH":
        return "Limit new reservations, monitor arrivals closely, and prioritize pump availability."
    if stockout_risk == "HIGH":
        return "Prepare replenishment escalation and reduce non-essential queue commitments."
    return "Continue monitoring queue movement and maintain current service capacity."


def _mera_summary(congestion_level: str, stockout_risk: str, queue_length: int) -> str:
    if stockout_risk in {"CRITICAL", "HIGH"}:
        return "Stockout risk is high based on current sales and queue pressure."
    if congestion_level in {"CRITICAL", "HIGH"}:
        return "Operational pressure is elevated and requires review."
    if queue_length >= 35:
        return "Queue pressure may require inspection prioritization if repeated."
    return "Operational indicators are within normal monitoring range."


def _station_manager_summary(congestion_level: str, stockout_risk: str, wait_minutes: float) -> str:
    if stockout_risk == "CRITICAL":
        return "Stockout risk is critical. Pause bookings and escalate replenishment now."
    if wait_minutes >= 45 or congestion_level in {"HIGH", "CRITICAL"}:
        return "Expected wait time is high. Add attendants or pause bookings."
    if stockout_risk == "HIGH":
        return "Fuel stock pressure is high. Prepare a delivery follow-up and manage queue intake."
    return "Service levels look manageable. Keep pumps staffed and monitor arrivals."


@app.get("/health")
def health() -> dict[str, Any]:
    bundle = load_model_bundle(required=False)
    return {
        "status": "healthy",
        "model_loaded": bundle is not None,
        "model_version": bundle.get("model_version") if bundle else None,
    }


@app.get("/metadata")
def metadata() -> dict[str, Any]:
    try:
        bundle = get_model_bundle()
    except ModelNotReadyError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    return {
        "feature_columns": bundle.get("feature_columns", []),
        "target_columns": bundle.get("target_columns", []),
        "metrics": bundle.get("metrics", {}),
    }


@app.post("/predict", response_model=PredictionOutput)
def predict(payload: PredictionInput) -> PredictionOutput:
    try:
        bundle = get_model_bundle()
    except ModelNotReadyError as error:
        raise HTTPException(status_code=503, detail=str(error)) from error

    frame = build_feature_frame(payload, bundle.get("feature_columns"))

    queue_length = max(0, int(round(float(_predict_scalar(bundle["queue_length_30m_model"], frame)))))
    wait_minutes = max(0.0, round(float(_predict_scalar(bundle["wait_time_minutes_model"], frame)), 1))
    stockout_minutes = max(0.0, round(float(_predict_scalar(bundle["stockout_minutes_model"], frame)), 1))
    congestion_level = str(_predict_scalar(bundle["congestion_level_model"], frame)).upper()
    if congestion_level not in {"LOW", "MEDIUM", "HIGH", "CRITICAL"}:
        congestion_level = "CRITICAL" if queue_length >= 70 or stockout_minutes < 60 else "MEDIUM"

    stockout_risk = _stockout_risk(stockout_minutes)
    confidence = _confidence(payload, bundle)

    return PredictionOutput(
        queue_length_30m=queue_length,
        wait_time_minutes=wait_minutes,
        wait_time_range=_wait_time_range(wait_minutes, bundle),
        stockout_minutes=stockout_minutes,
        stockout_risk=stockout_risk,
        congestion_level=congestion_level,
        confidence=confidence,
        operational_recommendation=_recommendation(
            congestion_level,
            stockout_risk,
            queue_length,
            stockout_minutes,
        ),
        mera_summary=_mera_summary(congestion_level, stockout_risk, queue_length),
        station_manager_summary=_station_manager_summary(congestion_level, stockout_risk, wait_minutes),
    )

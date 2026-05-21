import asyncio
import json
import sys
from pathlib import Path

import joblib
import numpy as np
import pytest

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.feature_builder import FEATURE_COLUMNS, TARGET_COLUMNS
from app.model_loader import reset_model_cache


class ConstantRegressor:
    def __init__(self, value):
        self.value = value

    def predict(self, frame):
        return np.full(len(frame), self.value)


class ConstantClassifier:
    def __init__(self, value):
        self.value = value

    def predict(self, frame):
        return np.array([self.value for _ in range(len(frame))])


@pytest.fixture()
def api_app(tmp_path, monkeypatch):
    model_path = tmp_path / "smartlink_ops_models.joblib"
    bundle = {
        "model_version": "test-v1",
        "trained_at": "2026-01-01T00:00:00+00:00",
        "feature_columns": FEATURE_COLUMNS,
        "target_columns": TARGET_COLUMNS,
        "queue_length_30m_model": ConstantRegressor(48),
        "wait_time_minutes_model": ConstantRegressor(42.0),
        "stockout_minutes_model": ConstantRegressor(240.0),
        "congestion_level_model": ConstantClassifier("HIGH"),
        "metrics": {
            "queue_length_30m_model": {"mae": 4.0, "rmse": 6.0, "r2": 0.86},
            "wait_time_minutes_model": {"mae": 7.0, "rmse": 9.0, "r2": 0.81},
            "stockout_minutes_model": {"mae": 35.0, "rmse": 45.0, "r2": 0.88},
            "congestion_level_model": {"accuracy": 0.84, "macro_f1": 0.82, "classification_report": {}},
        },
    }
    joblib.dump(bundle, model_path)
    monkeypatch.setenv("MODEL_PATH", str(model_path))
    reset_model_cache()

    from app.main import app, startup_load_model

    startup_load_model()
    yield app

    reset_model_cache()


async def _asgi_request(app, method, path, payload=None):
    body = json.dumps(payload).encode("utf-8") if payload is not None else b""
    sent = False
    messages = []

    async def receive():
        nonlocal sent
        if sent:
            return {"type": "http.disconnect"}
        sent = True
        return {"type": "http.request", "body": body, "more_body": False}

    async def send(message):
        messages.append(message)

    await app(
        {
            "type": "http",
            "asgi": {"version": "3.0"},
            "http_version": "1.1",
            "method": method,
            "scheme": "http",
            "path": path,
            "raw_path": path.encode("ascii"),
            "query_string": b"",
            "headers": [(b"content-type", b"application/json")],
            "client": ("testclient", 50000),
            "server": ("testserver", 80),
        },
        receive,
        send,
    )

    status = 500
    response_body = b""
    for message in messages:
        if message["type"] == "http.response.start":
            status = message["status"]
        elif message["type"] == "http.response.body":
            response_body += message.get("body", b"")
    return status, json.loads(response_body.decode("utf-8") or "{}")


def asgi_request(app, method, path, payload=None):
    return asyncio.run(_asgi_request(app, method, path, payload))


def sample_payload(overrides=None):
    payload = {
        "station_id": "01J5SMARTLINKBLANTYRE00001",
        "district": "Blantyre",
        "fuel_type": "PETROL",
        "hour_of_day": 17,
        "day_of_week": 5,
        "is_weekend": True,
        "is_payday_week": False,
        "is_rainy": False,
        "nearby_shortage_index": 0.82,
        "current_queue_length": 38,
        "active_pumps": 2,
        "active_nozzles": 2,
        "avg_service_time_sec_15m": 260,
        "arrivals_last_15m": 22,
        "departures_last_15m": 7,
        "reservations_next_30m": 18,
        "walk_in_ratio": 0.72,
        "stock_litres": 4800,
        "delivery_eta_minutes": 240,
        "pump_fault_count": 1,
        "complaints_last_24h": 9,
        "manual_overrides_last_24h": 4,
    }
    if overrides:
        payload.update(overrides)
    return payload


def test_health(api_app):
    status, body = asgi_request(api_app, "GET", "/health")
    assert status == 200
    assert body == {
        "status": "healthy",
        "model_loaded": True,
        "model_version": "test-v1",
    }


def test_predict_with_sample_payload(api_app):
    status, body = asgi_request(api_app, "POST", "/predict", sample_payload())
    assert status == 200
    assert body["queue_length_30m"] == 48
    assert body["wait_time_minutes"] == 42.0
    assert body["wait_time_range"] == "35.0-49.0 minutes"
    assert body["stockout_risk"] == "MEDIUM"
    assert body["congestion_level"] == "HIGH"


def test_validation_rejects_invalid_hour_of_day(api_app):
    status, _body = asgi_request(api_app, "POST", "/predict", sample_payload({"hour_of_day": 24}))
    assert status == 422


def test_prediction_output_contains_all_required_fields(api_app):
    status, body = asgi_request(api_app, "POST", "/predict", sample_payload())
    assert status == 200
    assert set(body.keys()) == {
        "queue_length_30m",
        "wait_time_minutes",
        "wait_time_range",
        "stockout_minutes",
        "stockout_risk",
        "congestion_level",
        "confidence",
        "operational_recommendation",
        "mera_summary",
        "station_manager_summary",
    }

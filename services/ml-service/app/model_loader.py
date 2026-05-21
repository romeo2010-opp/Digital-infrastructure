from __future__ import annotations

import os
from pathlib import Path
from typing import Any

import joblib


DEFAULT_MODEL_PATH = Path(__file__).resolve().parents[1] / "models" / "smartlink_ops_models.joblib"
REQUIRED_BUNDLE_KEYS = {
    "model_version",
    "trained_at",
    "feature_columns",
    "target_columns",
    "queue_length_30m_model",
    "wait_time_minutes_model",
    "stockout_minutes_model",
    "congestion_level_model",
    "metrics",
}

_MODEL_CACHE: dict[str, Any] | None = None
_MODEL_CACHE_PATH: Path | None = None


class ModelNotReadyError(RuntimeError):
    """Raised when the service starts before model training has produced a bundle."""


def resolve_model_path() -> Path:
    configured = os.getenv("MODEL_PATH", "").strip()
    return Path(configured).expanduser() if configured else DEFAULT_MODEL_PATH


def validate_bundle(bundle: dict[str, Any]) -> None:
    missing = sorted(REQUIRED_BUNDLE_KEYS - set(bundle.keys()))
    if missing:
        raise ModelNotReadyError(
            "SmartLink ML model bundle is incomplete. "
            f"Missing keys: {', '.join(missing)}. Re-run scripts/train_models.py."
        )


def load_model_bundle(required: bool = True) -> dict[str, Any] | None:
    global _MODEL_CACHE, _MODEL_CACHE_PATH

    model_path = resolve_model_path()
    if _MODEL_CACHE is not None and _MODEL_CACHE_PATH == model_path:
        return _MODEL_CACHE

    if not model_path.exists():
        if not required:
            return None
        raise ModelNotReadyError(
            "SmartLink ML model bundle was not found at "
            f"{model_path}. Run: python scripts/train_models.py --data data/synthetic_queue_training.csv"
        )

    bundle = joblib.load(model_path)
    if not isinstance(bundle, dict):
        raise ModelNotReadyError(
            "SmartLink ML model bundle is invalid. Expected a dictionary bundle. "
            "Re-run scripts/train_models.py."
        )

    validate_bundle(bundle)
    _MODEL_CACHE = bundle
    _MODEL_CACHE_PATH = model_path
    return bundle


def get_model_bundle() -> dict[str, Any]:
    bundle = load_model_bundle(required=True)
    if bundle is None:
        raise ModelNotReadyError("SmartLink ML model bundle is not loaded.")
    return bundle


def reset_model_cache() -> None:
    global _MODEL_CACHE, _MODEL_CACHE_PATH
    _MODEL_CACHE = None
    _MODEL_CACHE_PATH = None

from __future__ import annotations

import argparse
import json
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier, RandomForestRegressor
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    classification_report,
    f1_score,
    mean_absolute_error,
    mean_squared_error,
    r2_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder

ROOT_DIR = Path(__file__).resolve().parents[1]
if str(ROOT_DIR) not in sys.path:
    sys.path.insert(0, str(ROOT_DIR))

from app.feature_builder import CATEGORICAL_COLUMNS, FEATURE_COLUMNS, NUMERIC_COLUMNS, TARGET_COLUMNS  # noqa: E402


DEFAULT_MODEL_PATH = ROOT_DIR / "models" / "smartlink_ops_models.joblib"
DEFAULT_METRICS_PATH = ROOT_DIR / "models" / "metrics.json"
MODEL_VERSION = "smartlink-ops-v1"
BOOLEAN_COLUMNS = ["is_weekend", "is_payday_week", "is_rainy"]


def _one_hot_encoder() -> OneHotEncoder:
    try:
        return OneHotEncoder(handle_unknown="ignore", sparse_output=False)
    except TypeError:
        return OneHotEncoder(handle_unknown="ignore", sparse=False)


def build_preprocessor() -> ColumnTransformer:
    categorical_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="most_frequent")),
            ("onehot", _one_hot_encoder()),
        ]
    )
    numeric_pipeline = Pipeline(
        steps=[
            ("imputer", SimpleImputer(strategy="median")),
        ]
    )
    return ColumnTransformer(
        transformers=[
            ("categorical", categorical_pipeline, CATEGORICAL_COLUMNS),
            ("numeric", numeric_pipeline, NUMERIC_COLUMNS),
        ]
    )


def _normalize_bool(value: Any) -> int:
    if isinstance(value, bool):
        return int(value)
    normalized = str(value).strip().lower()
    return int(normalized in {"1", "true", "yes", "y"})


def load_training_dataframe(path: Path) -> pd.DataFrame:
    frame = pd.read_csv(path)
    validate_required_columns(frame)
    for column in BOOLEAN_COLUMNS:
        frame[column] = frame[column].map(_normalize_bool).astype(int)
    for column in NUMERIC_COLUMNS:
        frame[column] = pd.to_numeric(frame[column], errors="coerce")
    return frame


def validate_required_columns(frame: pd.DataFrame) -> None:
    required = set(FEATURE_COLUMNS + TARGET_COLUMNS)
    missing = sorted(required - set(frame.columns))
    if missing:
        raise ValueError(f"Training data is missing required columns: {', '.join(missing)}")


def build_regression_pipeline(random_state: int = 42) -> Pipeline:
    return Pipeline(
        steps=[
            ("preprocess", build_preprocessor()),
            (
                "model",
                RandomForestRegressor(
                    n_estimators=180,
                    min_samples_leaf=2,
                    random_state=random_state,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def build_classification_pipeline(random_state: int = 42) -> Pipeline:
    return Pipeline(
        steps=[
            ("preprocess", build_preprocessor()),
            (
                "model",
                RandomForestClassifier(
                    n_estimators=220,
                    min_samples_leaf=2,
                    class_weight="balanced",
                    random_state=random_state,
                    n_jobs=-1,
                ),
            ),
        ]
    )


def evaluate_regression(y_true: pd.Series, y_pred: np.ndarray) -> dict[str, float]:
    rmse = float(np.sqrt(mean_squared_error(y_true, y_pred)))
    return {
        "mae": float(mean_absolute_error(y_true, y_pred)),
        "rmse": rmse,
        "r2": float(r2_score(y_true, y_pred)),
    }


def evaluate_classification(y_true: pd.Series, y_pred: np.ndarray) -> dict[str, Any]:
    return {
        "accuracy": float(accuracy_score(y_true, y_pred)),
        "macro_f1": float(f1_score(y_true, y_pred, average="macro", zero_division=0)),
        "classification_report": classification_report(y_true, y_pred, zero_division=0, output_dict=True),
        "classification_report_text": classification_report(y_true, y_pred, zero_division=0),
    }


def _json_default(value: Any) -> Any:
    if isinstance(value, np.integer):
        return int(value)
    if isinstance(value, np.floating):
        return float(value)
    if isinstance(value, np.ndarray):
        return value.tolist()
    raise TypeError(f"Object of type {type(value).__name__} is not JSON serializable")


def train_models(data_path: Path, model_path: Path = DEFAULT_MODEL_PATH, metrics_path: Path = DEFAULT_METRICS_PATH) -> dict[str, Any]:
    frame = load_training_dataframe(data_path)
    x = frame[FEATURE_COLUMNS]
    y = frame[TARGET_COLUMNS]

    x_train, x_test, y_train, y_test = train_test_split(
        x,
        y,
        test_size=0.2,
        random_state=42,
    )

    models = {
        "queue_length_30m_model": build_regression_pipeline(),
        "wait_time_minutes_model": build_regression_pipeline(),
        "stockout_minutes_model": build_regression_pipeline(),
        "congestion_level_model": build_classification_pipeline(),
    }

    models["queue_length_30m_model"].fit(x_train, y_train["queue_length_30m"])
    models["wait_time_minutes_model"].fit(x_train, y_train["wait_time_minutes"])
    models["stockout_minutes_model"].fit(x_train, y_train["stockout_minutes"])
    models["congestion_level_model"].fit(x_train, y_train["congestion_level"])

    metrics = {
        "queue_length_30m_model": evaluate_regression(
            y_test["queue_length_30m"],
            models["queue_length_30m_model"].predict(x_test),
        ),
        "wait_time_minutes_model": evaluate_regression(
            y_test["wait_time_minutes"],
            models["wait_time_minutes_model"].predict(x_test),
        ),
        "stockout_minutes_model": evaluate_regression(
            y_test["stockout_minutes"],
            models["stockout_minutes_model"].predict(x_test),
        ),
        "congestion_level_model": evaluate_classification(
            y_test["congestion_level"],
            models["congestion_level_model"].predict(x_test),
        ),
    }

    bundle = {
        "model_version": MODEL_VERSION,
        "trained_at": datetime.now(timezone.utc).isoformat(),
        "feature_columns": FEATURE_COLUMNS,
        "target_columns": TARGET_COLUMNS,
        "queue_length_30m_model": models["queue_length_30m_model"],
        "wait_time_minutes_model": models["wait_time_minutes_model"],
        "stockout_minutes_model": models["stockout_minutes_model"],
        "congestion_level_model": models["congestion_level_model"],
        "metrics": metrics,
    }

    model_path.parent.mkdir(parents=True, exist_ok=True)
    joblib.dump(bundle, model_path, compress=3)
    with metrics_path.open("w", encoding="utf-8") as handle:
        json.dump(metrics, handle, indent=2, default=_json_default)

    return bundle


def print_metrics(metrics: dict[str, Any]) -> None:
    for model_key, values in metrics.items():
        print(f"\n{model_key}")
        if "mae" in values:
            print(f"  MAE:  {values['mae']:.3f}")
            print(f"  RMSE: {values['rmse']:.3f}")
            print(f"  R2:   {values['r2']:.3f}")
        else:
            print(f"  Accuracy: {values['accuracy']:.3f}")
            print(f"  Macro F1: {values['macro_f1']:.3f}")
            print(values["classification_report_text"])


def main() -> None:
    parser = argparse.ArgumentParser(description="Train SmartLink operational ML models.")
    parser.add_argument("--data", required=True, type=Path)
    args = parser.parse_args()

    bundle = train_models(args.data)
    print(f"Saved model bundle to {DEFAULT_MODEL_PATH}")
    print(f"Saved metrics to {DEFAULT_METRICS_PATH}")
    print_metrics(bundle["metrics"])


if __name__ == "__main__":
    main()

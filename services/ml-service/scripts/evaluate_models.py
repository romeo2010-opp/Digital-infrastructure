from __future__ import annotations

import argparse
import sys
from pathlib import Path

import joblib

from train_models import (
    DEFAULT_MODEL_PATH,
    FEATURE_COLUMNS,
    evaluate_classification,
    evaluate_regression,
    load_training_dataframe,
    print_metrics,
)


def evaluate(data_path: Path, model_path: Path = DEFAULT_MODEL_PATH) -> dict:
    if not model_path.exists():
        raise FileNotFoundError(
            f"Model file is missing at {model_path}. Run scripts/train_models.py before evaluation."
        )

    bundle = joblib.load(model_path)
    frame = load_training_dataframe(data_path)
    x = frame[FEATURE_COLUMNS]
    metrics = {
        "queue_length_30m_model": evaluate_regression(
            frame["queue_length_30m"],
            bundle["queue_length_30m_model"].predict(x),
        ),
        "wait_time_minutes_model": evaluate_regression(
            frame["wait_time_minutes"],
            bundle["wait_time_minutes_model"].predict(x),
        ),
        "stockout_minutes_model": evaluate_regression(
            frame["stockout_minutes"],
            bundle["stockout_minutes_model"].predict(x),
        ),
        "congestion_level_model": evaluate_classification(
            frame["congestion_level"],
            bundle["congestion_level_model"].predict(x),
        ),
    }
    return metrics


def main() -> None:
    parser = argparse.ArgumentParser(description="Evaluate saved SmartLink operational ML models.")
    parser.add_argument("--data", required=True, type=Path)
    parser.add_argument("--model", type=Path, default=DEFAULT_MODEL_PATH)
    args = parser.parse_args()

    try:
        metrics = evaluate(args.data, args.model)
    except FileNotFoundError as error:
        print(f"ERROR: {error}", file=sys.stderr)
        raise SystemExit(1) from error

    print(f"Evaluated model bundle: {args.model}")
    print(f"Evaluation data: {args.data}")
    print_metrics(metrics)


if __name__ == "__main__":
    main()

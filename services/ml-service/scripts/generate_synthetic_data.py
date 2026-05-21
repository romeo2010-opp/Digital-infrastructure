from __future__ import annotations

import argparse
from pathlib import Path

import numpy as np
import pandas as pd


RANDOM_SEED = 42
DEFAULT_OUT = Path(__file__).resolve().parents[1] / "data" / "synthetic_queue_training.csv"

STATIONS = [
    {"station_id": "01J5SMARTLINKBLANTYRE00001", "district": "Blantyre", "base_pumps": 3, "capacity": 32000},
    {"station_id": "01J6SLBTY00000000000000001", "district": "Blantyre", "base_pumps": 3, "capacity": 28000},
    {"station_id": "01J6SLBTY00000000000000002", "district": "Blantyre", "base_pumps": 4, "capacity": 36000},
    {"station_id": "01J6SLBTY00000000000000004", "district": "Blantyre", "base_pumps": 2, "capacity": 24000},
    {"station_id": "OSM-MW-FUEL-N-476605568", "district": "Blantyre", "base_pumps": 2, "capacity": 26000},
    {"station_id": "SL-MA-BLNT-9089", "district": "Blantyre", "base_pumps": 2, "capacity": 22000},
    {"station_id": "SL-MW-LLWE-7882", "district": "Lilongwe", "base_pumps": 4, "capacity": 38000},
    {"station_id": "OSM-MW-FUEL-N-11324758269", "district": "Lilongwe", "base_pumps": 3, "capacity": 34000},
    {"station_id": "OSM-MW-FUEL-W-815461961", "district": "Lilongwe", "base_pumps": 3, "capacity": 33000},
    {"station_id": "SL-MW-RUMP-3013", "district": "Rumphi", "base_pumps": 2, "capacity": 26000},
    {"station_id": "OSM-MW-FUEL-N-4031717241", "district": "Rumphi", "base_pumps": 2, "capacity": 24000},
    {"station_id": "OSM-MW-FUEL-N-4849594393", "district": "Zalewa", "base_pumps": 2, "capacity": 26000},
    {"station_id": "OSM-MW-FUEL-N-2567672403", "district": "Nchalo", "base_pumps": 2, "capacity": 25000},
]


def _peak_multiplier(hour: int) -> float:
    if 6 <= hour <= 8:
        return 1.45
    if 16 <= hour <= 20:
        return 1.75
    if 11 <= hour <= 14:
        return 1.20
    if hour >= 21 or hour <= 4:
        return 0.55
    return 1.0


def _congestion_level(score: float) -> str:
    if score >= 95:
        return "CRITICAL"
    if score >= 62:
        return "HIGH"
    if score >= 34:
        return "MEDIUM"
    return "LOW"


def generate(rows: int = 5000) -> pd.DataFrame:
    rng = np.random.default_rng(RANDOM_SEED)
    records: list[dict] = []

    for _ in range(rows):
        station = STATIONS[int(rng.integers(0, len(STATIONS)))]
        fuel_type = "PETROL" if rng.random() < 0.72 else "DIESEL"
        hour = int(rng.choice(np.arange(24), p=_hour_distribution()))
        day_of_week = int(rng.integers(0, 7))
        is_weekend = day_of_week in {5, 6}
        is_payday_week = bool(rng.random() < 0.22)
        is_rainy = bool(rng.random() < 0.18)

        peak = _peak_multiplier(hour)
        nearby_shortage_index = float(np.clip(rng.beta(2.2, 3.8) + (0.18 if is_payday_week else 0), 0, 1))
        base_pressure = (
            peak
            + nearby_shortage_index * 1.45
            + (0.28 if is_weekend else 0)
            + (0.35 if is_payday_week else 0)
            + (0.18 if is_rainy else 0)
        )

        pump_fault_count = int(rng.poisson(0.25 + max(0, nearby_shortage_index - 0.6) * 1.6))
        active_pumps = int(max(0, station["base_pumps"] - min(pump_fault_count, station["base_pumps"])))
        if rng.random() < 0.04:
            active_pumps = max(0, active_pumps - 1)
        active_nozzles = int(max(0, active_pumps + rng.integers(-1, 2)))

        avg_service_time = float(
            np.clip(
                rng.normal(185 + base_pressure * 28 + pump_fault_count * 18 + (18 if is_rainy else 0), 22),
                120,
                520,
            )
        )

        arrivals_last_15m = int(max(0, rng.poisson(4 + base_pressure * 6.8)))
        service_capacity_15m = active_nozzles * (900 / max(avg_service_time, 1))
        departures_last_15m = int(max(0, rng.normal(service_capacity_15m * 0.88, 1.6)))
        reservations_next_30m = int(max(0, rng.poisson(1.5 + base_pressure * 4.2 + (2.5 if is_payday_week else 0))))
        current_queue_length = int(
            max(
                0,
                rng.normal(
                    3 + arrivals_last_15m * 1.35 + reservations_next_30m * 0.65
                    + nearby_shortage_index * 18 - departures_last_15m * 1.15
                    - active_nozzles * 1.6,
                    5.0,
                ),
            )
        )

        walk_in_ratio = float(np.clip(rng.normal(0.62 + nearby_shortage_index * 0.22, 0.08), 0.25, 0.98))
        stock_pressure = nearby_shortage_index * 0.36 + base_pressure * 0.09 + (0.12 if is_payday_week else 0)
        stock_fraction = float(np.clip(rng.beta(4.0, 2.2) - stock_pressure, 0.03, 0.98))
        stock_litres = float(max(100, station["capacity"] * stock_fraction * (0.9 if fuel_type == "DIESEL" else 1.0)))
        delivery_eta_minutes = float(
            np.clip(
                rng.normal(420 - (0.6 - stock_fraction) * 260 + nearby_shortage_index * 110, 80),
                30,
                900,
            )
        )

        complaints_last_24h = int(max(0, rng.poisson(0.35 + current_queue_length / 18 + nearby_shortage_index * 2.2)))
        manual_overrides_last_24h = int(max(0, rng.poisson(0.1 + pump_fault_count * 0.7 + complaints_last_24h * 0.16)))

        expected_arrivals_30m = arrivals_last_15m * (1.7 + nearby_shortage_index * 0.35)
        expected_departures_30m = departures_last_15m * (1.85 + active_nozzles * 0.05)
        queue_length_30m = int(
            round(
                max(
                    0,
                    current_queue_length
                    + expected_arrivals_30m
                    + reservations_next_30m * 0.72
                    - expected_departures_30m
                    + nearby_shortage_index * 5.5
                    + pump_fault_count * 3.2
                    + rng.normal(0, 2.2),
                )
            )
        )

        throughput_per_minute = active_nozzles * 60 / max(avg_service_time, 1)
        if throughput_per_minute <= 0:
            wait_time_minutes = 180 + current_queue_length * 2.5
        else:
            wait_time_minutes = (
                current_queue_length / throughput_per_minute
                + queue_length_30m * 0.35
                + pump_fault_count * 8
                + nearby_shortage_index * 8
            )
        wait_time_minutes = float(round(max(1, wait_time_minutes + rng.normal(0, 3.0)), 1))

        avg_litres_per_vehicle = 24 if fuel_type == "PETROL" else 31
        demand_vehicles_30m = current_queue_length * 0.35 + arrivals_last_15m * 2 + reservations_next_30m
        burn_lpm = max(0.15, demand_vehicles_30m * avg_litres_per_vehicle / 30)
        burn_lpm *= 1 + nearby_shortage_index * 0.35 + (0.15 if is_payday_week else 0)
        stockout_minutes = float(round(np.clip(stock_litres / burn_lpm + rng.normal(0, 18), 20, 2400), 1))

        congestion_score = (
            queue_length_30m
            + wait_time_minutes * 0.45
            + nearby_shortage_index * 26
            + max(0, 360 - stockout_minutes) * 0.09
            + pump_fault_count * 8
            + complaints_last_24h * 1.4
            + manual_overrides_last_24h * 1.1
        )
        congestion_level = _congestion_level(congestion_score)

        records.append(
            {
                "station_id": station["station_id"],
                "district": station["district"],
                "fuel_type": fuel_type,
                "hour_of_day": hour,
                "day_of_week": day_of_week,
                "is_weekend": is_weekend,
                "is_payday_week": is_payday_week,
                "is_rainy": is_rainy,
                "nearby_shortage_index": round(nearby_shortage_index, 3),
                "current_queue_length": current_queue_length,
                "active_pumps": active_pumps,
                "active_nozzles": active_nozzles,
                "avg_service_time_sec_15m": round(avg_service_time, 1),
                "arrivals_last_15m": arrivals_last_15m,
                "departures_last_15m": departures_last_15m,
                "reservations_next_30m": reservations_next_30m,
                "walk_in_ratio": round(walk_in_ratio, 3),
                "stock_litres": round(stock_litres, 1),
                "delivery_eta_minutes": round(delivery_eta_minutes, 1),
                "pump_fault_count": pump_fault_count,
                "complaints_last_24h": complaints_last_24h,
                "manual_overrides_last_24h": manual_overrides_last_24h,
                "queue_length_30m": queue_length_30m,
                "wait_time_minutes": wait_time_minutes,
                "stockout_minutes": stockout_minutes,
                "congestion_level": congestion_level,
            }
        )

    return pd.DataFrame.from_records(records)


def _hour_distribution() -> np.ndarray:
    weights = np.array(
        [
            0.018, 0.014, 0.010, 0.010, 0.014, 0.026,
            0.060, 0.070, 0.055, 0.040, 0.036, 0.040,
            0.050, 0.048, 0.040, 0.044, 0.070, 0.085,
            0.085, 0.070, 0.052, 0.038, 0.025, 0.020,
        ],
        dtype=float,
    )
    return weights / weights.sum()


def main() -> None:
    parser = argparse.ArgumentParser(description="Generate synthetic SmartLink queue training data.")
    parser.add_argument("--rows", type=int, default=5000)
    parser.add_argument("--out", type=Path, default=DEFAULT_OUT)
    args = parser.parse_args()

    if args.rows <= 0:
        raise SystemExit("--rows must be greater than 0")

    frame = generate(args.rows)
    args.out.parent.mkdir(parents=True, exist_ok=True)
    frame.to_csv(args.out, index=False)
    print(f"Wrote {len(frame)} rows to {args.out}")


if __name__ == "__main__":
    main()

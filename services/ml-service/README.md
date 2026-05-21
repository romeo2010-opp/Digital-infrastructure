# SmartLink ML Operations Service

FastAPI microservice for SmartLink operational predictions:

- Queue length in 30 minutes
- Estimated driver wait time
- Fuel stockout time
- Congestion level: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`

The service uses `stations.public_id` as `station_id` and keeps ML outside the Node/Express backend.

## Local setup

```bash
cd services/ml-service
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Generate training data

```bash
python scripts/generate_synthetic_data.py --rows 5000 --out data/synthetic_queue_training.csv
```

## Train

```bash
python scripts/train_models.py --data data/synthetic_queue_training.csv
```

## Evaluate

```bash
python scripts/evaluate_models.py --data data/synthetic_queue_training.csv
```

## Run API

```bash
uvicorn app.main:app --reload --port 8001
```

## Docker

Train first so `models/smartlink_ops_models.joblib` exists, then run:

```bash
docker compose up --build
```

## Test prediction

```bash
curl -X POST http://localhost:8001/predict \
  -H "Content-Type: application/json" \
  -d '{
    "station_id": "01J5SMARTLINKBLANTYRE00001",
    "district": "Blantyre",
    "fuel_type": "PETROL",
    "hour_of_day": 17,
    "day_of_week": 5,
    "is_weekend": true,
    "is_payday_week": false,
    "is_rainy": false,
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
    "manual_overrides_last_24h": 4
  }'
```

## Backend integration

The Node backend calls this service through:

```text
GET /api/stations/:stationPublicId/insights/ops-prediction?fuelType=PETROL
```

Configure:

```text
ML_SERVICE_URL=http://localhost:8001
ML_SERVICE_TIMEOUT_MS=2500
```

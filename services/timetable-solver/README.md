# SmartLink Schools Timetable Solver

Internal FastAPI service for SmartLink Schools timetable generation. It uses Google OR-Tools CP-SAT and is called by the main Node backend with normalized school-scoped payloads.

## Run Locally

```bash
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
TIMETABLE_SOLVER_INTERNAL_TOKEN=dev-timetable-solver-token uvicorn app.main:app --host 127.0.0.1 --port 7317
```

## Endpoints

- `GET /health`
- `POST /solve/school-timetable`
- `POST /solve/exam-timetable`
- `POST /solve/exam-room-allocation`
- `POST /solve/invigilation`
- `POST /solve/alternative-slots`
- `POST /intelligence/today`

All endpoints except `/health` require:

`Authorization: Bearer <TIMETABLE_SOLVER_INTERNAL_TOKEN>`

## Tests

```bash
pytest
```

## Responsibility Boundary

The solver does not read the SmartLink database. The Node backend authenticates users, enforces school tenancy and roles, loads data, maps rows into solver-safe payloads, revalidates results, persists drafts, writes audit events, and sends notifications.

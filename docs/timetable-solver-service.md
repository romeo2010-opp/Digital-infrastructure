# Timetable Solver Service

SmartLink Schools uses a dedicated Python service at `services/timetable-solver` for timetable optimization. The service is FastAPI plus Google OR-Tools CP-SAT.

The Node backend remains the source of truth for authentication, authorization, tenancy, database reads, audit logs, draft persistence, and notifications. The Python solver receives only normalized school-scoped payloads.

## Run

```bash
cd services/timetable-solver
python3 -m venv .venv
. .venv/bin/activate
pip install -r requirements.txt
TIMETABLE_SOLVER_INTERNAL_TOKEN=dev-timetable-solver-token uvicorn app.main:app --host 127.0.0.1 --port 7317
```

Backend `.env`:

```bash
TIMETABLE_SOLVER_URL=http://127.0.0.1:7317
TIMETABLE_SOLVER_INTERNAL_TOKEN=dev-timetable-solver-token
TIMETABLE_SOLVER_TIMEOUT_SECONDS=60
TIMETABLE_SOLVER_MAX_ALTERNATIVES=3
TIMETABLE_SOLVER_DEFAULT_TIME_LIMIT_SECONDS=20
```

## Endpoints

- `GET /health`
- `POST /solve/school-timetable`
- `POST /solve/exam-timetable`
- `POST /solve/exam-room-allocation`
- `POST /solve/invigilation`
- `POST /solve/alternative-slots`
- `POST /intelligence/today`

Every endpoint except `/health` requires `Authorization: Bearer <TIMETABLE_SOLVER_INTERNAL_TOKEN>`.

## Payload Boundary

The backend mappers convert SmartLink rows into stable solver IDs, slots, cycle days, curriculum requirements, availability rules, facilities, papers, candidate lists, and occupancy records. Passwords, tokens, private user details, and unrelated school rows are not sent.

## Curriculum Requirements

School timetable generation will not run until the school has active curriculum period requirements. Admins configure them from SmartLink Schools under `Settings -> Timetable Rules -> Curriculum Period Requirements`.

Backend APIs:

- `GET /api/scheduling/curriculum-requirements`
- `POST /api/scheduling/curriculum-requirements`
- `PATCH /api/scheduling/curriculum-requirements/:id`
- `POST /api/scheduling/curriculum-requirements/:id/archive`

Each requirement tells the solver the class or stream, subject, optional teacher, periods per cycle, block length, and any required room/laboratory rule.

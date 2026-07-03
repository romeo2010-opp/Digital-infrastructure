# Timetable Generation Troubleshooting

## Solver unavailable

Check the Python service:

```bash
cd services/timetable-solver
TIMETABLE_SOLVER_INTERNAL_TOKEN=dev-timetable-solver-token uvicorn app.main:app --host 127.0.0.1 --port 7317
curl http://127.0.0.1:7317/health
```

Then check the Node backend env values:

```bash
TIMETABLE_SOLVER_URL=http://127.0.0.1:7317
TIMETABLE_SOLVER_INTERNAL_TOKEN=dev-timetable-solver-token
```

## School generation says requirements are missing

Automatic school timetable generation requires rows in `curriculum_period_requirements`. Add requirements for class, subject, teacher, periods per cycle, block length, and specialist facility needs before running the solver.

In the UI, open `Settings -> Timetable Rules` and use `Curriculum Period Requirements`. The same data is available through `/api/scheduling/curriculum-requirements` for integrations or migration scripts.

## Infeasible school timetable

Common causes:

- A class requires more periods than usable slots.
- A teacher has too many required periods.
- A lab lesson requires a compatible lab but none is active.
- Weekly activities block too many teaching periods.
- Locked manual entries occupy required teacher/class/facility slots.

## Infeasible exam timetable

Common causes:

- Candidate papers are locked to the same window.
- Computer candidates exceed functional computer count.
- Practical papers have no compatible lab.
- Exam windows are shorter than paper duration.
- Normal timetable occupancy is protected while operating mode is `NORMAL_LESSONS_CONTINUE`.

## Job status

Generation jobs use meaningful stages: `PREPARING_INPUT`, `RUNNING_SOLVER`, `VALIDATING_RESULT`, `SAVING_DRAFT`, `COMPLETE`, `FAILED`, or `CANCELLED`. SmartLink does not show fake percentages.

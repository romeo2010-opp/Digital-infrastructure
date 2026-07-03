from fastapi import APIRouter, Depends

from app.auth import require_internal_token
from app.models.school_timetable import AlternativeSlotRequest, AlternativeSlotResponse, SchoolTimetableSolveRequest, SchoolTimetableSolveResponse
from app.solvers.alternative_slot_solver import solve_alternative_slots
from app.solvers.school_timetable_solver import solve_school_timetable

router = APIRouter(tags=["school-timetable"], dependencies=[Depends(require_internal_token)])


@router.post("/solve/school-timetable", response_model=SchoolTimetableSolveResponse)
async def solve_school(payload: SchoolTimetableSolveRequest) -> SchoolTimetableSolveResponse:
    return solve_school_timetable(payload)


@router.post("/solve/alternative-slots", response_model=AlternativeSlotResponse)
async def alternative_slots(payload: AlternativeSlotRequest) -> AlternativeSlotResponse:
    return solve_alternative_slots(payload)

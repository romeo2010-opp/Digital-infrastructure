from fastapi import APIRouter, Depends

from app.auth import require_internal_token
from app.models.exam_timetable import (
    ExamRoomAllocationRequest,
    ExamRoomAllocationResponse,
    ExamTimetableSolveRequest,
    ExamTimetableSolveResponse,
    InvigilationRequest,
    InvigilationResponse,
)
from app.solvers.exam_session_solver import solve_exam_timetable
from app.solvers.invigilation_solver import allocate_invigilators
from app.solvers.room_allocation_solver import allocate_exam_rooms

router = APIRouter(tags=["exam-timetable"], dependencies=[Depends(require_internal_token)])


@router.post("/solve/exam-timetable", response_model=ExamTimetableSolveResponse)
async def solve_exam(payload: ExamTimetableSolveRequest) -> ExamTimetableSolveResponse:
    return solve_exam_timetable(payload)


@router.post("/solve/exam-room-allocation", response_model=ExamRoomAllocationResponse)
async def exam_room_allocation(payload: ExamRoomAllocationRequest) -> ExamRoomAllocationResponse:
    return allocate_exam_rooms(payload)


@router.post("/solve/invigilation", response_model=InvigilationResponse)
async def invigilation(payload: InvigilationRequest) -> InvigilationResponse:
    return allocate_invigilators(payload)

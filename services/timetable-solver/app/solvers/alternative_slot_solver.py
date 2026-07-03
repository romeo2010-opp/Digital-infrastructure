from app.models.school_timetable import AlternativeSlotRequest, AlternativeSlotResponse
from app.solvers.school_timetable_solver import find_alternative_slots


def solve_alternative_slots(payload: AlternativeSlotRequest) -> AlternativeSlotResponse:
    return find_alternative_slots(payload)


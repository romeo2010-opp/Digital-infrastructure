from fastapi import FastAPI

from app.api import exam_timetable, health, school_timetable, today_intelligence
from app.config import get_settings
from app.logging_config import configure_logging


settings = get_settings()
configure_logging(settings.log_level)

app = FastAPI(
    title="SmartLink Schools Timetable Solver",
    version="1.0.0",
    description="Internal OR-Tools CP-SAT solver service for SmartLink Schools timetables.",
)

app.include_router(health.router)
app.include_router(school_timetable.router)
app.include_router(exam_timetable.router)
app.include_router(today_intelligence.router)


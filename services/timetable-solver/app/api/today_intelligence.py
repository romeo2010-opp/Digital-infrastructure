from fastapi import APIRouter, Depends

from app.auth import require_internal_token
from app.models.today import TodayIntelligenceRequest, TodayIntelligenceResponse
from app.solvers.today_intelligence_solver import compute_today_intelligence

router = APIRouter(tags=["today-intelligence"], dependencies=[Depends(require_internal_token)])


@router.post("/intelligence/today", response_model=TodayIntelligenceResponse)
async def today(payload: TodayIntelligenceRequest) -> TodayIntelligenceResponse:
    return compute_today_intelligence(payload)

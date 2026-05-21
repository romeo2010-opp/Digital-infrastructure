from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class PredictionInput(BaseModel):
    model_config = ConfigDict(extra="forbid")

    station_id: str = Field(..., min_length=1, max_length=64)
    district: str = Field(..., min_length=1, max_length=80)
    fuel_type: Literal["PETROL", "DIESEL"]
    hour_of_day: int = Field(..., ge=0, le=23)
    day_of_week: int = Field(..., ge=0, le=6)
    is_weekend: bool
    is_payday_week: bool
    is_rainy: bool
    nearby_shortage_index: float = Field(..., ge=0, le=1)
    current_queue_length: int = Field(..., ge=0)
    active_pumps: int = Field(..., ge=0)
    active_nozzles: int = Field(..., ge=0)
    avg_service_time_sec_15m: float = Field(..., ge=1)
    arrivals_last_15m: int = Field(..., ge=0)
    departures_last_15m: int = Field(..., ge=0)
    reservations_next_30m: int = Field(..., ge=0)
    walk_in_ratio: float = Field(..., ge=0, le=1)
    stock_litres: float = Field(..., ge=0)
    delivery_eta_minutes: float = Field(..., ge=0)
    pump_fault_count: int = Field(..., ge=0)
    complaints_last_24h: int = Field(..., ge=0)
    manual_overrides_last_24h: int = Field(..., ge=0)


class PredictionOutput(BaseModel):
    queue_length_30m: int
    wait_time_minutes: float
    wait_time_range: str
    stockout_minutes: float
    stockout_risk: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    congestion_level: Literal["LOW", "MEDIUM", "HIGH", "CRITICAL"]
    confidence: Literal["LOW", "MEDIUM", "HIGH"]
    operational_recommendation: str
    mera_summary: str
    station_manager_summary: str

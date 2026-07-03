from pydantic import BaseModel, Field

from app.models.common import OccupancyRecord


class OccupancySnapshot(BaseModel):
    schoolId: str
    records: list[OccupancyRecord] = Field(default_factory=list)


"""Data models for Flood Agent backend."""
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field


class AssessRequest(BaseModel):
    lat: float = Field(..., description="Latitude in decimal degrees", ge=-90.0, le=90.0)
    lon: float = Field(..., description="Longitude in decimal degrees", ge=-180.0, le=180.0)


class AssessResponse(BaseModel):
    risk_level: Literal["low", "medium", "high"] = Field(..., description="Assessed flood risk level")
    confidence: Literal["low", "medium", "high"] = Field(..., description="Confidence in assessment")
    summary: str = Field(..., description="Plain-language 2-sentence summary")
    reasons: list[str] = Field(default_factory=list, description="Evidence-based reasons")
    actions: list[str] = Field(default_factory=list, description="Recommended citizen actions")


class ReportCreate(BaseModel):
    lat: float = Field(..., description="Latitude in decimal degrees", ge=-90.0, le=90.0)
    lon: float = Field(..., description="Longitude in decimal degrees", ge=-180.0, le=180.0)
    water_depth: str = Field(
        default="ankle",
        description="Observed water depth, e.g., 'ankle', 'knee', 'waist', 'impassable'",
    )
    description: str = Field(
        default="",
        description="Optional additional details, road name, or observations",
    )
    reporter_name: str | None = Field(
        default="Anonymous Citizen",
        description="Optional name or alias of the reporter",
    )


class Report(BaseModel):
    id: str
    lat: float
    lon: float
    water_depth: str
    description: str
    reporter_name: str | None = "Anonymous Citizen"
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class ReportsResponse(BaseModel):
    count: int
    reports: list[Report]

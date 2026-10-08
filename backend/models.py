"""Data models for Flood Agent backend."""
from datetime import datetime, timezone
from typing import Literal
from pydantic import BaseModel, Field, field_validator


class AssessRequest(BaseModel):
    lat: float = Field(..., description="Latitude in decimal degrees", ge=-90.0, le=90.0)
    lon: float = Field(..., description="Longitude in decimal degrees", ge=-180.0, le=180.0)


class AssessResponse(BaseModel):
    risk_level: Literal["low", "medium", "high"] = Field(..., description="Assessed overall climate & water risk level")
    confidence: Literal["low", "medium", "high"] = Field(..., description="Confidence in assessment")
    summary: str = Field(..., description="Plain-language 2-sentence summary")
    reasons: list[str] = Field(default_factory=list, description="Evidence-based reasons")
    actions: list[str] = Field(default_factory=list, description="Recommended citizen actions")
    hazards: dict | None = Field(default=None, description="Disaggregated risk ratings for each climate/water hazard")
    telemetry: dict | None = Field(default=None, description="Detailed multi-sensor environmental and geospatial telemetry")

    @field_validator("risk_level", mode="before")
    @classmethod
    def clean_risk_level(cls, v):
        if isinstance(v, str):
            clean = v.strip().lower().replace('"', '').replace("'", "")
            if "high" in clean:
                return "high"
            if "med" in clean or "mod" in clean:
                return "medium"
            if "low" in clean:
                return "low"
        return "low"

    @field_validator("confidence", mode="before")
    @classmethod
    def clean_confidence(cls, v):
        if isinstance(v, str):
            clean = v.strip().lower().replace('"', '').replace("'", "")
            if "high" in clean:
                return "high"
            if "low" in clean:
                return "low"
            if "med" in clean or "mod" in clean:
                return "medium"
        return "medium"

    @field_validator("summary", mode="before")
    @classmethod
    def clean_summary(cls, v):
        return str(v).strip() if v is not None else ""


class ReportCreate(BaseModel):
    lat: float = Field(..., description="Latitude in decimal degrees", ge=-90.0, le=90.0)
    lon: float = Field(..., description="Longitude in decimal degrees", ge=-180.0, le=180.0)
    category: str = Field(
        default="flood_waterlogging",
        description="Hazard type: 'flood_waterlogging', 'pipe_leak', 'water_tanker', 'heatwave_alert'",
    )
    severity: str = Field(
        default="moderate",
        description="Severity level, e.g. 'ankle'/'knee'/'waist'/'impassable' (flood), 'minor_leak'/'burst_pipe' (leak), 'tanker_needed'/'tanker_arrived' (tanker), 'warning'/'critical' (heat)",
    )
    water_depth: str = Field(
        default="ankle",
        description="Legacy observed water depth for backward compatibility",
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
    category: str = "flood_waterlogging"
    severity: str = "moderate"
    water_depth: str = "ankle"
    description: str
    reporter_name: str | None = "Anonymous Citizen"
    created_at: str = Field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )


class ReportsResponse(BaseModel):
    count: int
    reports: list[Report]


"""FastAPI backend application for Flood Agent.

Exposes:
- POST /assess: runs the AI agent to evaluate worldwide flood risk
- POST /report: citizen submits a street-level waterlogging report
- GET /reports: lists recent reports, optionally filtered by distance
- GET /health: health check endpoint
"""
from contextlib import asynccontextmanager
import os
from pathlib import Path
import sys

from dotenv import find_dotenv, load_dotenv

# Ensure environment variables are loaded
load_dotenv(find_dotenv(usecwd=True))
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

# Ensure agent and backend modules are discoverable regardless of working directory
backend_path = str(Path(__file__).resolve().parent)
if backend_path not in sys.path:
    sys.path.insert(0, backend_path)

agent_path = str(Path(__file__).resolve().parent.parent / "agent")
if agent_path not in sys.path:
    sys.path.insert(0, agent_path)

from fastapi import Depends, FastAPI, HTTPException, Query, status
from fastapi.middleware.cors import CORSMiddleware

from models import AssessRequest, AssessResponse, Report, ReportCreate, ReportsResponse
from storage import BaseStorage, get_storage

# Import agent assess function
try:
    from agent import assess as run_agent_assessment
except ImportError as err:
    run_agent_assessment = None
    print(f"Warning: Could not import agent.assess: {err}")


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Ensure storage is initialized
    _ = get_storage()
    yield


app = FastAPI(
    title="Flood Agent API",
    description="Worldwide AI agent for flood and waterlogging assessment",
    version="0.1.0",
    lifespan=lifespan,
)

# Enable CORS for frontend integration
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


@app.get("/health", tags=["system"])
def health_check(storage: BaseStorage = Depends(get_storage)):
    return {
        "status": "healthy",
        "service": "flood-agent-api",
        "storage_backend": storage.__class__.__name__,
    }


@app.post("/assess", response_model=AssessResponse, tags=["assessment"])
def assess_location(payload: AssessRequest):
    """Run the AI Flood Agent to assess flood & waterlogging risk for any coordinates."""
    if run_agent_assessment is None:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Flood agent engine is not initialized",
        )
    try:
        result = run_agent_assessment(payload.lat, payload.lon)
        return AssessResponse(**result)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Agent assessment failed: {str(exc)}",
        )


@app.post("/report", response_model=Report, status_code=status.HTTP_201_CREATED, tags=["reports"])
def submit_report(
    payload: ReportCreate,
    storage: BaseStorage = Depends(get_storage),
):
    """Submit a citizen street-level waterlogging report."""
    try:
        report = storage.save_report(payload)
        return report
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to save citizen report: {str(exc)}",
        )


@app.get("/reports", response_model=ReportsResponse, tags=["reports"])
def list_reports(
    lat: float | None = Query(None, description="Center latitude for distance filtering"),
    lon: float | None = Query(None, description="Center longitude for distance filtering"),
    radius_km: float = Query(5.0, description="Search radius in kilometers", ge=0.1, le=50.0),
    limit: int = Query(50, description="Maximum number of reports to return", ge=1, le=200),
    category: str | None = Query(None, description="Optional hazard category filter ('flood_waterlogging', 'pipe_leak', 'water_tanker', 'heatwave_alert')"),
    storage: BaseStorage = Depends(get_storage),
):
    """Retrieve citizen reports, optionally filtered by radius around (lat, lon) and category."""
    try:
        reports = storage.get_reports(
            lat=lat, lon=lon, radius_km=radius_km, limit=limit, category=category
        )
        return ReportsResponse(count=len(reports), reports=reports)
    except Exception as exc:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to query reports: {str(exc)}",
        )


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)

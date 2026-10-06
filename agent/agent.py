"""Flood risk agent. Usage:  python agent.py <lat> <lon>"""
import json
import os
import re
import sys
import time
from pathlib import Path
from dotenv import find_dotenv, load_dotenv

# Load environment variables from .env file
load_dotenv(find_dotenv(usecwd=True))
load_dotenv(Path(__file__).resolve().parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

agent_dir = str(Path(__file__).resolve().parent)
if agent_dir not in sys.path:
    sys.path.insert(0, agent_dir)

from strands import Agent
from config import ANTHROPIC_MODEL_ID, GEMINI_MODEL_ID
from tools import get_flood_risk, get_forecast, get_reports, get_terrain

SYSTEM_PROMPT = """You are a flood and waterlogging risk advisor for ANY location in the world.
Given a latitude and longitude, call ALL of your tools (forecast, flood risk, terrain, reports),
then combine the evidence into one assessment.

Rules:
- Base every claim on tool results. Never invent numbers.
- If a tool returns no data or an error, say so and lower your confidence.
- Citizen reports, when present, outweigh model data for local street-level conditions.
- Actions must be concrete, short, and safe for ordinary people (no technical jargon).

Respond with ONLY a JSON object, no markdown, in this exact shape:
{
  "risk_level": "low" | "medium" | "high",
  "confidence": "low" | "medium" | "high",
  "summary": "<2 sentences, plain language>",
  "reasons": ["<short evidence-based reason>", "..."],
  "actions": ["<action 1>", "<action 2>", "<action 3>"]
}"""


def build_agent() -> Agent:
    gemini_key = os.environ.get("GEMINI_API_KEY")
    anthropic_key = os.environ.get("ANTHROPIC_API_KEY")

    if gemini_key:
        from strands.models.gemini import GeminiModel
        model = GeminiModel(
            model_id=GEMINI_MODEL_ID,
            client_args={"api_key": gemini_key},
        )
    elif anthropic_key:
        from strands.models.anthropic import AnthropicModel
        model = AnthropicModel(
            model_id=ANTHROPIC_MODEL_ID,
            max_tokens=2048,
            client_args={"api_key": anthropic_key},
        )
    else:
        raise RuntimeError(
            "Neither GEMINI_API_KEY nor ANTHROPIC_API_KEY is set. "
            "Please add GEMINI_API_KEY or ANTHROPIC_API_KEY to your .env file."
        )

    return Agent(
        model=model,
        system_prompt=SYSTEM_PROMPT,
        tools=[get_forecast, get_flood_risk, get_terrain, get_reports],
    )


def _extract_json(text: str) -> dict:
    cleaned = re.sub(r"\x1b\[[0-9;]*[a-zA-Z]", "", text)
    code_block = re.search(r"```(?:json)?\s*(\{.*?\})\s*```", cleaned, re.DOTALL)
    if code_block:
        candidate = code_block.group(1)
    else:
        match = re.search(r"\{.*\}", cleaned, re.DOTALL)
        if not match:
            raise ValueError(f"Agent did not return JSON: {text[:200]}")
        candidate = match.group(0)

    try:
        raw_dict = json.loads(candidate, strict=False)
    except json.JSONDecodeError:
        # Strip trailing commas if any
        candidate_clean = re.sub(r",\s*([\]}])", r"\1", candidate)
        raw_dict = json.loads(candidate_clean, strict=False)

    return _sanitize_assessment(raw_dict)


def _sanitize_assessment(data: dict) -> dict:
    risk = str(data.get("risk_level", "low")).strip().lower()
    if "high" in risk:
        clean_risk = "high"
    elif "med" in risk or "mod" in risk:
        clean_risk = "medium"
    else:
        clean_risk = "low"

    conf = str(data.get("confidence", "medium")).strip().lower()
    if "high" in conf:
        clean_conf = "high"
    elif "low" in conf:
        clean_conf = "low"
    else:
        clean_conf = "medium"

    summary = str(data.get("summary", "")).strip()
    reasons = [str(r).strip() for r in data.get("reasons", []) if str(r).strip()]
    actions = [str(a).strip() for a in data.get("actions", []) if str(a).strip()]
    telemetry = data.get("telemetry")

    res = {
        "risk_level": clean_risk,
        "confidence": clean_conf,
        "summary": summary,
        "reasons": reasons,
        "actions": actions,
    }
    if telemetry:
        res["telemetry"] = telemetry
    return res


def heuristic_assess(lat: float, lon: float) -> dict:
    """Deterministic fallback assessment when LLM service is throttled or offline.
    Directly evaluates the 4 live tools and produces structured risk intelligence.
    """
    forecast_data = get_forecast(lat, lon)
    flood_data = get_flood_risk(lat, lon)
    terrain_data = get_terrain(lat, lon)
    reports_data = get_reports(lat, lon)

    # 1. Rain analysis
    rain_days = forecast_data.get("rain_mm_per_day", [])
    max_daily_rain = max(rain_days) if rain_days else 0.0
    peak_hourly = forecast_data.get("peak_hourly_rain_mm") or 0.0
    prob = forecast_data.get("max_rain_probability_pct")
    max_prob = max(prob) if prob else 0

    # 2. Flood / River analysis
    peak_ratio = flood_data.get("peak_ratio_vs_normal") if flood_data.get("available") else 0.0

    # 3. Terrain analysis
    relative_elev = terrain_data.get("relative_to_surroundings_m", 0.0)
    sits_lower = terrain_data.get("sits_lower_than_surroundings", False) or relative_elev < -1.5

    # 4. Citizen reports analysis
    reps = reports_data.get("reports", [])
    high_water_reports = [r for r in reps if r.get("water_depth") in ("waist", "impassable")]
    knee_water_reports = [r for r in reps if r.get("water_depth") == "knee"]
    ankle_water_reports = [r for r in reps if r.get("water_depth") == "ankle"]

    reasons = []

    # Scoring
    risk_score = 0
    if high_water_reports:
        risk_score += 4
        reasons.append(f"{len(high_water_reports)} citizen report(s) confirm dangerous waist-deep or impassable waterlogging.")
    elif knee_water_reports:
        risk_score += 3
        reasons.append(f"{len(knee_water_reports)} citizen report(s) confirm knee-deep standing water.")
    elif ankle_water_reports:
        risk_score += 1
        reasons.append(f"{len(ankle_water_reports)} citizen report(s) note ankle-deep water accumulation.")

    if max_daily_rain >= 50 or peak_hourly >= 15:
        risk_score += 3
        reasons.append(f"Heavy rainfall forecast: up to {max_daily_rain:.1f} mm/day and {peak_hourly:.1f} mm/h peak intensity.")
    elif max_daily_rain >= 20 or peak_hourly >= 7:
        risk_score += 2
        reasons.append(f"Moderate rainfall forecast: {max_daily_rain:.1f} mm/day with {max_prob}% probability.")
    elif max_daily_rain > 0:
        reasons.append(f"Light or minimal rainfall projected ({max_daily_rain:.1f} mm/day max).")
    else:
        reasons.append("No significant precipitation forecast in the next 3 days.")

    if peak_ratio and peak_ratio >= 1.8:
        risk_score += 3
        reasons.append(f"River discharge forecast is {peak_ratio}x historical normal baseline, signaling major surge risk.")
    elif peak_ratio and peak_ratio >= 1.2:
        risk_score += 1
        reasons.append(f"River discharge is slightly elevated at {peak_ratio}x normal baseline.")
    elif flood_data.get("available"):
        reasons.append(f"Nearby river discharge is at normal baseline levels ({peak_ratio}x normal).")

    if sits_lower:
        risk_score += 1
        reasons.append(f"Local topography sits {abs(relative_elev):.1f}m lower than surroundings, creating a concave bowl.")

    if risk_score >= 3:
        risk_level = "high"
        actions = [
            "Avoid driving or walking through waterlogged roads and low underpasses.",
            "Move essential belongings and electronics to elevated surfaces.",
            "Monitor local municipal flood bulletins and emergency broadcasts.",
        ]
    elif risk_score >= 1:
        risk_level = "medium"
        actions = [
            "Check local drainage grates nearby and avoid parking in low-lying spots.",
            "Keep emergency contact numbers and mobile power banks handy.",
            "Stay alert for rapid water buildup if heavy showers begin.",
        ]
    else:
        risk_level = "low"
        actions = [
            "Current environmental indicators show safe, normal drainage conditions.",
            "Maintain standard awareness during seasonal weather changes.",
            "Report any localized street ponding to assist fellow citizens.",
        ]

    confidence = "high" if reps or (forecast_data and flood_data.get("available")) else "medium"

    summary = (
        f"Flood risk is assessed as {risk_level.upper()} based on real-time environmental sensors and citizen telemetry. "
        + ("Active ground-truth waterlogging observations take priority." if reps else "Forecast precipitation and hydrological flow baselines remain the primary risk drivers.")
    )

    telemetry = {
        "rainfall": {
            "daily_rain_mm": rain_days,
            "max_daily_rain_mm": round(float(max_daily_rain), 2) if max_daily_rain else 0.0,
            "peak_hourly_intensity_mm": round(float(peak_hourly), 2) if peak_hourly else 0.0,
            "max_probability_pct": int(max_prob) if max_prob else 0,
        },
        "hydrology": {
            "river_name": flood_data.get("river_name") or "Local Catchment Basin",
            "peak_ratio_vs_normal": round(float(peak_ratio), 2) if peak_ratio else 1.0,
            "available": bool(flood_data.get("available", False)),
        },
        "topography": {
            "elevation_m": terrain_data.get("elevation_m"),
            "relative_elevation_m": round(float(relative_elev), 2) if relative_elev is not None else 0.0,
            "sits_lower": bool(sits_lower),
            "water_features_count": terrain_data.get("water_features_count", 0),
        },
        "citizen_signals": {
            "total_reports": len(reps),
            "high_severity_count": len(high_water_reports),
            "knee_depth_count": len(knee_water_reports),
            "ankle_depth_count": len(ankle_water_reports),
        },
    }

    return {
        "risk_level": risk_level,
        "confidence": confidence,
        "summary": summary,
        "reasons": reasons[:4],
        "actions": actions[:3],
        "telemetry": telemetry,
    }


def assess(lat: float, lon: float, max_retries: int = 2) -> dict:
    last_exc = None
    for attempt in range(max_retries):
        try:
            agent = build_agent()
            result = agent(f"Assess flood and waterlogging risk at latitude {lat}, longitude {lon}.")
            data = _extract_json(str(result))
            if not data.get("telemetry"):
                try:
                    # Enrich with live tool telemetry for the dashboard
                    h = heuristic_assess(lat, lon)
                    data["telemetry"] = h.get("telemetry")
                except Exception:
                    pass
            return data
        except Exception as exc:
            last_exc = exc
            err_str = str(exc).lower()
            if attempt < max_retries - 1 and (
                "503" in err_str
                or "429" in err_str
                or "quota" in err_str
                or "resource_exhausted" in err_str
                or "throttled" in err_str
                or "rate limit" in err_str
                or "high demand" in err_str
                or "unavailable" in err_str
                or "temporarily" in err_str
            ):
                time.sleep(2 * (attempt + 1))
                continue

    # Graceful fallback: If LLM API has quota/rate limits, synthesize from live tools
    print(f"Notice: Falling back to heuristic tool analysis due to: {last_exc}")
    try:
        return heuristic_assess(lat, lon)
    except Exception as fallback_exc:
        raise last_exc or fallback_exc


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python agent.py <lat> <lon>")
    print(json.dumps(assess(float(sys.argv[1]), float(sys.argv[2])), indent=2))

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
from tools import (
    get_drought_and_groundwater,
    get_flood_risk,
    get_forecast,
    get_heat_risk,
    get_reports,
    get_terrain,
)

SYSTEM_PROMPT = """You are a comprehensive Climate, Water & Heat Risk Advisor for ANY location in the world.
Given a latitude and longitude, call ALL of your tools:
1. get_forecast (rainfall & rain probability)
2. get_flood_risk (river discharge surge)
3. get_terrain (elevation depression & drainage features)
4. get_heat_risk (temperature, apparent heat index, UV radiation)
5. get_drought_and_groundwater (soil moisture, groundwater buffer proxy, evapotranspiration)
6. get_reports (citizen ground truth for waterlogging, leaks, water tankers, and heat emergencies)

Combine the evidence across all climate & water dimensions (Floods, Heatwaves, Droughts, Groundwater, Leaks, Water Tankers).

Rules:
- Base every claim on tool results. Never invent numbers.
- If a tool returns no data or an error, say so and lower your confidence.
- Citizen reports, when present, outweigh model data for local street conditions and infrastructure failures.
- Provide practical, safe actions for ordinary citizens and local responders.

Respond with ONLY a JSON object, no markdown, in this exact shape:
{
  "risk_level": "low" | "medium" | "high",
  "confidence": "low" | "medium" | "high",
  "summary": "<2 plain language sentences summarizing highest acute risks>",
  "reasons": ["<evidence-based reason 1>", "<evidence-based reason 2>", "..."],
  "actions": ["<action 1>", "<action 2>", "<action 3>"],
  "hazards": {
    "flood": "low" | "medium" | "high",
    "heatwave": "low" | "medium" | "high",
    "drought_groundwater": "low" | "medium" | "high",
    "infrastructure": "low" | "medium" | "high"
  }
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
        tools=[
            get_forecast,
            get_flood_risk,
            get_terrain,
            get_heat_risk,
            get_drought_and_groundwater,
            get_reports,
        ],
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
    hazards = data.get("hazards")
    telemetry = data.get("telemetry")

    res = {
        "risk_level": clean_risk,
        "confidence": clean_conf,
        "summary": summary,
        "reasons": reasons,
        "actions": actions,
    }
    if hazards:
        res["hazards"] = hazards
    if telemetry:
        res["telemetry"] = telemetry
    return res


def heuristic_assess(lat: float, lon: float) -> dict:
    """Deterministic multi-hazard assessment when LLM service is throttled or offline.
    Evaluates live tools for Floods, Heatwaves, Droughts, Groundwater, and Infrastructure (Leaks/Tankers).
    """
    forecast_data = get_forecast(lat, lon)
    flood_data = get_flood_risk(lat, lon)
    terrain_data = get_terrain(lat, lon)
    heat_data = get_heat_risk(lat, lon)
    drought_data = get_drought_and_groundwater(lat, lon)
    reports_data = get_reports(lat, lon, radius_km=5.0)

    # 1. Rain & Flood analysis
    rain_days = forecast_data.get("rain_mm_per_day", [])
    max_daily_rain = max(rain_days) if rain_days else 0.0
    peak_hourly = forecast_data.get("peak_hourly_rain_mm") or 0.0
    prob = forecast_data.get("max_rain_probability_pct")
    max_prob = max(prob) if prob else 0
    peak_ratio = flood_data.get("peak_ratio_vs_normal") if flood_data.get("available") else 0.0

    # 2. Topography
    relative_elev = terrain_data.get("relative_to_surroundings_m", 0.0)
    sits_lower = terrain_data.get("sits_lower_than_surroundings", False) or relative_elev < -1.5

    # 3. Heatwave analysis
    peak_temp = heat_data.get("peak_temperature_c", 0.0)
    peak_app_temp = heat_data.get("peak_apparent_temperature_c", 0.0)
    peak_uv = heat_data.get("peak_uv_index", 0.0)
    heat_category = heat_data.get("heat_category", "low_normal")

    # 4. Drought & Groundwater analysis
    top_soil = drought_data.get("topsoil_moisture_m3m3", 0.3)
    deep_soil = drought_data.get("deep_soil_groundwater_proxy_m3m3", 0.3)
    peak_et0 = drought_data.get("peak_evapotranspiration_mm", 0.0)
    drought_status = drought_data.get("drought_and_groundwater_status", "normal_hydration")

    # 5. Citizen reports breakdown
    reps = reports_data.get("reports", [])
    flood_reps = [r for r in reps if r.get("category") == "flood_waterlogging" or not r.get("category")]
    leak_reps = [r for r in reps if r.get("category") == "pipe_leak"]
    tanker_reps = [r for r in reps if r.get("category") == "water_tanker"]
    heat_reps = [r for r in reps if r.get("category") == "heatwave_alert"]

    high_flood = [r for r in flood_reps if r.get("severity") in ("waist", "impassable") or r.get("water_depth") in ("waist", "impassable")]
    knee_flood = [r for r in flood_reps if r.get("severity") == "knee" or r.get("water_depth") == "knee"]
    burst_leaks = [r for r in leak_reps if r.get("severity") in ("burst_pipe", "major_main", "severe")]
    critical_tankers = [r for r in tanker_reps if r.get("severity") in ("dry_taps", "tanker_needed", "critical")]

    reasons = []
    actions = []

    # Hazard risk determination
    # Flood risk
    flood_risk = "low"
    if high_flood or (peak_ratio and peak_ratio >= 1.8) or max_daily_rain >= 50 or peak_hourly >= 15:
        flood_risk = "high"
        reasons.append(
            f"Dangerous flood conditions detected: {len(high_flood)} impassable report(s), {max_daily_rain:.1f} mm rain, river surge {peak_ratio}x normal."
        )
    elif knee_flood or (peak_ratio and peak_ratio >= 1.2) or max_daily_rain >= 20 or sits_lower:
        flood_risk = "medium"
        reasons.append(
            f"Moderate flood/waterlogging risk: {len(knee_flood)} standing water report(s), rain up to {max_daily_rain:.1f} mm/day, elevation bowl {relative_elev:.1f}m."
        )

    # Heatwave risk
    heat_risk = "low"
    if peak_app_temp >= 42.0 or peak_temp >= 40.0 or heat_reps:
        heat_risk = "high"
        reasons.append(
            f"Extreme heatwave warning: 'feels-like' index peaks at {peak_app_temp:.1f}°C (ambient {peak_temp:.1f}°C) with UV index {peak_uv}."
        )
    elif peak_app_temp >= 36.0 or peak_temp >= 35.0:
        heat_risk = "medium"
        reasons.append(
            f"Elevated thermal stress: apparent temperature reaches {peak_app_temp:.1f}°C, posing dehydration danger."
        )

    # Drought & Groundwater risk
    drought_risk = "low"
    if deep_soil < 0.16 or drought_status == "severe_drought_and_groundwater_deficit":
        drought_risk = "high"
        reasons.append(
            f"Severe drought and groundwater depletion: deep root-zone moisture at critical low {deep_soil:.3f} m³/m³ with {peak_et0} mm/day evapotranspiration."
        )
    elif deep_soil < 0.24 or drought_status == "moderate_drought_stress":
        drought_risk = "medium"
        reasons.append(
            f"Moderate drought conditions: groundwater buffer index {deep_soil:.3f} m³/m³ with elevated surface water loss."
        )

    # Infrastructure risk (Leaks & Tankers)
    infra_risk = "low"
    if burst_leaks or critical_tankers:
        infra_risk = "high"
        reasons.append(
            f"Critical water infrastructure stress: {len(burst_leaks)} pipe burst(s) and {len(critical_tankers)} acute tanker/water shortage alert(s)."
        )
    elif leak_reps or tanker_reps:
        infra_risk = "medium"
        reasons.append(
            f"Localized water supply disruptions: {len(leak_reps)} reported pipeline leak(s) and {len(tanker_reps)} active tanker dispatch queue(s)."
        )

    # Aggregate Overall Risk Level (Highest acute driver)
    hazard_levels = [flood_risk, heat_risk, drought_risk, infra_risk]
    if "high" in hazard_levels:
        overall_risk = "high"
    elif "medium" in hazard_levels:
        overall_risk = "medium"
    else:
        overall_risk = "low"
        if not reasons:
            reasons.append("Environmental sensors show safe hydrological, thermal, and sub-surface moisture baselines.")

    # Tailored Citizen Action Instructions
    if flood_risk == "high":
        actions.append("Avoid low-lying roads, underpasses, and swift water channels.")
    if heat_risk == "high":
        actions.append("Stay hydrated, minimize direct sun exposure between 11 AM - 4 PM, and check on vulnerable neighbors.")
    if drought_risk in ("high", "medium"):
        actions.append("Implement household water conservation and restrict non-essential consumption.")
    if infra_risk == "high":
        actions.append("Report untreated pipe bursts immediately and verify emergency tanker schedules with local ward officials.")
    if not actions:
        actions = [
            "Maintain situational weather awareness and monitor local municipal bulletins.",
            "Report newly emerging street flooding, pipeline leaks, or heat hazards to alert fellow residents.",
        ]

    hazards = {
        "flood": flood_risk,
        "heatwave": heat_risk,
        "drought_groundwater": drought_risk,
        "infrastructure": infra_risk,
    }

    active_threats = [k.replace("_", " ").title() for k, v in hazards.items() if v in ("high", "medium")]
    threat_text = ", ".join(active_threats) if active_threats else "baseline environmental stability"

    summary = (
        f"Overall risk is {overall_risk.upper()} driven by {threat_text}. "
        f"Real-time meteorological, hydrological, and crowd-sourced infrastructure sensors correlate {len(reps)} active citizen ground-truth reports."
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
        "heatwave": {
            "peak_temperature_c": peak_temp,
            "peak_apparent_temperature_c": peak_app_temp,
            "peak_uv_index": peak_uv,
            "heat_category": heat_category,
            "daily_temperatures": heat_data.get("max_temperature_c", []),
        },
        "drought_groundwater": {
            "topsoil_moisture_m3m3": top_soil,
            "deep_soil_groundwater_proxy_m3m3": deep_soil,
            "peak_evapotranspiration_mm": peak_et0,
            "status": drought_status,
        },
        "citizen_signals": {
            "total_reports": len(reps),
            "flood_count": len(flood_reps),
            "leak_count": len(leak_reps),
            "tanker_count": len(tanker_reps),
            "heat_count": len(heat_reps),
        },
    }

    return {
        "risk_level": overall_risk,
        "confidence": "high" if reps or (forecast_data and flood_data.get("available")) else "medium",
        "summary": summary,
        "reasons": reasons[:4],
        "actions": actions[:3],
        "hazards": hazards,
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

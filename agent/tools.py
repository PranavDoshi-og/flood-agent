"""Tools the flood agent can call. All data sources are global and need no API key."""
import math
import requests
from strands import tool

TIMEOUT = 25
HEADERS = {"User-Agent": "flood-agent-hackathon/0.1"}


def _get(url: str, params: dict) -> dict:
    r = requests.get(url, params=params, headers=HEADERS, timeout=TIMEOUT)
    r.raise_for_status()
    return r.json()


@tool
def get_forecast(lat: float, lon: float) -> dict:
    """Get the 3-day rainfall forecast for a location anywhere in the world.

    Args:
        lat: Latitude in decimal degrees.
        lon: Longitude in decimal degrees.

    Returns:
        Daily rain totals (mm), max rain probability (%), and the peak hourly
        rain intensity (mm/h) over the next 3 days.
    """
    data = _get(
        "https://api.open-meteo.com/v1/forecast",
        {
            "latitude": lat,
            "longitude": lon,
            "hourly": "precipitation",
            "daily": "precipitation_sum,precipitation_probability_max",
            "forecast_days": 3,
            "timezone": "auto",
        },
    )
    daily = data["daily"]
    hourly = [v for v in data["hourly"]["precipitation"] if v is not None]
    return {
        "dates": daily["time"],
        "rain_mm_per_day": daily["precipitation_sum"],
        "max_rain_probability_pct": daily["precipitation_probability_max"],
        "peak_hourly_rain_mm": max(hourly) if hourly else None,
    }


@tool
def get_flood_risk(lat: float, lon: float) -> dict:
    """Get the river flood outlook for the nearest river to a location.

    Args:
        lat: Latitude in decimal degrees.
        lon: Longitude in decimal degrees.

    Returns:
        Forecast river discharge for the next 7 days compared with normal, and a
        peak ratio (values well above 1 suggest elevated river flood risk).
        available=False means no river was modelled near this point.
    """
    data = _get(
        "https://flood-api.open-meteo.com/v1/flood",
        {
            "latitude": lat,
            "longitude": lon,
            "daily": "river_discharge,river_discharge_mean",
            "forecast_days": 7,
        },
    )
    daily = data.get("daily", {})
    q = [v for v in daily.get("river_discharge", []) if v is not None]
    mean = [v for v in daily.get("river_discharge_mean", []) if v is not None]
    if not q or not mean or max(mean) <= 0:
        return {"available": False, "note": "No river discharge modelled near this point."}
    return {
        "available": True,
        "dates": daily.get("time"),
        "river_discharge_m3s": daily.get("river_discharge"),
        "normal_discharge_m3s": daily.get("river_discharge_mean"),
        "peak_ratio_vs_normal": round(max(q) / max(mean), 2),
    }


def _offsets(lat: float, lon: float, meters: float = 500.0):
    dlat = meters / 111_000
    dlon = meters / (111_000 * max(math.cos(math.radians(lat)), 0.01))
    return [
        (lat + dlat, lon),
        (lat - dlat, lon),
        (lat, lon + dlon),
        (lat, lon - dlon),
    ]


@tool
def get_terrain(lat: float, lon: float) -> dict:
    """Describe terrain and nearby water for a location anywhere in the world.

    Args:
        lat: Latitude in decimal degrees.
        lon: Longitude in decimal degrees.

    Returns:
        Elevation (m), how much lower or higher the spot is than its surroundings
        within ~500 m (negative means it sits in a bowl and collects water), and
        counts of rivers, streams, drains and water bodies within 1 km.
    """
    pts = [(lat, lon)] + _offsets(lat, lon)
    elev = _get(
        "https://api.open-meteo.com/v1/elevation",
        {
            "latitude": ",".join(f"{p[0]:.5f}" for p in pts),
            "longitude": ",".join(f"{p[1]:.5f}" for p in pts),
        },
    )["elevation"]
    center, around = elev[0], elev[1:]
    relative = round(center - sum(around) / len(around), 1)

    result = {
        "elevation_m": center,
        "relative_to_surroundings_m": relative,
        "sits_lower_than_surroundings": relative < -2,
    }

    dlat = 1000.0 / 111_000.0
    dlon = 1000.0 / (111_000.0 * max(math.cos(math.radians(lat)), 0.01))
    s, w, n, e = lat - dlat, lon - dlon, lat + dlat, lon + dlon

    query = (
        f"[out:json][timeout:10];("
        f'way["waterway"]({s:.5f},{w:.5f},{n:.5f},{e:.5f});'
        f'way["natural"="water"]({s:.5f},{w:.5f},{n:.5f},{e:.5f});'
        f");out tags 60;"
    )
    overpass_endpoints = [
        "https://overpass-api.de/api/interpreter",
        "https://overpass.kumi.systems/api/interpreter",
    ]
    overpass_error = None
    for endpoint in overpass_endpoints:
        try:
            r = requests.post(
                endpoint,
                data={"data": query},
                headers=HEADERS,
                timeout=10,
            )
            r.raise_for_status()
            counts: dict = {}
            for el in r.json().get("elements", []):
                tags = el.get("tags", {})
                kind = tags.get("waterway") or tags.get("natural") or "water"
                counts[kind] = counts.get(kind, 0) + 1
            result["water_features_within_1km"] = counts
            overpass_error = None
            break
        except Exception as exc:  # Overpass is public and can be busy; try next or degrade gracefully
            overpass_error = str(exc)[:120]

    if overpass_error is not None and "water_features_within_1km" not in result:
        result["water_features_within_1km"] = None
        result["water_features_error"] = overpass_error
    return result


@tool
def get_heat_risk(lat: float, lon: float) -> dict:
    """Get the 3-day temperature, heatwave severity, and heat index outlook for a location anywhere in the world.

    Args:
        lat: Latitude in decimal degrees.
        lon: Longitude in decimal degrees.

    Returns:
        Max daily temperatures (°C), max feels-like apparent temperatures (°C),
        peak UV index, and an assessment of extreme heatwave danger.
    """
    data = _get(
        "https://api.open-meteo.com/v1/forecast",
        {
            "latitude": lat,
            "longitude": lon,
            "daily": "temperature_2m_max,apparent_temperature_max,uv_index_max",
            "forecast_days": 3,
            "timezone": "auto",
        },
    )
    daily = data.get("daily", {})
    t_max = [v for v in daily.get("temperature_2m_max", []) if v is not None]
    app_max = [v for v in daily.get("apparent_temperature_max", []) if v is not None]
    uv_max = [v for v in daily.get("uv_index_max", []) if v is not None]

    peak_t = max(t_max) if t_max else 0.0
    peak_app = max(app_max) if app_max else 0.0
    peak_uv = max(uv_max) if uv_max else 0.0

    if peak_app >= 42.0 or peak_t >= 40.0:
        category = "extreme_heatwave"
    elif peak_app >= 38.0 or peak_t >= 36.0:
        category = "high_heat_warning"
    elif peak_app >= 32.0 or peak_t >= 32.0:
        category = "moderate_heat_caution"
    else:
        category = "low_normal"

    return {
        "dates": daily.get("time", []),
        "max_temperature_c": t_max,
        "max_apparent_temperature_c": app_max,
        "peak_temperature_c": round(peak_t, 1),
        "peak_apparent_temperature_c": round(peak_app, 1),
        "peak_uv_index": round(peak_uv, 1),
        "heat_category": category,
    }


@tool
def get_drought_and_groundwater(lat: float, lon: float) -> dict:
    """Assess drought indicators, soil moisture, and shallow groundwater conditions anywhere in the world.

    Args:
        lat: Latitude in decimal degrees.
        lon: Longitude in decimal degrees.

    Returns:
        Topsoil moisture (0-1cm), deep root-zone moisture (27-81cm) representing groundwater buffer (m³/m³),
        reference evapotranspiration (mm/day), and drought stress classification.
    """
    data = _get(
        "https://api.open-meteo.com/v1/forecast",
        {
            "latitude": lat,
            "longitude": lon,
            "daily": "et0_fao_evapotranspiration",
            "hourly": "soil_moisture_0_to_1cm,soil_moisture_27_to_81cm",
            "forecast_days": 3,
            "timezone": "auto",
        },
    )
    daily = data.get("daily", {})
    hourly = data.get("hourly", {})
    et0 = [v for v in daily.get("et0_fao_evapotranspiration", []) if v is not None]
    top_soil = [v for v in hourly.get("soil_moisture_0_to_1cm", []) if v is not None]
    deep_soil = [v for v in hourly.get("soil_moisture_27_to_81cm", []) if v is not None]

    avg_top = round(sum(top_soil) / len(top_soil), 3) if top_soil else 0.0
    avg_deep = round(sum(deep_soil) / len(deep_soil), 3) if deep_soil else 0.0
    max_et0 = round(max(et0), 2) if et0 else 0.0

    if avg_deep < 0.15:
        status = "severe_drought_and_groundwater_deficit"
    elif avg_deep < 0.25:
        status = "moderate_drought_stress"
    elif avg_deep >= 0.38:
        status = "saturated_high_water_table"
    else:
        status = "normal_hydration"

    return {
        "dates": daily.get("time", []),
        "topsoil_moisture_m3m3": avg_top,
        "deep_soil_groundwater_proxy_m3m3": avg_deep,
        "daily_evapotranspiration_mm": et0,
        "peak_evapotranspiration_mm": max_et0,
        "drought_and_groundwater_status": status,
    }


@tool
def get_reports(
    lat: float, lon: float, radius_km: float = 2.0, category: str | None = None
) -> dict:
    """Get recent citizen reports (floods, pipe leaks, water tankers, heatwave hazards) near a location.

    Args:
        lat: Latitude in decimal degrees.
        lon: Longitude in decimal degrees.
        radius_km: Search radius in kilometres.
        category: Optional category filter ('flood_waterlogging', 'pipe_leak', 'water_tanker', 'heatwave_alert').

    Returns:
        Number of recent reports and their details.
    """
    try:
        import sys
        from pathlib import Path

        backend_dir = str(Path(__file__).resolve().parent.parent / "backend")
        if backend_dir not in sys.path:
            sys.path.insert(0, backend_dir)
        from storage import get_storage

        store = get_storage()
        items = store.get_reports(lat=lat, lon=lon, radius_km=radius_km, category=category)
        serialized = []
        for it in items:
            serialized.append(
                it.model_dump() if hasattr(it, "model_dump") else dict(it)
            )
        return {
            "count": len(serialized),
            "reports": serialized,
        }
    except Exception as exc:
        return {"count": 0, "reports": [], "note": f"Report storage unavailable: {str(exc)[:100]}"}

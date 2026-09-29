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
def get_reports(lat: float, lon: float, radius_km: float = 2.0) -> dict:
    """Get recent citizen waterlogging reports near a location.

    Args:
        lat: Latitude in decimal degrees.
        lon: Longitude in decimal degrees.
        radius_km: Search radius in kilometres.

    Returns:
        Number of recent reports and their details.
    """
    # Stub for Day 1. On Day 2 this reads from DynamoDB (geohash key).
    return {"count": 0, "reports": [], "note": "Report storage not connected yet."}

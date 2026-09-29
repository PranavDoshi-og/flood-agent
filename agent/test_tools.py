"""Checks the tools against real APIs in 3 countries. No AWS or model needed.
Usage:  python test_tools.py
"""
import json

from tools import get_flood_risk, get_forecast, get_terrain

CITIES = {
    "Mumbai, India": (19.0760, 72.8777),
    "Jakarta, Indonesia": (-6.2088, 106.8456),
    "Houston, USA": (29.7604, -95.3698),
}

for name, (lat, lon) in CITIES.items():
    print(f"\n=== {name} ===")
    for fn in (get_forecast, get_flood_risk, get_terrain):
        try:
            print(fn.__name__, json.dumps(fn(lat, lon), indent=2))
        except Exception as exc:
            print(fn.__name__, "FAILED:", exc)

"""Flood risk agent. Usage:  python agent.py <lat> <lon>"""
import json
import os
import re
import sys
from pathlib import Path
from dotenv import find_dotenv, load_dotenv

# Load environment variables from .env file
load_dotenv(find_dotenv(usecwd=True))
load_dotenv(Path(__file__).resolve().parent / ".env")
load_dotenv(Path(__file__).resolve().parent.parent / ".env")

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
    match = re.search(r"\{.*\}", text, re.DOTALL)
    if not match:
        raise ValueError(f"Agent did not return JSON: {text[:200]}")
    return json.loads(match.group(0))


def assess(lat: float, lon: float) -> dict:
    agent = build_agent()
    result = agent(f"Assess flood and waterlogging risk at latitude {lat}, longitude {lon}.")
    return _extract_json(str(result))


if __name__ == "__main__":
    if len(sys.argv) != 3:
        sys.exit("Usage: python agent.py <lat> <lon>")
    print(json.dumps(assess(float(sys.argv[1]), float(sys.argv[2])), indent=2))

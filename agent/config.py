"""Central config. Change the model or region here (or via environment variables)."""
import os

AWS_REGION = os.environ.get("AWS_REGION", "us-east-1")

# Set this to a model you have enabled in the Bedrock console (Model access).
# Example: set BEDROCK_MODEL_ID=<your-model-id>
BEDROCK_MODEL_ID = os.environ.get("BEDROCK_MODEL_ID", "")

# Anthropic model configuration
ANTHROPIC_MODEL_ID = os.environ.get("ANTHROPIC_MODEL_ID", "claude-3-5-haiku-20241022")

# Gemini model configuration
GEMINI_MODEL_ID = os.environ.get("GEMINI_MODEL_ID", "gemini-3.5-flash")


def require_model_id() -> str:
    if not BEDROCK_MODEL_ID:
        raise RuntimeError(
            "BEDROCK_MODEL_ID is not set. Enable a model in the Bedrock console, "
            "then run:  set BEDROCK_MODEL_ID=<model id>   (Windows cmd)"
        )
    return BEDROCK_MODEL_ID


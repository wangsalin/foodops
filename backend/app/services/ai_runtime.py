import re


def sanitize_ai_output(output: str | None) -> str:
    """Clean local rule explanations before showing them in the UI."""
    cleaned = str(output or "").strip()
    cleaned = re.sub(r"<think\b[^>]*>.*?</think>", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"<thinking\b[^>]*>.*?</thinking>", "", cleaned, flags=re.IGNORECASE | re.DOTALL)
    cleaned = re.sub(r"</?(?:think|thinking)\b[^>]*>", "", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\n{3,}", "\n\n", cleaned).strip()
    return cleaned or "No local rule explanation is available."

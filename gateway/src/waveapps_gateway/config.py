"""Gateway settings from the environment. Secrets come only from files, and no value is ever printed."""

from __future__ import annotations

import os
from collections.abc import Mapping
from dataclasses import dataclass, field
from pathlib import Path

REQUIRED = (
    "BASE_URL",
    "ALLOWED_EMAILS",
    "GOOGLE_OAUTH_CLIENT_ID",
    "GOOGLE_OAUTH_CLIENT_SECRET_FILE",
    "JWT_SIGNING_KEY_FILE",
    "WAVE_MCP_HTTP_TOKEN_FILE",
)
DEFAULT_UPSTREAM = "http://127.0.0.1:8765/mcp"
DEFAULT_STATE_DIR = "~/.local/state/waveapps-mcp-gateway"


class ConfigError(Exception):
    """Every problem with the environment, listed together."""


@dataclass(frozen=True)
class GatewayConfig:
    base_url: str
    allowed_emails: frozenset[str]
    google_client_id: str
    google_client_secret: str = field(repr=False)
    jwt_signing_key: str = field(repr=False)
    upstream_token: str = field(repr=False)
    upstream_url: str = DEFAULT_UPSTREAM
    host: str = "127.0.0.1"
    port: int = 8000
    state_dir: Path = field(default_factory=lambda: Path(DEFAULT_STATE_DIR).expanduser())


def allowed_emails(raw: str) -> frozenset[str]:
    return frozenset(e.strip().lower() for e in raw.split(",") if e.strip())


def load(env: Mapping[str, str] | None = None) -> GatewayConfig:
    env = os.environ if env is None else env
    problems = [f"{name} is not set" for name in REQUIRED if not env.get(name)]

    def secret(var: str) -> str:
        path = env.get(var)
        if not path:
            return ""
        try:
            value = Path(path).expanduser().read_text(encoding="utf-8").strip()
        except OSError as err:
            problems.append(f"{var} ({path}) cannot be read: {err.strerror or type(err).__name__}")
            return ""
        if not value:
            problems.append(f"{var} ({path}) is empty")
        return value

    client_secret = secret("GOOGLE_OAUTH_CLIENT_SECRET_FILE")
    jwt_signing_key = secret("JWT_SIGNING_KEY_FILE")
    upstream_token = secret("WAVE_MCP_HTTP_TOKEN_FILE")

    emails = allowed_emails(env.get("ALLOWED_EMAILS", ""))
    if env.get("ALLOWED_EMAILS") and not emails:
        problems.append("ALLOWED_EMAILS names nobody; refusing to start a gate that would admit any Google account")

    port_raw = env.get("WAVE_GATEWAY_PORT") or "8000"
    port = int(port_raw) if port_raw.isdigit() else 0
    if not 0 < port < 65536:
        problems.append(f"WAVE_GATEWAY_PORT must be a port number from 1 to 65535, got {port_raw!r}")

    if problems:
        raise ConfigError("The gateway is not configured:\n" + "\n".join(f"  - {p}" for p in problems))
    return GatewayConfig(
        base_url=env["BASE_URL"].rstrip("/"),
        allowed_emails=emails,
        google_client_id=env["GOOGLE_OAUTH_CLIENT_ID"],
        google_client_secret=client_secret,
        jwt_signing_key=jwt_signing_key,
        upstream_token=upstream_token,
        upstream_url=env.get("WAVE_GATEWAY_UPSTREAM_URL") or DEFAULT_UPSTREAM,
        host=env.get("WAVE_GATEWAY_HOST") or "127.0.0.1",
        port=port,
        state_dir=Path(env.get("WAVE_GATEWAY_STATE_DIR") or DEFAULT_STATE_DIR).expanduser(),
    )

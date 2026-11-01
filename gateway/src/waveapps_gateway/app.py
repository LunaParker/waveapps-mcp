"""The gateway: a FastMCP proxy to waveapps-mcp, gated by Google sign-in and the email allowlist."""

from __future__ import annotations

from fastmcp import FastMCP
from fastmcp.client.transports import StreamableHttpTransport
from fastmcp.server import create_proxy
from fastmcp.server.auth import AuthProvider

from waveapps_gateway.config import GatewayConfig
from waveapps_gateway.gate import EmailAllowlist, build_auth

NAME = "waveapps-mcp"


def upstream_transport(url: str, token: str) -> StreamableHttpTransport:
    # FastMCP forwards the caller's Authorization (the gateway's own token) unless the transport sets one; this one wins.
    return StreamableHttpTransport(url, headers={"Authorization": f"Bearer {token}"})


def build_proxy(url: str, token: str, auth: AuthProvider | None) -> FastMCP:
    return create_proxy(upstream_transport(url, token), name=NAME, auth=auth)


def build_app(config: GatewayConfig) -> FastMCP:
    app = build_proxy(config.upstream_url, config.upstream_token, build_auth(config))
    app.add_middleware(EmailAllowlist(config.allowed_emails))
    return app

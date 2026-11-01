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
    # The proxy forwards the caller's lowercase `authorization`; a headers= entry would go out as a second
    # header (Node keeps the first). Bearer auth runs at send time and replaces every Authorization header.
    return StreamableHttpTransport(url, auth=token)


def build_proxy(url: str, token: str, auth: AuthProvider | None) -> FastMCP:
    # waveapps-mcp only speaks the initialize handshake. By default the proxy mirrors the caller's era, so a
    # modern (server/discover) caller like claude.ai would reach it as modern and get 400s; pin legacy.
    return create_proxy(upstream_transport(url, token), name=NAME, auth=auth, mode="legacy")


def build_app(config: GatewayConfig) -> FastMCP:
    app = build_proxy(config.upstream_url, config.upstream_token, build_auth(config))
    app.add_middleware(EmailAllowlist(config.allowed_emails))
    return app

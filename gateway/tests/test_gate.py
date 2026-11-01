import stat
from types import SimpleNamespace
from typing import Any

import pytest
from fastmcp.exceptions import AuthorizationError
from fastmcp.server.auth.providers.google import GoogleProvider

from waveapps_gateway import gate

EMAILS = frozenset({"owner@example.com"})
CONTEXT: Any = SimpleNamespace()  # the allowlist never reads its context


async def _ok(context):
    return "ok"


@pytest.mark.anyio
@pytest.mark.parametrize(
    "claims, allowed",
    [
        ({"email": "Owner@Example.com", "email_verified": True}, True),
        ({"email": "owner@example.com", "email_verified": "true"}, True),
        ({"email": "owner@example.com", "email_verified": False}, False),
        ({"email": "owner@example.com"}, False),
        ({"email": "stranger@example.com", "email_verified": True}, False),
        ({}, False),
    ],
)
async def test_the_allowlist_admits_verified_listed_emails_only(monkeypatch, claims, allowed):
    monkeypatch.setattr(gate, "get_access_token", lambda: SimpleNamespace(claims=claims))
    middleware = gate.EmailAllowlist(EMAILS)
    if allowed:
        assert await middleware.on_request(CONTEXT, _ok) == "ok"
    else:
        with pytest.raises(AuthorizationError, match="not authorized"):
            await middleware.on_request(CONTEXT, _ok)


@pytest.mark.anyio
async def test_a_request_without_a_token_is_refused(monkeypatch):
    monkeypatch.setattr(gate, "get_access_token", lambda: None)
    with pytest.raises(AuthorizationError, match="your account"):
        await gate.EmailAllowlist(EMAILS).on_request(CONTEXT, _ok)


def test_oauth_state_lives_in_a_private_directory(config):
    gate.client_storage(config)
    for path in (config.state_dir, config.state_dir / "oauth"):
        assert stat.S_IMODE(path.stat().st_mode) == 0o700


def test_build_auth_is_a_google_provider_on_the_base_url(config):
    auth = gate.build_auth(config)
    assert isinstance(auth, GoogleProvider)
    assert str(auth.base_url).rstrip("/") == "https://gateway.example"

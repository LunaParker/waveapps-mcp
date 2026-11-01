from types import SimpleNamespace

import pytest
from fastmcp import FastMCP
from fastmcp.server.dependencies import get_http_headers
from fastmcp.utilities.tests import asgi_client, asgi_server, run_server_async

from waveapps_gateway import __main__ as cli
from waveapps_gateway import gate
from waveapps_gateway.app import build_app, build_proxy
from waveapps_gateway.config import REQUIRED

LIST = {"jsonrpc": "2.0", "id": 1, "method": "tools/list"}
ACCEPT = {"Accept": "application/json, text/event-stream"}


def stub_upstream() -> FastMCP:
    """A stand-in for waveapps-mcp. Build a fresh one per test: one FastMCP instance can't serve twice in a process."""
    upstream = FastMCP("stub")

    @upstream.tool
    def seen_authorization() -> str:
        return get_http_headers(include={"authorization"}).get("authorization", "")

    return upstream


@pytest.mark.anyio
async def test_the_upstream_sees_the_gateway_token_not_the_callers():
    async with run_server_async(stub_upstream()) as url:
        proxy = build_proxy(url, "TEST_upstream_token", auth=None)
        async with asgi_client(proxy, headers={"Authorization": "Bearer TEST_caller_token"}) as client:
            result = await client.call_tool("seen_authorization", {})
    assert result.data == "Bearer TEST_upstream_token"


def test_build_app_gates_with_google_and_the_allowlist(config):
    app = build_app(config)
    assert app.auth is not None
    assert any(isinstance(m, gate.EmailAllowlist) for m in app.middleware)


@pytest.mark.anyio
async def test_an_unauthenticated_call_is_challenged_and_metadata_is_published(config):
    async with asgi_server(build_app(config)) as server, server.http_client() as http:
        response = await http.post("/mcp", json=LIST, headers=ACCEPT)
        assert response.status_code == 401
        assert "www-authenticate" in {k.lower() for k in response.headers}
        for path in ("/.well-known/oauth-authorization-server", "/.well-known/oauth-protected-resource/mcp"):
            assert (await http.get(path)).status_code == 200


def test_main_exits_2_and_names_the_problems_when_unconfigured(monkeypatch, capsys):
    for name in REQUIRED:
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setattr(cli, "build_app", lambda config: pytest.fail("built an app without a configuration"))
    assert cli.main() == 2
    assert "BASE_URL is not set" in capsys.readouterr().err


def test_main_serves_on_the_configured_loopback_port(monkeypatch, env, tmp_path):
    for name, value in {**env, "WAVE_GATEWAY_STATE_DIR": str(tmp_path / "state"), "WAVE_GATEWAY_PORT": "8100"}.items():
        monkeypatch.setenv(name, value)
    for name in ("WAVE_GATEWAY_HOST", "WAVE_GATEWAY_UPSTREAM_URL"):
        monkeypatch.delenv(name, raising=False)
    calls = []
    monkeypatch.setattr(cli, "build_app", lambda config: SimpleNamespace(run=lambda **kwargs: calls.append(kwargs)))
    assert cli.main() == 0
    assert calls == [{"transport": "http", "host": "127.0.0.1", "port": 8100}]

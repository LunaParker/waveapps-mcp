"""Who may use the gateway: Google sign-in for identity, an email allowlist for authorization."""

from __future__ import annotations

from typing import Any

from cryptography.fernet import Fernet
from fastmcp.exceptions import AuthorizationError
from fastmcp.server.auth.jwt_issuer import derive_jwt_key
from fastmcp.server.auth.providers.google import GoogleProvider
from fastmcp.server.dependencies import get_access_token
from fastmcp.server.middleware.middleware import CallNext, Middleware, MiddlewareContext
from key_value.aio.stores.filetree import (
    FileTreeStore,
    FileTreeV1CollectionSanitizationStrategy,
    FileTreeV1KeySanitizationStrategy,
)
from key_value.aio.wrappers.encryption import FernetEncryptionWrapper

from waveapps_gateway.config import GatewayConfig

SCOPES = ["openid", "email"]
STORAGE_SALT = "waveapps-gateway-oauth-storage"


class EmailAllowlist(Middleware):
    """Only a verified, listed email passes; anyone else gets an authorization error rather than a 500."""

    def __init__(self, emails: frozenset[str]) -> None:
        self.emails = emails

    async def on_request(self, context: MiddlewareContext[Any], call_next: CallNext[Any, Any]) -> Any:
        token = get_access_token()
        claims = token.claims if token is not None else {}
        email = str(claims.get("email") or "").strip().lower()
        verified = claims.get("email_verified")
        if not email or email not in self.emails or not (verified is True or str(verified).lower() == "true"):
            raise AuthorizationError(f"This server is restricted; {email or 'your account'} is not authorized.")
        return await call_next(context)


def client_storage(config: GatewayConfig) -> FernetEncryptionWrapper:
    """OAuth registrations and tokens, encrypted on disk; sanitized keys cope with Claude Code's URL-shaped client id."""
    directory = config.state_dir / "oauth"
    directory.mkdir(mode=0o700, parents=True, exist_ok=True)
    config.state_dir.chmod(0o700)
    directory.chmod(0o700)
    store = FileTreeStore(
        data_directory=directory,
        key_sanitization_strategy=FileTreeV1KeySanitizationStrategy(directory),
        collection_sanitization_strategy=FileTreeV1CollectionSanitizationStrategy(directory),
    )
    key = derive_jwt_key(high_entropy_material=config.jwt_signing_key, salt=STORAGE_SALT)
    return FernetEncryptionWrapper(key_value=store, fernet=Fernet(key), raise_on_decryption_error=False)


def build_auth(config: GatewayConfig) -> GoogleProvider:
    return GoogleProvider(
        client_id=config.google_client_id,
        client_secret=config.google_client_secret,
        base_url=config.base_url,
        required_scopes=SCOPES,
        jwt_signing_key=config.jwt_signing_key,
        client_storage=client_storage(config),
        require_authorization_consent="remember",
    )

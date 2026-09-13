"""Authentication for the standalone SD-video service.

The service trusts only short-lived tokens minted by the Studio Go API.  It
never calls the legacy Supabase Auth project and never accepts user identity
from request bodies.
"""

from dataclasses import dataclass
import re
from typing import Annotated, Any

import jwt
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer

from app.config import settings


bearer = HTTPBearer(auto_error=False)


@dataclass(frozen=True)
class ServicePrincipal:
    subject: str
    workspace_id: str
    role: str
    scopes: frozenset[str]
    token_id: str | None = None

    def allows(self, scope: str) -> bool:
        return scope in self.scopes or "*" in self.scopes


def _public_key() -> str:
    value = settings.SERVICE_JWT_PUBLIC_KEY.strip()
    if value.startswith("file:"):
        with open(value[5:], "r", encoding="utf-8") as handle:
            return handle.read()
    return value


def _decode_token(token: str) -> dict[str, Any]:
    key = _public_key()
    if not key:
        if settings.LOCAL_DEMO_MODE and settings.APP_ENV != "production":
            return {"sub": "local-demo-user", "workspace_id": "personal", "role": "member", "scope": "*"}
        raise HTTPException(status_code=status.HTTP_503_SERVICE_UNAVAILABLE, detail="service token verifier is not configured")
    try:
        return jwt.decode(
            token,
            key,
            algorithms=list(settings.SERVICE_JWT_ALGORITHMS),
            issuer=settings.SERVICE_JWT_ISSUER,
            audience=settings.SERVICE_JWT_AUDIENCE,
            leeway=settings.SERVICE_TOKEN_LEEWAY_SECONDS,
            options={"require": ["sub", "exp", "iat", "iss", "aud", "workspace_id", "jti"]},
        )
    except jwt.PyJWTError as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="invalid service token") from exc


def _principal_from_claims(claims: dict[str, Any]) -> ServicePrincipal:
    if not (settings.LOCAL_DEMO_MODE and settings.APP_ENV != "production"):
        try:
            lifetime = int(claims["exp"]) - int(claims["iat"])
        except (KeyError, TypeError, ValueError):
            raise HTTPException(status_code=401, detail="invalid service token lifetime")
        if lifetime <= 0 or lifetime > 300 or not claims.get("jti"):
            raise HTTPException(status_code=401, detail="invalid service token lifetime")
    subject = str(claims.get("sub") or "").strip()
    workspace_id = str(claims.get("workspace_id") or "").strip()
    role = str(claims.get("role") or "member").strip()
    raw_scope = claims.get("scope", "")
    scopes = frozenset(str(raw_scope).split()) if isinstance(raw_scope, str) else frozenset(str(x) for x in raw_scope or [])
    if not subject or not workspace_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="service token subject is missing")
    if any(value in {".", ".."} or not re.fullmatch(r"[A-Za-z0-9_.:@-]{1,160}", value) for value in (subject, workspace_id)):
        raise HTTPException(status_code=401, detail="invalid service identity")
    return ServicePrincipal(subject, workspace_id, role, scopes, str(claims.get("jti")) if claims.get("jti") else None)


async def require_principal(
    request: Request,
    credentials: Annotated[HTTPAuthorizationCredentials | None, Depends(bearer)],
) -> ServicePrincipal:
    del request
    if credentials is None:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="service token required")
    return _principal_from_claims(_decode_token(credentials.credentials))


def require_scope(scope: str):
    async def dependency(principal: Annotated[ServicePrincipal, Depends(require_principal)]) -> ServicePrincipal:
        if not principal.allows(scope):
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail=f"missing scope: {scope}")
        return principal

    return dependency


def require_admin(principal: Annotated[ServicePrincipal, Depends(require_principal)]) -> ServicePrincipal:
    if principal.role != "admin" or not principal.allows("admin"):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="admin role required")
    return principal

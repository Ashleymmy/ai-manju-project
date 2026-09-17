from __future__ import annotations

from app.config import settings

from .base import ARK_OFFICIAL, LEGACY_PROXY, TOKENSPACE, SeedanceProvider, SeedanceProviderError
from .ark_official import ArkOfficialProvider
from .legacy_proxy import LegacyProxyProvider
from .tokenspace import TokenSpaceProvider

# Logical proxy/official slots must retain routing even with custom model IDs.
SEEDANCE_PROVIDER_MODELS = frozenset({"seedance-2.0", "seedance-2.5", "seedance-2.0-mini", "seedance-fast", "seedance-2.0-ark"})


class SeedanceProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, SeedanceProvider] = {
            ARK_OFFICIAL: ArkOfficialProvider(
                settings.ARK_OFFICIAL_BASE_URL, settings.ARK_OFFICIAL_API_KEY,
                settings.ARK_OFFICIAL_ASSET_BASE_URL, settings.ARK_OFFICIAL_ACCESS_KEY_ID,
                settings.ARK_OFFICIAL_SECRET_ACCESS_KEY, region=settings.ARK_OFFICIAL_REGION,
                project_name=settings.ARK_OFFICIAL_PROJECT_NAME, security_token=settings.ARK_OFFICIAL_SECURITY_TOKEN,
            ),
            LEGACY_PROXY: LegacyProxyProvider(settings.SEEDANCE20_URL, settings.SEEDANCE20_KEY),
            TOKENSPACE: TokenSpaceProvider(
                settings.TOKENSPACE_BASE_URL,
                settings.TOKENSPACE_API_KEY,
                settings.TOKENSPACE_MODEL_ID,
            ),
        }

    def get(self, provider_name: str | None) -> SeedanceProvider:
        normalized = (provider_name or LEGACY_PROXY).strip().lower()
        provider = self._providers.get(normalized)
        if not provider:
            raise SeedanceProviderError(f"unknown Seedance provider: {provider_name}")
        return provider

    def submission_provider(self, logical_model: str) -> str:
        if logical_model == "seedance-2.0-ark":
            return ARK_OFFICIAL
        if logical_model in {"seedance-2.0", "seedance-2.5"}:
            return settings.SEEDANCE20_PROVIDER
        return LEGACY_PROXY

    def asset_provider(self) -> SeedanceProvider:
        return self.get(settings.SEEDANCE_ASSET_PROVIDER or ARK_OFFICIAL)

    def configured(self, provider_name: str) -> bool:
        return self.get(provider_name).configured()


seedance_provider_registry = SeedanceProviderRegistry()

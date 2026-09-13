from __future__ import annotations

from app.config import settings

from .base import LEGACY_PROXY, TOKENSPACE, SeedanceProvider, SeedanceProviderError
from .legacy_proxy import LegacyProxyProvider
from .tokenspace import TokenSpaceProvider


class SeedanceProviderRegistry:
    def __init__(self) -> None:
        self._providers: dict[str, SeedanceProvider] = {
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
        if logical_model == "seedance-2.0":
            return settings.SEEDANCE20_PROVIDER
        return LEGACY_PROXY

    def configured(self, provider_name: str) -> bool:
        return self.get(provider_name).configured()


seedance_provider_registry = SeedanceProviderRegistry()

"""Validate Provider references, including the explicitly configured HTTP NAS ingress."""
from urllib.parse import parse_qs, urlsplit

from app.config import settings
from app.storage.supabase import SupabaseStorageAdapter, _origin


def validate_provider_reference_url(url: str, *, storage_key: str = "") -> None:
    """HTTP is accepted only for a freshly signed, exact NAS storage object."""
    parsed = urlsplit(url)
    if not parsed.hostname or parsed.username is not None or parsed.password is not None or parsed.fragment:
        raise ValueError("reference URL must be a public HTTPS URL or configured signed storage URL")
    if parsed.scheme == "https":
        return
    if parsed.scheme == "http" and storage_key and settings.STORAGE_BACKEND == "supabase":
        public = urlsplit(_origin(settings.SUPABASE_PUBLIC_URL, public=True))
        _, target = SupabaseStorageAdapter()._target(storage_key)
        tokens = parse_qs(parsed.query).get("token", [])
        if (public.scheme == "http" and parsed.netloc == public.netloc
                and parsed.path == "/storage/v1/object/sign/" + target
                and len(tokens) == 1 and tokens[0]):
            return
    raise ValueError("reference URL must be a public HTTPS URL or configured signed storage URL")

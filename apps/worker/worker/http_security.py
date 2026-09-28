"""Explicit redirect boundaries and DNS-pinned, credentialless media transfers."""
from __future__ import annotations

import ipaddress
import os
import socket
from urllib.parse import parse_qsl, urlencode, urljoin, urlsplit, urlunsplit

import requests
from requests.adapters import HTTPAdapter
from urllib3 import PoolManager
from urllib3.connection import HTTPConnection, HTTPSConnection
from urllib3.connectionpool import HTTPConnectionPool, HTTPSConnectionPool
from urllib3.exceptions import ConnectTimeoutError, NewConnectionError

# Keep redirects bounded independently of the requests global default (30).
MAX_MEDIA_REDIRECTS = 5
REDIRECT_STATUSES = {301, 302, 303, 307, 308}
SUBMISSION_REDIRECT_FLAG = "_worker_submission_redirected"
METADATA_IPS = {ipaddress.ip_address(value) for value in ("100.100.100.200", "168.63.129.16", "fd00:ec2::254")}
METADATA_HOSTS = {"metadata.google.internal", "metadata.goog", "instance-data.ec2.internal"}
# These are operator settings, never Job payload fields. Match exact origins,
# including scheme and port, so a trusted NAS does not trust its redirects.
STORAGE_ORIGIN_SETTINGS = ("STUDIO_SUPABASE_URL", "STUDIO_SUPABASE_PUBLIC_URL", "STUDIO_OSS_ENDPOINT")


class HTTPPolicyError(Exception):
    """Fixed text only: URLs and API credentials must not enter tracebacks."""


def origin(url):
    try:
        if not isinstance(url, str) or any(ord(char) < 33 for char in url) or "\\" in url:
            raise ValueError()
        parsed = urlsplit(url)
        if parsed.scheme not in {"http", "https"} or not parsed.hostname or parsed.username is not None or parsed.password is not None:
            raise ValueError()
        host = parsed.hostname.rstrip(".").encode("idna").decode().lower()
        if "%" in host or host in METADATA_HOSTS:
            raise ValueError()
        port = parsed.port or (443 if parsed.scheme == "https" else 80)
        if not 0 < port < 65536:
            raise ValueError()
        try:
            address = ipaddress.ip_address(host)
        except ValueError:
            address = None
        if address is not None and forbidden_address(address):
            raise ValueError()
        return parsed.scheme, host, port
    except (ValueError, UnicodeError):
        raise HTTPPolicyError("media request target is not permitted") from None


def forbidden_address(address):
    address = address.ipv4_mapped if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped else address
    return address.is_link_local or address.is_unspecified or address.is_multicast or address in METADATA_IPS


def trusted_media_origins(provider=None):
    provider = provider or {}
    values = [provider.get("base_url"), provider.get("endpoint")]
    overrides = provider.get("endpoint_overrides")
    if isinstance(overrides, dict):
        values.extend(overrides.values())
    values.extend(os.getenv(key) for key in STORAGE_ORIGIN_SETTINGS)
    trusted = set()
    for value in values:
        if isinstance(value, str) and value.startswith(("https://", "http://")):
            try:
                trusted.add(origin(value))
            except HTTPPolicyError:
                continue
    return trusted


def close_response(response):
    close = getattr(response, "close", None)
    if callable(close):
        close()


def submission_redirected(response):
    return getattr(response, SUBMISSION_REDIRECT_FLAG, False) is True


def provider_request(method, url, *, allow_public_redirect=False, trusted_origins=(), credential_values=(), **kwargs):
    """Provider auth remains on the initial origin. Never replay a paid POST."""
    initial_origin = origin(url)
    method = method.upper()
    submitted = method not in {"GET", "HEAD"}
    for hop in range(MAX_MEDIA_REDIRECTS + 1):
        try:
            response = getattr(requests, method.lower())(url, allow_redirects=False, **kwargs)
        except requests.RequestException:
            if submitted and hop:
                # A subsequent GET connect failure does not mean the original
                # paid POST failed to connect. Preserve uncertain submission.
                raise HTTPPolicyError("provider submission redirect did not complete") from None
            raise
        if response.status_code not in REDIRECT_STATUSES:
            if submitted and hop:
                setattr(response, SUBMISSION_REDIRECT_FLAG, True)
            return response
        location = response.headers.get("Location") or response.headers.get("location")
        close_response(response)
        if not isinstance(location, str) or not location or hop == MAX_MEDIA_REDIRECTS:
            raise HTTPPolicyError("provider redirect limit or target is invalid")
        target = urljoin(url, location)
        target_origin = origin(target)
        if target_origin != initial_origin:
            if method == "GET" and allow_public_redirect:
                if initial_origin[0] == "https" and target_origin[0] == "http":
                    raise HTTPPolicyError("media HTTPS downgrade is not permitted")
                parsed = urlsplit(target)
                query = parse_qsl(parsed.query, keep_blank_values=True)
                filtered = [(key, value) for key, value in query if not value or value not in credential_values]
                if query != filtered:
                    target = urlunsplit(parsed._replace(query=urlencode(filtered)))
                # Brand new session: no Authorization, custom keys, cookies,
                # netrc, proxy credentials or original request parameters.
                return public_media_get(target, timeout=kwargs.get("timeout"), stream=kwargs.get("stream", False), trusted_origins=trusted_origins)
            raise HTTPPolicyError("provider cross-origin redirect is not permitted")
        if method not in {"GET", "HEAD"}:
            if response.status_code != 303 and not (method == "POST" and response.status_code in {301, 302}):
                raise HTTPPolicyError("provider redirect cannot replay a submission")
            method = "GET"
            kwargs = {key: value for key, value in kwargs.items() if key not in {"json", "data", "files", "params"}}
            kwargs["headers"] = {key: value for key, value in (kwargs.get("headers") or {}).items() if key.lower() not in {"content-type", "content-length", "transfer-encoding"}}
        url = target
    raise HTTPPolicyError("provider redirect limit exceeded")


def pinned_socket(connection, allow_private):
    """Resolve once, validate every answer, and connect only to checked IPs."""
    host = connection._dns_host
    try:
        addresses = socket.getaddrinfo(host, connection.port, type=socket.SOCK_STREAM)
    except OSError:
        raise NewConnectionError(connection, "media DNS lookup failed") from None
    if not addresses:
        raise NewConnectionError(connection, "media DNS lookup failed")
    for family, _, _, _, destination in addresses:
        try:
            address = ipaddress.ip_address(destination[0])
            effective = address.ipv4_mapped if isinstance(address, ipaddress.IPv6Address) and address.ipv4_mapped else address
            if forbidden_address(effective) or (not allow_private and (not effective.is_global or getattr(effective, "is_site_local", False))):
                raise ValueError()
        except ValueError:
            raise HTTPPolicyError("media request address is not permitted") from None
    # Use socket.connect with the vetted sockaddr; no second DNS lookup.
    last_timeout = False
    for family, socktype, protocol, _, destination in addresses:
        channel = socket.socket(family, socktype, protocol)
        try:
            channel.settimeout(connection.timeout)
            for option in connection.socket_options or ():
                channel.setsockopt(*option)
            channel.connect(destination)
            return channel
        except OSError as exc:
            last_timeout = isinstance(exc, socket.timeout)
            channel.close()
    if last_timeout:
        raise ConnectTimeoutError(connection, "media connection timed out") from None
    raise NewConnectionError(connection, "media connection failed") from None


class PinnedMediaAdapter(HTTPAdapter):
    def __init__(self, allow_private=False):
        self.allow_private = allow_private
        super().__init__(max_retries=0)

    def init_poolmanager(self, connections, maxsize, block=False, **pool_kwargs):
        allow_private = self.allow_private

        class PinnedHTTPConnection(HTTPConnection):
            def _new_conn(self):
                return pinned_socket(self, allow_private)

        class PinnedHTTPSConnection(HTTPSConnection):
            def _new_conn(self):
                # HTTPSConnection retains the original hostname for SNI and
                # certificate verification; only the TCP destination is pinned.
                return pinned_socket(self, allow_private)

        class PinnedHTTPPool(HTTPConnectionPool):
            ConnectionCls = PinnedHTTPConnection

        class PinnedHTTPSPool(HTTPSConnectionPool):
            ConnectionCls = PinnedHTTPSConnection

        self.poolmanager = PoolManager(num_pools=connections, maxsize=maxsize, block=block, **pool_kwargs)
        self.poolmanager.pool_classes_by_scheme = {"http": PinnedHTTPPool, "https": PinnedHTTPSPool}


def _send_public_once(url, *, trusted_origins=(), **kwargs):
    session = requests.Session()
    session.trust_env = False
    adapter = PinnedMediaAdapter(allow_private=origin(url) in trusted_origins)
    session.mount("http://", adapter)
    session.mount("https://", adapter)
    try:
        response = session.get(url, allow_redirects=False, **kwargs)
    except HTTPPolicyError:
        session.close()
        raise
    except requests.RequestException:
        session.close()
        # requests/urllib3 transport errors may embed signed URL query strings.
        raise requests.RequestException("media download connection failed") from None
    except Exception:
        session.close()
        raise
    original_close = response.close

    def close():
        try:
            original_close()
        finally:
            session.close()

    response.close = close
    return response


def public_media_get(url, *, timeout, stream=True, trusted_origins=()):
    previous = origin(url)
    for hop in range(MAX_MEDIA_REDIRECTS + 1):
        response = _send_public_once(url, trusted_origins=trusted_origins, timeout=timeout, stream=stream)
        if response.status_code not in REDIRECT_STATUSES:
            return response
        location = response.headers.get("Location") or response.headers.get("location")
        close_response(response)
        if not isinstance(location, str) or not location or hop == MAX_MEDIA_REDIRECTS:
            raise HTTPPolicyError("media redirect limit or target is invalid")
        url = urljoin(url, location)
        current = origin(url)
        if previous[0] == "https" and current[0] == "http":
            raise HTTPPolicyError("media HTTPS downgrade is not permitted")
        previous = current
    raise HTTPPolicyError("media redirect limit exceeded")

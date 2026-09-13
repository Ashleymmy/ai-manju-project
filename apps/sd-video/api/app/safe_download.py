"""下载不信任的 Provider 结果：公网 HTTPS、逐跳 DNS 校验并固定实际连接 IP。"""
import asyncio
import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urljoin, urlsplit

MAX_RESULT_BYTES = 512 * 1024 * 1024
MAX_REDIRECTS = 5


def resolve_target(url):
    parsed = urlsplit(url)
    if parsed.scheme != "https" or not parsed.hostname or parsed.username or parsed.password or parsed.port not in {None, 443}:
        raise ValueError("result requires public HTTPS")
    addresses = {item[4][0] for item in socket.getaddrinfo(parsed.hostname, 443, type=socket.SOCK_STREAM)}
    if not addresses or any(not ipaddress.ip_address(address).is_global for address in addresses):
        raise ValueError("result destination is not public")
    return parsed, sorted(addresses)[0]


class PinnedHTTPSConnection(http.client.HTTPSConnection):
    def __init__(self, host, address):
        super().__init__(host, timeout=60, context=ssl.create_default_context())
        self.address = address

    def connect(self):
        stream = socket.create_connection((self.address, 443), self.timeout)
        try:
            self.sock = self._context.wrap_socket(stream, server_hostname=self.host)
        except Exception:
            stream.close()
            raise


def _download(url):
    for redirect in range(MAX_REDIRECTS + 1):
        parsed, address = resolve_target(url)
        connection = PinnedHTTPSConnection(parsed.hostname, address)
        try:
            connection.request("GET", (parsed.path or "/") + ("?" + parsed.query if parsed.query else ""), headers={"Accept": "video/*,application/octet-stream"})
            response = connection.getresponse()
            if response.status in {301, 302, 303, 307, 308}:
                location = response.getheader("Location")
                if redirect == MAX_REDIRECTS or not location: raise ValueError("invalid result redirect")
                url = urljoin(url, location)
                continue
            if response.status != 200: raise ValueError("result download rejected")
            declared = response.getheader("Content-Length")
            if declared and int(declared) > MAX_RESULT_BYTES: raise ValueError("result too large")
            chunks, size = [], 0
            while chunk := response.read(1024 * 1024):
                size += len(chunk)
                if size > MAX_RESULT_BYTES: raise ValueError("result too large")
                chunks.append(chunk)
            body = b"".join(chunks)
            if not body: raise ValueError("empty result")
            return body
        finally:
            connection.close()
    raise ValueError("too many result redirects")


async def download_result(url):
    return await asyncio.to_thread(_download, url)

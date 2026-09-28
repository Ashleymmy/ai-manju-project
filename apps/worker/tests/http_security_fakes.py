"""Keep adapter contract tests offline; transport policy has its own test suite."""
import requests


def fake_public_send(url, *, trusted_origins=(), **kwargs):
    return requests.get(url, **kwargs)

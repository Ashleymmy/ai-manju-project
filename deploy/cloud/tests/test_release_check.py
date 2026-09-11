import copy
import importlib.util
from pathlib import Path
import unittest

spec = importlib.util.spec_from_file_location("release_check", Path(__file__).resolve().parents[1] / "check-release.py")
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


def valid_config():
    services = {name: {
        "image": "registry.test/studio@sha256:" + "a" * 64,
        "healthcheck": {"test": ["CMD", "health"]},
        "mem_limit": 128 * 1024 * 1024,
    } for name in release.SERVICES}
    for name in release.APPLICATIONS:
        services[name].update(read_only=True, env_file=[{"path": f"/config/{name}.env"}])
    services["worker"]["command"] = ["python", "-m", "worker.runtime"]
    services["edge"].update(ports=[{"published": "443", "target": 443}], environment={"STUDIO_DOMAIN": "studio.test"})
    return {"services": services, "networks": {name: {"internal": True} for name in ("studio-private", "sdvideo-private", "service-link")}}


class ReleaseCheckTest(unittest.TestCase):
    def test_valid_structure_is_only_static_success(self):
        self.assertEqual(release.inspect_release(valid_config()), [])

    def test_unpinned_images_builds_and_missing_health_block_release(self):
        for field, value, expected in (("image", "worker:latest", "digest"),
                                        ("build", {"context": "."}, "build"),
                                        ("healthcheck", {"disable": True}, "healthcheck")):
            config = valid_config()
            config["services"]["worker"][field] = value
            self.assertTrue(any(expected in error for error in release.inspect_release(config)))

    def test_private_services_never_publish_host_ports(self):
        config = valid_config()
        config["services"]["sd-video-postgres"]["ports"] = [{"published": "5432", "target": 5432}]
        self.assertIn("sd-video-postgres: only edge may publish host ports", release.inspect_release(config))

    def test_http_or_unconfigured_domain_is_rejected(self):
        config = valid_config()
        config["services"]["edge"]["ports"][0]["published"] = "80"
        config["services"]["edge"]["environment"]["STUDIO_DOMAIN"] = "studio.example.invalid"
        self.assertEqual(len(release.inspect_release(config)), 2)

    def test_video_failure_must_not_block_studio(self):
        config = valid_config()
        config["services"]["api"]["depends_on"] = {"sd-video-api": {"condition": "service_healthy"}}
        self.assertTrue(any("non-video startup" in error for error in release.inspect_release(config)))

    def test_shared_env_and_unsupervised_worker_are_rejected(self):
        config = valid_config()
        config["services"]["sd-video-api"]["env_file"] = copy.deepcopy(config["services"]["api"]["env_file"])
        config["services"]["worker"]["command"] = ["sh", "-c", "health & celery"]
        errors = release.inspect_release(config)
        self.assertTrue(any("share a runtime" in error for error in errors))
        self.assertTrue(any("supervised" in error for error in errors))

    def test_errors_never_echo_parameter_values(self):
        config = valid_config()
        config["services"]["api"]["image"] = "private-parameter-secret"
        self.assertNotIn("private-parameter-secret", "\n".join(release.inspect_release(config)))

    def test_required_service_and_private_network_are_enforced(self):
        config = valid_config()
        del config["services"]["sd-video-bridge"]
        config["networks"]["sdvideo-private"]["internal"] = False
        self.assertEqual(len(release.inspect_release(config)), 2)


if __name__ == "__main__":
    unittest.main()

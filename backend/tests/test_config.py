from pathlib import Path

import pytest


@pytest.mark.parametrize("workflow_dir", ["/workflows", None])
def test_config_import_from_container_path(monkeypatch, tmp_path, workflow_dir):
    monkeypatch.setenv("DATA_DIR", str(tmp_path))
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ADMIN_PASSWORD", "test-password-only")
    monkeypatch.setenv("SESSION_SECRET", "test-secret-not-for-production-123456789")
    if workflow_dir:
        monkeypatch.setenv("WORKFLOW_DIR", workflow_dir)
    else:
        monkeypatch.delenv("WORKFLOW_DIR", raising=False)
    source = (Path(__file__).resolve().parents[1] / "app" / "config.py").read_text()
    namespace = {"__file__": "/app/app/config.py"}
    exec(compile(source, namespace["__file__"], "exec"), namespace)
    assert namespace["WORKFLOWS"] == Path(workflow_dir or "/workflows")
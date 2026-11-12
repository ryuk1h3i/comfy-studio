import os
import tempfile

_temporary = tempfile.TemporaryDirectory(prefix="studio-tests-")
os.environ["DATA_DIR"] = _temporary.name
os.environ["DATABASE_URL"] = os.getenv("TEST_DATABASE_URL", f"sqlite:///{_temporary.name}/test.db")
os.environ["ENVIRONMENT"] = "development"
os.environ["ADMIN_PASSWORD"] = "test-password"
os.environ["SESSION_SECRET"] = "test-session-secret-not-for-production-123456"


def pytest_sessionfinish(session, exitstatus):
    _temporary.cleanup()
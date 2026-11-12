import base64
import numpy as np
import pytest
from app.ml import similarity, vector


def test_embedding_formats_and_invalid_values():
    values = np.ones(32, dtype="<f4")
    assert vector(values.tolist()) == vector(base64.b64encode(values.tobytes()).decode())
    assert similarity(vector(values), vector(values)) == pytest.approx(1)
    for bad in ([0] * 32, [float("nan")] * 32, [1, 2], "invalid"):
        with pytest.raises((ValueError, TypeError)):
            vector(bad)
    with pytest.raises(ValueError):
        similarity([1] * 32, [1] * 64)
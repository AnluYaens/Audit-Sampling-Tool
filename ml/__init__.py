"""
Utility helpers for the anomaly-detection pipeline.

The Flask app imports this package to reuse the same preprocessing logic that
the offline training script uses, ensuring feature parity between both flows.
"""

from .features import (  # noqa: F401
    CATEGORICAL_FEATURES,
    FEATURE_COLUMNS,
    NUMERIC_FEATURES,
    REQUIRED_RAW_COLUMNS,
    prepare_features,
)

__all__ = [
    "prepare_features",
    "NUMERIC_FEATURES",
    "CATEGORICAL_FEATURES",
    "FEATURE_COLUMNS",
    "REQUIRED_RAW_COLUMNS",
]

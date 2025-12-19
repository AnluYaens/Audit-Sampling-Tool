from __future__ import annotations

from typing import Iterable

import numpy as np
import pandas as pd

# Feature definitions shared between the offline trainer and the Flask API.
NUMERIC_FEATURES = [
    "amount",
    "log_amount",
    "day_of_week",
    "month",
    "is_month_end",
    "doc_age_days",
    "vendor_txn_freq",
    "dept_txn_freq",
    "vendor_avg_amount",
    "dept_avg_amount",
    "vendor_amount_ratio",
    "dept_amount_ratio",
    "global_amount_zscore",
]
CATEGORICAL_FEATURES = ["vendor", "department"]
FEATURE_COLUMNS = NUMERIC_FEATURES + CATEGORICAL_FEATURES
REQUIRED_RAW_COLUMNS = ["date", "amount", "vendor", "department"]

UNKNOWN_VENDOR = "Unknown Vendor"
UNKNOWN_DEPARTMENT = "Unknown Department"


def _ensure_columns(frame: pd.DataFrame, columns: Iterable[str]) -> None:
    """Ensure raw columns exist so downstream code can rely on them."""
    for column in columns:
        if column not in frame.columns:
            frame[column] = np.nan


def _safe_doc_age_days(dates: pd.Series) -> pd.Series:
    """Return document age in days, clipping negatives for future-dated rows."""
    today = pd.Timestamp.now(tz="UTC").normalize()
    delta_days = (today - dates).dt.days
    return delta_days.fillna(0).clip(lower=0).astype(int)


def _safe_ratio(numerator: pd.Series, denominator: pd.Series) -> pd.Series:
    with np.errstate(divide="ignore", invalid="ignore"):
        ratio = numerator / denominator.replace(0, np.nan)
    ratio = ratio.replace([np.inf, -np.inf], np.nan).fillna(0.0)
    return ratio.astype(float)


def prepare_features(data: pd.DataFrame) -> pd.DataFrame:
    """Return a feature frame aligned with FEATURE_COLUMNS."""
    if data.empty:
        return pd.DataFrame(columns=FEATURE_COLUMNS)

    frame = data.copy()
    _ensure_columns(frame, REQUIRED_RAW_COLUMNS)

    frame["amount"] = pd.to_numeric(frame["amount"], errors="coerce").fillna(0.0)
    frame["vendor"] = frame["vendor"].fillna(UNKNOWN_VENDOR).astype(str)
    frame["department"] = frame["department"].fillna(UNKNOWN_DEPARTMENT).astype(str)
    frame["txn_date"] = pd.to_datetime(frame["date"], errors="coerce", utc=True)

    features = pd.DataFrame(index=frame.index)
    features["amount"] = frame["amount"].astype(float)
    features["log_amount"] = np.log1p(frame["amount"].clip(lower=0))
    features["day_of_week"] = frame["txn_date"].dt.dayofweek.fillna(-1).astype(int)
    features["month"] = frame["txn_date"].dt.month.fillna(0).astype(int)
    features["is_month_end"] = (
        frame["txn_date"].dt.is_month_end.fillna(False).astype(int)
    )
    features["doc_age_days"] = _safe_doc_age_days(frame["txn_date"])
    vendor_groups = frame.groupby("vendor")["amount"]
    dept_groups = frame.groupby("department")["amount"]
    features["vendor_txn_freq"] = vendor_groups.transform("count").fillna(0.0)
    features["dept_txn_freq"] = dept_groups.transform("count").fillna(0.0)
    features["vendor_avg_amount"] = vendor_groups.transform("mean").fillna(0.0)
    features["dept_avg_amount"] = dept_groups.transform("mean").fillna(0.0)
    features["vendor_amount_ratio"] = _safe_ratio(
        frame["amount"], features["vendor_avg_amount"]
    )
    features["dept_amount_ratio"] = _safe_ratio(
        frame["amount"], features["dept_avg_amount"]
    )
    overall_mean = frame["amount"].mean()
    overall_std = frame["amount"].std(ddof=0)
    denom = overall_std if overall_std and overall_std > 1e-9 else 1.0
    features["global_amount_zscore"] = ((frame["amount"] - overall_mean) / denom).fillna(
        0.0
    )
    features["vendor"] = frame["vendor"]
    features["department"] = frame["department"]

    return features[FEATURE_COLUMNS]

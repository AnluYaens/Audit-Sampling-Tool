#!/usr/bin/env python
"""Train and persist the Isolation Forest model used by the Flask API."""
from __future__ import annotations

import argparse
import json
from datetime import datetime
from pathlib import Path
from typing import Tuple

import numpy as np
import pandas as pd
from joblib import dump
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import IsolationForest
from sklearn.metrics import classification_report, roc_auc_score
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

from ml import (
    CATEGORICAL_FEATURES,
    FEATURE_COLUMNS,
    NUMERIC_FEATURES,
    prepare_features,
)

LABEL_COLUMN = "label"
ROOT_DIR = Path(__file__).resolve().parents[1]
DEFAULT_DATA = ROOT_DIR / "backend" / "data" / "historical_transactions.csv"
DEFAULT_MODEL_DIR = Path(__file__).resolve().parent / "models"


def encode_labels(series: pd.Series) -> pd.Series:
    mapping = {"normal": 0, "0": 0, "false": 0, "anomaly": 1, "1": 1, "true": 1}

    def _encode(value) -> int:
        if isinstance(value, (int, float)):
            return int(value > 0)
        if isinstance(value, str):
            key = value.strip().lower()
            if key in mapping:
                return mapping[key]
        return 0

    return series.map(_encode).astype(int)


def load_dataset(path: Path) -> pd.DataFrame:
    if not path.exists():
        raise FileNotFoundError(f"Dataset not found: {path}")
    raw = pd.read_csv(path)
    labels = (
        encode_labels(raw[LABEL_COLUMN])
        if LABEL_COLUMN in raw.columns
        else pd.Series(0, index=raw.index, dtype=int)
    )
    features = prepare_features(raw)
    if features.empty:
        raise ValueError("Dataset produced no feature rows. Check CSV contents.")
    features["_label"] = labels.reindex(features.index, fill_value=0).astype(int)
    return features


def build_pipeline(contamination: float, seed: int) -> Pipeline:
    preprocess = ColumnTransformer(
        [
            ("num", StandardScaler(), NUMERIC_FEATURES),
            (
                "cat",
                OneHotEncoder(handle_unknown="ignore", sparse_output=False),
                CATEGORICAL_FEATURES,
            ),
        ]
    )
    forest = IsolationForest(
        n_estimators=400,
        max_samples=0.9,
        contamination=contamination,
        random_state=seed,
        n_jobs=-1,
    )
    return Pipeline([("preprocess", preprocess), ("model", forest)])


def split_validation_sets(
    dataset: pd.DataFrame, val_size: float, seed: int
) -> Tuple[pd.DataFrame, pd.DataFrame]:
    normals = dataset[dataset["_label"] == 0]
    anomalies = dataset[dataset["_label"] == 1]
    if normals.empty:
        raise ValueError("Dataset requires at least one normal row to train.")
    train_normals, val_normals = train_test_split(
        normals, test_size=val_size, random_state=seed
    )
    if anomalies.empty:
        return train_normals, val_normals
    validation = pd.concat([val_normals, anomalies], ignore_index=True)
    return train_normals, validation


def evaluate_model(
    pipeline: Pipeline, validation: pd.DataFrame, threshold: float
) -> None:
    labels = validation["_label"].to_numpy(dtype=int)
    if not labels.any():
        print("No labeled anomalies available for validation. Skipping metrics.")
        return
    feature_columns = FEATURE_COLUMNS
    scores = pipeline.decision_function(validation[feature_columns])
    predictions = (scores < threshold).astype(int)
    print("=== Validation Metrics (normals vs anomalies) ===")
    print(classification_report(labels, predictions, digits=4))
    try:
        auc = roc_auc_score(labels, scores)
        print(f"ROC AUC: {auc:.4f}")
    except ValueError as exc:
        print(f"ROC AUC unavailable: {exc}")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Train an Isolation Forest model for anomaly detection."
    )
    parser.add_argument("--data", type=Path, default=DEFAULT_DATA)
    parser.add_argument("--model-dir", type=Path, default=DEFAULT_MODEL_DIR)
    parser.add_argument("--contamination", type=float, default=0.03)
    parser.add_argument("--seed", type=int, default=42)
    parser.add_argument(
        "--val-size",
        type=float,
        default=0.2,
        help="Fraction of normal rows reserved for validation metrics.",
    )
    args = parser.parse_args()
    if not 0 < args.contamination <= 0.3:
        parser.error("--contamination must be within (0, 0.3].")
    if not 0 < args.val_size < 1:
        parser.error("--val-size must be within (0, 1).")
    return args


def main() -> None:
    args = parse_args()
    dataset = load_dataset(args.data)
    train_normals, validation = split_validation_sets(dataset, args.val_size, args.seed)
    pipeline = build_pipeline(args.contamination, args.seed)
    feature_columns = FEATURE_COLUMNS

    pipeline.fit(train_normals[feature_columns])
    train_scores = pipeline.decision_function(train_normals[feature_columns])
    threshold = float(np.quantile(train_scores, args.contamination))

    evaluate_model(pipeline, validation, threshold)

    args.model_dir.mkdir(parents=True, exist_ok=True)
    model_path = args.model_dir / "isolation_forest.joblib"
    dump(pipeline, model_path)
    metadata = {
        "trained_at": datetime.utcnow().isoformat(timespec="seconds"),
        "dataset": str(args.data),
        "contamination": args.contamination,
        "threshold": threshold,
        "features": feature_columns,
        "training_rows": int(len(train_normals)),
        "validation_rows": int(len(validation)),
        "validation_anomalies": int(validation["_label"].sum()),
    }
    (args.model_dir / "isolation_forest.json").write_text(json.dumps(metadata, indent=2))
    print(f"Saved model to {model_path}")


if __name__ == "__main__":
    main()

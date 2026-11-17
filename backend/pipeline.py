import json
import os
import tempfile
import threading
from datetime import datetime, timezone
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from sklearn.compose import ColumnTransformer
from sklearn.ensemble import RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.metrics import (
    accuracy_score,
    f1_score,
    precision_score,
    recall_score,
    roc_auc_score,
)
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import OneHotEncoder, StandardScaler

MODEL_PATH = Path(__file__).parent / "model.joblib"
METRICS_PATH = Path(__file__).parent / "metrics.json"

NUMERIC_FEATURES = ["Age", "RestingBP", "Cholesterol", "FastingBS", "MaxHR", "Oldpeak"]
CATEGORICAL_FEATURES = ["Sex", "ChestPainType", "RestingECG", "ExerciseAngina", "ST_Slope"]

EXPECTED_COLUMNS = [
    "Age",
    "Sex",
    "ChestPainType",
    "RestingBP",
    "Cholesterol",
    "FastingBS",
    "RestingECG",
    "MaxHR",
    "ExerciseAngina",
    "Oldpeak",
    "ST_Slope",
]

# In the UCI heart dataset a value of 0 for these columns is a placeholder for
# "not measured" (172 rows have Cholesterol == 0), not a real reading. Treating
# them as missing lets the imputer handle them instead of teaching the model
# that "0 cholesterol" is a medical signal.
ZERO_MEANS_MISSING = ["Cholesterol", "RestingBP"]

_lock = threading.Lock()
_model_cache = {"mtime": None, "model": None}


def _clean(df: pd.DataFrame) -> pd.DataFrame:
    """Coerce types and mask placeholder zeros so train and predict agree."""
    df = df[EXPECTED_COLUMNS].copy()
    for col in NUMERIC_FEATURES:
        df[col] = pd.to_numeric(df[col], errors="coerce")
    for col in ZERO_MEANS_MISSING:
        df.loc[df[col] == 0, col] = np.nan
    for col in CATEGORICAL_FEATURES:
        df[col] = df[col].astype("string").str.strip()
    return df


def build_pipeline():
    numeric_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="median")),
        ("scaler", StandardScaler()),
    ])

    categorical_transformer = Pipeline(steps=[
        ("imputer", SimpleImputer(strategy="most_frequent")),
        ("onehot", OneHotEncoder(handle_unknown="ignore")),
    ])

    preprocessor = ColumnTransformer(
        transformers=[
            ("num", numeric_transformer, NUMERIC_FEATURES),
            ("cat", categorical_transformer, CATEGORICAL_FEATURES),
        ]
    )

    return Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("classifier", RandomForestClassifier(n_estimators=200, random_state=42, n_jobs=1)),
    ])


def _feature_importances(model) -> dict:
    """Aggregate one-hot importances back onto the original input columns."""
    names = model.named_steps["preprocessor"].get_feature_names_out()
    values = model.named_steps["classifier"].feature_importances_
    totals = {col: 0.0 for col in EXPECTED_COLUMNS}
    for name, value in zip(names, values):
        # names look like "num__Age" or "cat__ChestPainType_ASY"
        _, _, rest = name.partition("__")
        for col in EXPECTED_COLUMNS:
            if rest == col or rest.startswith(col + "_"):
                totals[col] += float(value)
                break
    return dict(sorted(totals.items(), key=lambda kv: kv[1], reverse=True))


def train_from_csv(csv_path: str | Path, val_size: float = 0.2, random_state: int = 42):
    """Train a model from a CSV file path using a train/validation split.

    Returns a dict with training and validation metrics and model path.
    """
    df = pd.read_csv(csv_path)
    missing = [c for c in EXPECTED_COLUMNS + ["HeartDisease"] if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in CSV: {missing}")

    df = df.dropna(subset=["HeartDisease"])
    y = pd.to_numeric(df["HeartDisease"], errors="coerce")
    if y.isna().any():
        raise ValueError("HeartDisease column must contain only 0/1 values")
    y = y.astype(int)
    if set(y.unique()) - {0, 1}:
        raise ValueError("HeartDisease column must contain only 0/1 values")
    if y.nunique() < 2:
        raise ValueError("HeartDisease column must contain both classes (0 and 1)")
    if len(df) < 20:
        raise ValueError("Need at least 20 rows to train a model")
    if not 0.05 <= val_size <= 0.5:
        raise ValueError("val_size must be between 0.05 and 0.5")

    X = _clean(df)

    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=val_size, random_state=random_state, stratify=y
    )

    model = build_pipeline()
    model.fit(X_train, y_train)

    train_pred = model.predict(X_train)
    val_pred = model.predict(X_val)

    results = {
        "train_accuracy": float(accuracy_score(y_train, train_pred)),
        "val_accuracy": float(accuracy_score(y_val, val_pred)),
        "val_precision": float(precision_score(y_val, val_pred, zero_division=0)),
        "val_recall": float(recall_score(y_val, val_pred, zero_division=0)),
        "val_f1": float(f1_score(y_val, val_pred, zero_division=0)),
        "val_roc_auc": None,
    }
    try:
        results["val_roc_auc"] = float(roc_auc_score(y_val, model.predict_proba(X_val)[:, 1]))
    except Exception:
        pass

    results["model_path"] = str(MODEL_PATH)
    results["val_size"] = float(val_size)
    results["n_samples"] = int(len(df))
    results["n_train"] = int(len(X_train))
    results["n_val"] = int(len(X_val))
    results["feature_importances"] = _feature_importances(model)
    results["trained_at"] = datetime.now(timezone.utc).isoformat()

    # Write atomically so a concurrent /predict never reads a half-written file.
    with _lock:
        fd, tmp_model = tempfile.mkstemp(suffix=".tmp", dir=MODEL_PATH.parent)
        os.close(fd)
        try:
            joblib.dump(model, tmp_model)
            os.replace(tmp_model, MODEL_PATH)
        finally:
            if os.path.exists(tmp_model):
                os.remove(tmp_model)
        METRICS_PATH.write_text(json.dumps(results, indent=2), encoding="utf-8")
        _model_cache.update(mtime=None, model=None)
    return results


def load_model():
    """Load the model from disk, re-reading only when the file has changed."""
    if not MODEL_PATH.exists():
        return None
    mtime = MODEL_PATH.stat().st_mtime
    with _lock:
        if _model_cache["model"] is None or _model_cache["mtime"] != mtime:
            _model_cache["model"] = joblib.load(MODEL_PATH)
            _model_cache["mtime"] = mtime
        return _model_cache["model"]


def load_metrics():
    if not METRICS_PATH.exists():
        return None
    try:
        return json.loads(METRICS_PATH.read_text(encoding="utf-8"))
    except (OSError, ValueError):
        return None


def model_ready() -> bool:
    return MODEL_PATH.exists()


class ModelNotTrainedError(RuntimeError):
    pass


def predict_one(payload: dict):
    """Accepts a dict with EXPECTED_COLUMNS and returns prediction and proba."""
    model = load_model()
    if model is None:
        raise ModelNotTrainedError("Model not found. Train the model first.")

    df = _clean(pd.DataFrame([{k: payload.get(k) for k in EXPECTED_COLUMNS}]))
    proba = float(model.predict_proba(df)[0][1])
    return {"prediction": int(proba > 0.5), "probability": proba}

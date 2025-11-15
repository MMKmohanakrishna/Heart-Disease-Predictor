import pandas as pd
import joblib
from pathlib import Path
from sklearn.pipeline import Pipeline
from sklearn.compose import ColumnTransformer
from sklearn.preprocessing import OneHotEncoder, StandardScaler
from sklearn.impute import SimpleImputer
from sklearn.ensemble import RandomForestClassifier
from sklearn.model_selection import train_test_split
from sklearn.metrics import accuracy_score, precision_score, recall_score, f1_score, roc_auc_score

MODEL_PATH = Path(__file__).parent / "model.joblib"

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


def build_pipeline():
    # numeric and categorical feature lists
    numeric_features = ["Age", "RestingBP", "Cholesterol", "FastingBS", "MaxHR", "Oldpeak"]
    categorical_features = ["Sex", "ChestPainType", "RestingECG", "ExerciseAngina", "ST_Slope"]

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
            ("num", numeric_transformer, numeric_features),
            ("cat", categorical_transformer, categorical_features),
        ]
    )

    clf = Pipeline(steps=[
        ("preprocessor", preprocessor),
        ("classifier", RandomForestClassifier(n_estimators=100, random_state=42)),
    ])
    return clf


def train_from_csv(csv_path: str | Path, val_size: float = 0.2, random_state: int = 42):
    """Train a model from a CSV file path using a train/validation split.

    Returns a dict with training and validation metrics and model path.
    """
    df = pd.read_csv(csv_path)
    # ensure expected columns exist
    missing = [c for c in EXPECTED_COLUMNS + ["HeartDisease"] if c not in df.columns]
    if missing:
        raise ValueError(f"Missing columns in CSV: {missing}")

    X = df[EXPECTED_COLUMNS].copy()
    y = df["HeartDisease"].astype(int)

    # split
    X_train, X_val, y_train, y_val = train_test_split(
        X, y, test_size=val_size, random_state=random_state, stratify=y if len(y.unique())>1 else None
    )

    model = build_pipeline()
    model.fit(X_train, y_train)

    joblib.dump(model, MODEL_PATH)

    # compute metrics
    train_pred = model.predict(X_train)
    val_pred = model.predict(X_val)

    results = {}
    results["train_accuracy"] = float(accuracy_score(y_train, train_pred))
    results["val_accuracy"] = float(accuracy_score(y_val, val_pred))
    results["val_precision"] = float(precision_score(y_val, val_pred, zero_division=0))
    results["val_recall"] = float(recall_score(y_val, val_pred, zero_division=0))
    results["val_f1"] = float(f1_score(y_val, val_pred, zero_division=0))

    # roc auc if possible
    try:
        if hasattr(model, "predict_proba"):
            val_proba = model.predict_proba(X_val)[:, 1]
            results["val_roc_auc"] = float(roc_auc_score(y_val, val_proba))
    except Exception:
        results["val_roc_auc"] = None

    results["model_path"] = str(MODEL_PATH)
    results["val_size"] = float(val_size)
    return results


def load_model():
    if MODEL_PATH.exists():
        return joblib.load(MODEL_PATH)
    return None


def predict_one(payload: dict):
    """Accepts a dict with EXPECTED_COLUMNS and returns prediction and proba."""
    model = load_model()
    if model is None:
        raise RuntimeError("Model not found. Train the model first.")

    # build a single-row DataFrame
    row = {k: payload.get(k) for k in EXPECTED_COLUMNS}
    df = pd.DataFrame([row])
    pred = model.predict(df)[0]
    proba = None
    if hasattr(model, "predict_proba"):
        proba = float(model.predict_proba(df)[0][1])
    return {"prediction": int(pred), "probability": proba}

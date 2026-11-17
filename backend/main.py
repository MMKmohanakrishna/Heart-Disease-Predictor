import logging
import os
import tempfile
from contextlib import asynccontextmanager
from pathlib import Path
from typing import Literal

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.concurrency import run_in_threadpool
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from backend.pipeline import (
    EXPECTED_COLUMNS,
    ModelNotTrainedError,
    load_metrics,
    model_ready,
    predict_one,
    train_from_csv,
)

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("heart_api")

DATA_PATH = Path(__file__).parent.parent / "heart.csv"
MAX_UPLOAD_BYTES = 5 * 1024 * 1024  # 5 MB


@asynccontextmanager
async def lifespan(app: FastAPI):
    # On a fresh checkout there is no model.joblib (it is git-ignored), so train
    # one from the bundled dataset instead of failing every /predict call.
    if not model_ready() and DATA_PATH.exists():
        logger.info("No trained model found - training on bundled heart.csv")
        try:
            await run_in_threadpool(train_from_csv, DATA_PATH)
        except Exception:
            logger.exception("Automatic first-run training failed")
    yield


app = FastAPI(title="Heart Disease Predictor API", lifespan=lifespan)

# Credentials are not used, so wildcard origins are safe (and the spec forbids
# combining "*" with allow_credentials=True).
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


class PredictRequest(BaseModel):
    Age: float = Field(ge=1, le=120)
    Sex: Literal["M", "F"]
    ChestPainType: Literal["ATA", "NAP", "ASY", "TA"]
    RestingBP: float = Field(ge=0, le=300)
    Cholesterol: float = Field(ge=0, le=1000)
    FastingBS: Literal[0, 1]
    RestingECG: Literal["Normal", "ST", "LVH"]
    MaxHR: float = Field(ge=30, le=250)
    ExerciseAngina: Literal["Y", "N"]
    Oldpeak: float = Field(ge=-5, le=10)
    ST_Slope: Literal["Up", "Flat", "Down"]


@app.post("/train")
async def train(
    request: Request,
    file: UploadFile | None = File(None),
    val_size: float = Form(0.2),
    random_state: int = Form(42),
    train_secret: str | None = Form(None),
):
    """Train the model. Optionally upload a CSV file (multipart).

    Accepts optional form fields `val_size` (float), `random_state` (int), and `train_secret` (str).
    If no file provided, uses project's `heart.csv`.
    """
    client = request.client.host if request.client else "unknown"

    # Optional: require a secret token if TRAIN_SECRET env var is set
    expected_secret = os.getenv("TRAIN_SECRET")
    if expected_secret and train_secret != expected_secret:
        logger.warning("/train: invalid or missing secret from %s", client)
        raise HTTPException(status_code=403, detail="Invalid or missing admin token")

    if not 0.05 <= val_size <= 0.5:
        raise HTTPException(status_code=400, detail="val_size must be between 0.05 and 0.5")

    logger.info("/train from %s val_size=%s random_state=%s file=%s",
                client, val_size, random_state, getattr(file, "filename", None))

    tmp_path: Path | None = None
    csv_path = DATA_PATH
    try:
        if file is not None and file.filename:
            if not file.filename.lower().endswith(".csv"):
                raise HTTPException(status_code=400, detail="File must have a .csv extension")

            content = await file.read(MAX_UPLOAD_BYTES + 1)
            if len(content) > MAX_UPLOAD_BYTES:
                raise HTTPException(status_code=400, detail="File too large. Maximum: 5 MB")

            # Never write the client-supplied filename to disk: it could escape the
            # project directory or overwrite the bundled heart.csv.
            fd, name = tempfile.mkstemp(suffix=".csv")
            tmp_path = Path(name)
            with os.fdopen(fd, "wb") as out:
                out.write(content)
            csv_path = tmp_path

        try:
            return await run_in_threadpool(train_from_csv, csv_path, val_size, random_state)
        except ValueError as e:
            logger.error("Training validation error: %s", e)
            raise HTTPException(status_code=400, detail=str(e))
        except Exception as e:
            logger.exception("Training failed")
            raise HTTPException(status_code=500, detail=f"Training failed: {e}")
    finally:
        if tmp_path is not None and tmp_path.exists():
            tmp_path.unlink()


@app.post("/predict")
async def predict(req: PredictRequest):
    payload = req.model_dump()
    missing = [c for c in EXPECTED_COLUMNS if c not in payload]
    if missing:
        raise HTTPException(status_code=400, detail={"missing": missing})

    try:
        return await run_in_threadpool(predict_one, payload)
    except ModelNotTrainedError as e:
        raise HTTPException(status_code=409, detail=str(e))
    except Exception as e:
        logger.exception("Prediction failed")
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/status")
def status():
    """Model readiness plus the metrics of the most recent training run."""
    return {"model_ready": model_ready(), "metrics": load_metrics()}


@app.get("/health")
def health():
    return {"status": "ok"}

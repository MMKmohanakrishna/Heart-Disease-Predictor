import logging
from fastapi import FastAPI, UploadFile, File, HTTPException, Form, Request
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from pathlib import Path
import shutil

from backend.pipeline import train_from_csv, predict_one, EXPECTED_COLUMNS

app = FastAPI(title="Heart Disease Predictor API")

# simple logging to stdout for debugging requests
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("heart_api")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

DATA_PATH = Path(__file__).parent.parent / "heart.csv"


class PredictRequest(BaseModel):
    Age: float
    Sex: str
    ChestPainType: str
    RestingBP: float
    Cholesterol: float
    FastingBS: float
    RestingECG: str
    MaxHR: float
    ExerciseAngina: str
    Oldpeak: float
    ST_Slope: str


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
    import os
    
    # Optional: Check secret token if TRAIN_SECRET env var is set
    expected_secret = os.getenv("TRAIN_SECRET")
    if expected_secret and train_secret != expected_secret:
        logger.warning(f"/train: Invalid or missing secret from {request.client.host}")
        raise HTTPException(status_code=403, detail="Invalid or missing admin token")
    
    logger.info(f"/train called from {request.client.host}:{request.client.port} val_size={val_size} random_state={random_state} file={getattr(file,'filename',None)}")
    
    csv_path = DATA_PATH
    if file is not None:
        # Validate file
        MAX_SIZE = 5 * 1024 * 1024  # 5 MB
        
        # Check content type
        if file.content_type and 'csv' not in file.content_type and 'text' not in file.content_type:
            raise HTTPException(status_code=400, detail=f"Invalid file type: {file.content_type}. Expected CSV.")
        
        # Check file extension
        if not file.filename.lower().endswith('.csv'):
            raise HTTPException(status_code=400, detail="File must have .csv extension")
        
        # save uploaded file to project root
        saved = Path(__file__).parent.parent / file.filename
        try:
            content = await file.read()
            
            # Check size
            if len(content) > MAX_SIZE:
                raise HTTPException(status_code=400, detail=f"File too large ({len(content)/1024/1024:.1f} MB). Maximum: 5 MB")
            
            with saved.open("wb") as out:
                out.write(content)
            csv_path = saved
            logger.info(f"Saved uploaded file to {saved} (size={len(content)} bytes)")
        except HTTPException:
            raise
        except Exception as e:
            logger.exception("Failed saving uploaded file")
            raise HTTPException(status_code=500, detail=f"Failed to save uploaded file: {e}")

    try:
        result = train_from_csv(csv_path, val_size=val_size, random_state=random_state)
        logger.info(f"Training complete: {result}")
    except ValueError as e:
        logger.error(f"Training validation error: {e}")
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        logger.exception("Training failed")
        raise HTTPException(status_code=500, detail=f"Training failed: {str(e)}")
    return result


@app.post("/predict")
async def predict(req: PredictRequest):
    payload = req.dict()
    # ensure keys present
    missing = [c for c in EXPECTED_COLUMNS if c not in payload]
    if missing:
        raise HTTPException(status_code=400, detail={"missing": missing})

    try:
        out = predict_one(payload)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return out


@app.get("/health")
def health():
    return {"status": "ok"}

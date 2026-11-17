# Quick start script for Heart Disease Predictor
# This script starts both backend and frontend servers

Write-Host "`n=== Heart Disease Predictor - Quick Start ===`n" -ForegroundColor Cyan

# Check if venv exists
if (-not (Test-Path ".\.venv\Scripts\python.exe")) {
    Write-Host "Virtual environment not found. Creating it now..." -ForegroundColor Yellow
    python -m venv .venv
    Write-Host "Installing dependencies..." -ForegroundColor Yellow
    .\.venv\Scripts\pip.exe install -r backend\requirements.txt
}

Write-Host "[OK] Environment ready" -ForegroundColor Green

# Start both servers from the project root so `backend.main` imports correctly.
$python = (Resolve-Path ".\.venv\Scripts\python.exe").Path
Write-Host "`nStarting backend server..." -ForegroundColor Cyan
$backendJob = Start-Process -FilePath $python -ArgumentList @("-m", "uvicorn", "backend.main:app", "--reload", "--host", "127.0.0.1", "--port", "8000") -WorkingDirectory "$PWD" -PassThru

Start-Sleep -Seconds 2

Write-Host "Starting frontend server..." -ForegroundColor Cyan
$frontendJob = Start-Process -FilePath $python -ArgumentList @("-X", "utf8", "serve_frontend.py") -WorkingDirectory "$PWD" -PassThru

Start-Sleep -Seconds 2

Write-Host "`n=== Servers Started Successfully! ===`n" -ForegroundColor Green
Write-Host "Backend:  http://127.0.0.1:8000" -ForegroundColor White
Write-Host "Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "`nOpening browser..." -ForegroundColor Cyan

Start-Sleep -Seconds 1
Start-Process "http://localhost:3000"

Write-Host "`n[OK] Application ready!" -ForegroundColor Green
Write-Host "  Close the PowerShell windows to stop the servers.`n" -ForegroundColor Yellow

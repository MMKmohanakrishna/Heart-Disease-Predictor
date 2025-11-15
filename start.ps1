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

Write-Host "✓ Environment ready" -ForegroundColor Green

# Start backend server in a new window (set working directory explicitly so $PWD expands)
Write-Host "`nStarting backend server..." -ForegroundColor Cyan
$backendJob = Start-Process powershell -ArgumentList "-NoExit", "-Command", "..\..\.venv\Scripts\python.exe -m uvicorn main:app --reload --host 127.0.0.1 --port 8000" -WorkingDirectory "$PWD\backend" -PassThru

Start-Sleep -Seconds 2

# Start frontend server in a new window (set working directory explicitly)
Write-Host "Starting frontend server..." -ForegroundColor Cyan
$frontendJob = Start-Process powershell -ArgumentList "-NoExit", "-Command", "python serve_frontend.py" -WorkingDirectory "$PWD" -PassThru

Start-Sleep -Seconds 2

Write-Host "`n=== Servers Started Successfully! ===`n" -ForegroundColor Green
Write-Host "Backend:  http://127.0.0.1:8000" -ForegroundColor White
Write-Host "Frontend: http://localhost:3000" -ForegroundColor White
Write-Host "`nOpening browser..." -ForegroundColor Cyan

Start-Sleep -Seconds 1
Start-Process "http://localhost:3000"

Write-Host "`n✓ Application ready!" -ForegroundColor Green
Write-Host "  Close the PowerShell windows to stop the servers.`n" -ForegroundColor Yellow

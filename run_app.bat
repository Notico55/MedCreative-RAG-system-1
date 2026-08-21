@echo off
setlocal

title CKD RAG System

echo ==========================================
echo       CKD GUIDELINE RAG SYSTEM
echo ==========================================
echo.

:: --------------------------------------------------
:: Get project directory
:: --------------------------------------------------
set "PROJECT_DIR=%~dp0"

:: --------------------------------------------------
:: Start FastAPI Backend
:: --------------------------------------------------
echo [1/3] Starting FastAPI backend...
echo.

start "CKD Backend" cmd /k "cd /d "%PROJECT_DIR%backend" && python -m uvicorn main:app --host 127.0.0.1 --port 8000 --reload"

:: --------------------------------------------------
:: Wait for backend
:: --------------------------------------------------
echo [2/3] Waiting for backend to start...
timeout /t 5 /nobreak > nul

:: --------------------------------------------------
:: Start React Frontend
:: --------------------------------------------------
echo [3/3] Starting React frontend...
echo.

start "CKD Frontend" cmd /k "cd /d "%PROJECT_DIR%frontend" && npm run dev"

:: --------------------------------------------------
:: Wait for Vite
:: --------------------------------------------------
timeout /t 5 /nobreak > nul

:: --------------------------------------------------
:: Open application
:: --------------------------------------------------
echo.
echo ==========================================
echo          CKD RAG SYSTEM STARTED
echo ==========================================
echo.
echo Backend:
echo http://127.0.0.1:8000
echo.
echo API Docs:
echo http://127.0.0.1:8000/docs
echo.
echo Frontend:
echo http://localhost:5173
echo.
echo ==========================================
echo Opening application...
echo ==========================================
echo.

start "" "http://localhost:5173"

echo.
echo Keep this window open while using the application.
echo.
pause
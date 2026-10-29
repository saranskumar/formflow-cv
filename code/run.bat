@echo off
rem FormFlow web app launcher: creates the venv and installs dependencies on first run, then starts the server
rem and opens the app in your browser. Use Chrome or Edge, and allow the camera.
rem Usage:  run.bat             start on http://127.0.0.1:8000
rem         run.bat --port 9000 --no-browser
rem         run.bat test        run the Python + JavaScript test suites
setlocal
cd /d "%~dp0"
set "PY=.venv\Scripts\python.exe"

if not exist "%PY%" (
    echo [FormFlow] First run: creating virtual environment...
    py -3.12 -m venv .venv 2>nul || py -3 -m venv .venv 2>nul || python -m venv .venv
    if not exist "%PY%" (
        echo [FormFlow] Could not create the venv. Install Python 3.12 from python.org and retry.
        pause
        exit /b 1
    )
)

"%PY%" -c "import fastapi, uvicorn, websockets, httpx, pytest" >nul 2>&1
if errorlevel 1 (
    echo [FormFlow] Installing the web server ^(first run only^)...
    "%PY%" -m pip install --upgrade pip
    "%PY%" -m pip install -r requirements.txt
    if errorlevel 1 (
        echo [FormFlow] Install failed. Check your internet connection and retry.
        pause
        exit /b 1
    )
)

if /i "%~1"=="test" (
    "%PY%" -m pytest -q
    where node >nul 2>&1 && (cd web && node --test "test/*.test.mjs")
    pause
    exit /b %errorlevel%
)

"%PY%" -m server %*
if errorlevel 1 (
    echo.
    echo [FormFlow] The server exited with an error.
    pause
)
endlocal

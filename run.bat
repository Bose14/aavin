@echo off
setlocal
title Aavin Platform Launcher

echo ============================================================
echo               AAVIN INTERNAL PLATFORM LAUNCHER
echo ============================================================
echo.

:: Detect root directory (handles running from root AAVIN or inside aavin\)
set "SCRIPT_DIR=%~dp0"
if exist "%SCRIPT_DIR%backend" (
    set "PROJECT_DIR=%SCRIPT_DIR%"
) else if exist "%SCRIPT_DIR%aavin\backend" (
    set "PROJECT_DIR=%SCRIPT_DIR%aavin"
) else (
    echo [ERROR] Could not locate backend directory!
    pause
    exit /b 1
)

set "BACKEND_DIR=%PROJECT_DIR%\backend"
set "FRONTEND_DIR=%PROJECT_DIR%\frontend"

:: 1. Check Backend .env
if not exist "%BACKEND_DIR%\.env" (
    echo [!] Backend .env was not found.
    if exist "%BACKEND_DIR%\.env.example" (
        echo     Creating backend\.env from .env.example...
        copy "%BACKEND_DIR%\.env.example" "%BACKEND_DIR%\.env" >nul
        echo     [IMPORTANT] Ensure you update backend\.env with your Supabase credentials.
    )
)

:: 2. Check Frontend .env
if not exist "%FRONTEND_DIR%\.env" (
    echo [!] Frontend .env was not found.
    if exist "%FRONTEND_DIR%\.env.example" (
        echo     Creating frontend\.env from .env.example...
        copy "%FRONTEND_DIR%\.env.example" "%FRONTEND_DIR%\.env" >nul
        echo     [IMPORTANT] Ensure you update frontend\.env with your Supabase credentials.
    )
)

:: 3. Check and install dependencies if node_modules is missing
if not exist "%BACKEND_DIR%\node_modules" (
    echo.
    echo [*] Installing backend dependencies - please wait...
    pushd "%BACKEND_DIR%"
    call npm install
    popd
)

if not exist "%FRONTEND_DIR%\node_modules" (
    echo.
    echo [*] Installing frontend dependencies - please wait...
    pushd "%FRONTEND_DIR%"
    call npm install
    popd
)

echo.
echo ============================================================
echo Starting Backend and Frontend services in separate windows...
echo.
echo   - Backend:  http://localhost:4000
echo   - Frontend: http://localhost:5173
echo ============================================================
echo.

:: 4. Launch Backend in a dedicated window
start "Aavin - Backend [Port 4000]" cmd /k "cd /d ""%BACKEND_DIR%"" && echo === Aavin Backend API === && npm run dev"

:: 5. Launch Frontend in a dedicated window
start "Aavin - Frontend [Port 5173]" cmd /k "cd /d ""%FRONTEND_DIR%"" && echo === Aavin Frontend === && npm run dev"

echo Both services have been launched in separate terminal windows.
timeout /t 5 >nul
exit /b 0

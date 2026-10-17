@echo off
setlocal
cd /d "%~dp0"
title Columbina Admin

echo ============================================
echo   Columbina Admin
echo ============================================
echo.

where node >nul 2>nul
if errorlevel 1 (
  echo [ERROR] Node.js not found.
  echo         Please install Node.js 20 or newer: https://nodejs.org/
  echo.
  pause
  exit /b 1
)

rem ---------- 1. dependencies ----------
if not exist "node_modules\fastify\package.json" goto install
if not exist "node_modules\vite\package.json" goto install
if not exist "node_modules\typescript\package.json" goto install
echo [1/4] Dependencies OK.
goto checkconfig

:install
echo [1/4] Installing dependencies, this may take a few minutes...
set "PM="
where pnpm >nul 2>nul
if not errorlevel 1 set "PM=pnpm"
if not defined PM (
  where npm >nul 2>nul
  if not errorlevel 1 set "PM=npm"
)
if not defined PM (
  echo [ERROR] Neither pnpm nor npm found. Install pnpm with: corepack enable
  echo.
  pause
  exit /b 1
)
echo       Package manager: %PM%
call %PM% install
if errorlevel 1 (
  echo.
  echo [ERROR] Install failed.
  echo         If the error mentions MINIMUM_RELEASE_AGE, run:
  echo             %PM% install --config.minimumReleaseAge=0
  echo         Or switch to an older pnpm:  corepack prepare pnpm@11.22.0 --activate
  echo.
  pause
  exit /b 1
)

rem ---------- 2. config ----------
:checkconfig
if exist "admin.config.json" goto build
copy "admin.config.example.json" "admin.config.json" >nul
echo.
echo [INFO] admin.config.json created.
echo        Set repoPath to your Firefly repository, for example:
echo        "repoPath": "F:/Firefly-master/Firefly-master"
echo.
notepad "admin.config.json"
echo Save the file, then run this script again.
echo.
pause
exit /b 0

rem ---------- 3. build (call local toolchain directly, skip pnpm/npm scripts) ----------
:build
echo [2/4] Compiling backend...
node "node_modules\typescript\bin\tsc" -p tsconfig.server.json
if errorlevel 1 goto buildfail

echo [3/4] Building frontend...
node "node_modules\vite\bin\vite.js" build
if errorlevel 1 goto buildfail

rem ---------- 4. run ----------
echo [4/4] Starting server on http://127.0.0.1:4310
echo       Close this window to stop the server.
echo.
node "dist-server\index.js"

echo.
echo Server stopped.
pause
exit /b 0

:buildfail
echo.
echo [ERROR] Build failed. See the messages above.
echo.
pause
exit /b 1

@echo off
title ZAYKA VIP Restaurant Platform
color 0E
echo ============================================================
echo   👑 ZAYKA VIP Restaurant Platform - Starting Server...
echo ============================================================
cd /d "%~dp0"

echo [1/2] Opening browser at http://localhost:5000...
start http://localhost:5000

echo [2/2] Running Node.js Server (server/index.js)...
echo Press Ctrl+C in this window anytime to stop the server.
echo.
node server/index.js
pause

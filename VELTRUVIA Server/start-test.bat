@echo off
REM Run the raw Node server from the bundled app (no Electron), for quick testing
REM Works from any install location; demo accounts ON (test@example.com / testdoc123)
cd /d "%~dp0VELTRUVIA Server\resources\app"
if not exist "%~dp0VELTRUVIA Server\resources\app\node_modules" (
  echo [!] node_modules not found next to this script. Run this from the suite root.
  pause
  exit /b 1
)
set JWT_SECRET=test-secret
set PHI_ENCRYPTION_KEY=test-phi-key-32-bytes-long-here
set DB_PATH=./test.db
set PORT=3000
set VELTRUVIA_DEMO=true
node src/server.js

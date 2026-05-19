@echo off
echo.
echo ========================================
echo   Dashboard Data Restore
echo ========================================
echo.

set SOURCE=%USERPROFILE%\Desktop\dashboard-backup
set DEST=%APPDATA%\myeonho-dashboard

if not exist "%SOURCE%" (
    echo [ERROR] No backup data found.
    echo Backup location: %SOURCE%
    echo.
    echo Please check if backup folder exists.
    echo.
    pause
    exit /b 1
)

echo Restoring...
echo.

robocopy "%SOURCE%" "%DEST%" /E /IS /IT >nul 2>&1

if %ERRORLEVEL% LEQ 7 (
    echo [SUCCESS] Restore completed!
    echo.
    echo Restore location: %DEST%
    echo.
    echo Restart the app to load previous data.
) else (
    echo [ERROR] Restore failed! Error code: %ERRORLEVEL%
    echo.
    echo Try running as Administrator.
)

echo.
pause

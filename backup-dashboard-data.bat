@echo off
echo.
echo ========================================
echo   Dashboard Data Backup
echo ========================================
echo.
echo Backing up...
echo.

set SOURCE=%APPDATA%\myeonho-dashboard
set DEST=%USERPROFILE%\Desktop\dashboard-backup

if not exist "%SOURCE%" (
    echo [ERROR] No data to backup.
    echo Path: %SOURCE%
    echo.
    pause
    exit /b 1
)

xcopy "%SOURCE%" "%DEST%\" /E /I /Y /H >nul 2>&1

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Backup completed!
    echo.
    echo Backup location: %DEST%
    echo.
    echo Now you can build and test initialization.
) else (
    echo [ERROR] Backup failed! Error code: %ERRORLEVEL%
)

echo.
pause

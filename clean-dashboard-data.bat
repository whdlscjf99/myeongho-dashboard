@echo off
echo.
echo ========================================
echo   Dashboard Data Cleanup
echo ========================================
echo.
echo WARNING: This will DELETE all dashboard data!
echo.
echo Press Ctrl+C to cancel, or
pause
echo.

set TARGET=%APPDATA%\myeonho-dashboard

if not exist "%TARGET%" (
    echo [INFO] No data found. Already clean.
    echo.
    pause
    exit /b 0
)

echo Deleting: %TARGET%
echo.
rmdir /s /q "%TARGET%"

if %ERRORLEVEL% EQU 0 (
    echo [SUCCESS] Dashboard data deleted!
    echo.
    echo Now you can test fresh installation.
) else (
    echo [ERROR] Delete failed! Error code: %ERRORLEVEL%
    echo.
    echo Try running as administrator.
)

echo.
pause

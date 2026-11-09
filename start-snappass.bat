@echo off
title SnapPass - Proxy Server
echo ============================================
echo   SnapPass - Tek Tusla Baslat
echo ============================================
echo.

cd /d "C:\PROJELER\snappass-cloud"

if not exist "temp" mkdir "temp"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] node bulunamadi. Node.js kurulumunu kontrol edin.
    pause
    exit /b 1
)

where npm >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] npm bulunamadi. Node.js kurulumunu kontrol edin.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [BILGI] node_modules bulunamadi. Bagimliliklar kuruluyor...
    call npm install
    if %errorlevel% neq 0 (
        echo [HATA] npm install basarisiz oldu.
        pause
        exit /b 1
    )
) else (
    echo [OK] Bagimliliklar hazir.
)

rem Yerel OCR araci (http://127.0.0.1:5102, ayri pencerede). Bulut OCR proxy icinde calisir.
echo [BILGI] Yerel OCR araci baslatiliyor: http://127.0.0.1:5102
start "SnapPass OCR Araci" /min node ocr-agent.js

echo [BILGI] Tarayici aciliyor: http://localhost:3000/login
start "" http://localhost:3000/login
echo [BILGI] MRZ debug log klasoru: C:\PROJELER\snappass-cloud\temp

echo [BILGI] SnapPass sunucusu baslatiliyor...
echo Kapatmak icin Ctrl+C basin.
echo.

set PORT=3000
call npm start

if %errorlevel% neq 0 (
    echo.
    echo [HATA] SnapPass baslatilamadi.
    pause
)

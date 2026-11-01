@echo off
title SnapPass - OCR Araci
echo ============================================
echo   SnapPass OCR Araci (resepsiyon terminali)
echo ============================================
echo.
echo Kamera goruntusu bu bilgisayarda okunur; goruntu disari cikmaz.
echo Adres: http://127.0.0.1:5102  (yalniz bu bilgisayar)
echo.

cd /d "%~dp0"

where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [HATA] node bulunamadi. Node.js kurulumunu kontrol edin.
    pause
    exit /b 1
)

if not exist "node_modules" (
    echo [BILGI] Bagimliliklar kuruluyor...
    call npm install --omit=dev
)

rem Izinli SnapPass adresleri (gerekirse ekleyin, virgulle)
if "%SNAPPASS_AGENT_ORIGINS%"=="" set SNAPPASS_AGENT_ORIGINS=https://snappass.protel.com.tr

node ocr-agent.js
pause

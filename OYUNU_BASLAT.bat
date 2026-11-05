@echo off
title Counter-Strike 1.6 Web Sunucusu
cd /d "%~dp0"

echo ===================================================
echo   Counter-Strike 1.6 Web Sunucusu Baslatiliyor...
echo ===================================================
echo.
echo Tarayicinizda acilacak: http://localhost:8080
echo Kapatmak icin bu pencereyi kapatabilirsiniz.
echo.

start "" "http://localhost:8080"
node server.js
pause


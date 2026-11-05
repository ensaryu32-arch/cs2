@echo off
chcp 65001 >nul
title CS 1.6 GitHub'a Yukleniyor...
echo ===================================================================
echo     COUNTER-STRIKE 1.6 GITHUB'A YUKLENIYOR (TEK TIK)
echo ===================================================================
echo.
echo Hedef Depo: https://github.com/ensaryu32-arch/cs2.git
echo.
cd /d "C:\Users\ensar\OneDrive\Desktop\CS1.6-Web"

set GIT_CMD="C:\Program Files\Microsoft Visual Studio\2022\Community\Common7\IDE\CommonExtensions\Microsoft\TeamFoundation\Team Explorer\Git\cmd\git.exe"

echo 1. Degisiklikler kontrol ediliyor...
%GIT_CMD% add .

echo 2. Paket hazirlaniyor...
%GIT_CMD% commit -m "Counter-Strike 1.6 Web Multiplayer Guncelleme"

echo 3. GitHub'a gonderiliyor (Push)...
%GIT_CMD% push -u origin main --force

echo.
echo ===================================================================
echo   ISLEM TAMAMLANDI! Oyun dosyalari GitHub'a basariyla yuklendi!
echo   Render.com uzerinden otomatik deploy baslayacaktir.
echo ===================================================================
pause


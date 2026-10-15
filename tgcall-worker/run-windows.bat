@echo off
rem tgcall-worker — Windows'da ishga tushirish (ikki marta bosing).
rem Yo'lda bo'sh joy bo'lsa ham ishlaydi ("NEW ERP"): hamma yo'llar qo'shtirnoq ichida.
setlocal EnableExtensions
chcp 65001 >nul

set "PYTHONUTF8=1"
set "PYTHONIOENCODING=utf-8"

cd /d "%~dp0"
title tgcall-worker

rem 1) Python 3.12 (py launcher) yoki PATH'dagi python 3.10-3.14
set "PY="
py -3.12 --version >nul 2>&1
if not errorlevel 1 set "PY=py -3.12"

if not defined PY (
    python --version 2>nul | findstr /r /c:"Python 3\.1[0-4]" >nul
    if not errorlevel 1 set "PY=python"
)

if not defined PY (
    echo [XATO] Python 3.12 topilmadi. https://www.python.org/downloads/ dan o'rnating
    echo        ^(o'rnatishda "Add python.exe to PATH" belgisini qo'ying^).
    goto fail
)

rem 2) Virtual muhit (.venv) — bir marta yaratiladi
if not exist ".venv\Scripts\python.exe" (
    echo Virtual muhit yaratilmoqda...
    %PY% -m venv ".venv"
    if errorlevel 1 goto fail
)

set "VPY=%~dp0.venv\Scripts\python.exe"

if not exist "requirements.txt" (
    echo [XATO] requirements.txt topilmadi.
    goto fail
)

rem 3) Kutubxonalar — faqat requirements.txt o'zgarganda (birinchi marta bir necha daqiqa)
set "NEED_PIP=1"
if exist ".venv\requirements.installed" (
    fc /b "requirements.txt" ".venv\requirements.installed" >nul 2>&1
    if not errorlevel 1 set "NEED_PIP="
)
if defined NEED_PIP (
    echo Kutubxonalar o'rnatilmoqda...
    "%VPY%" -m pip install --disable-pip-version-check -r requirements.txt
    if errorlevel 1 goto fail
    copy /y "requirements.txt" ".venv\requirements.installed" >nul
)

rem 4) .env — bo'lmasa namunadan yaratiladi va Bloknotda ochiladi
if not exist ".env" (
    if exist ".env.example" (
        copy ".env.example" ".env" >nul
        echo [DIQQAT] .env fayli yaratildi. BACKEND_URL, TG_API_ID, TG_API_HASH ni to'ldiring,
        echo          saqlang va bu faylni qayta ishga tushiring.
        start "" notepad ".env"
    ) else (
        echo [XATO] .env va .env.example topilmadi.
    )
    goto fail
)

rem 5) Ishga tushirish. Kod 2 = sozlama xatosi (qayta urinish foydasiz) — to'xtaydi.
:run
"%VPY%" -m app.main
set "RC=%errorlevel%"
if "%RC%"=="0" goto end
if "%RC%"=="2" goto fail

echo Worker to'xtadi (kod %RC%). 15 soniyadan keyin qayta ishga tushadi (yopish uchun oynani yoping).
timeout /t 15 /nobreak >nul
goto run

:fail
echo.
echo Xatoni tuzating va qayta ishga tushiring. README.md ga qarang.
pause
exit /b 1

:end
endlocal
exit /b 0

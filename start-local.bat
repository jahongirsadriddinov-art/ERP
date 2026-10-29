@echo off
REM QurilishERP - lokal sinov (owner 2026-10-29: "manga ham test qilishim uchun localhost qilip ber").
REM
REM Ikki oyna ochiladi: backend (5000) va sayt (5173). Ikkalasi ham SHU kompyuterda ishlaydi,
REM ma'lumotlar lokal MongoDB'da (backend/.env -> mongodb://127.0.0.1:27017/erp_firma).
REM Jonli saytga va jonli bazaga HECH QANDAY ta'siri yo'q.
REM
REM Ishlatish: shu faylni ikki marta bosing. To'xtatish: ochilgan oynalarda Ctrl+C.

cd /d "%~dp0"

echo.
echo  ====================================================
echo   QurilishERP - LOKAL SINOV
echo  ====================================================
echo.

where mongod >nul 2>nul
if errorlevel 1 (
  echo  [!] MongoDB topilmadi. Lokal baza kerak:
  echo      https://www.mongodb.com/try/download/community
  echo      yoki backend\.env dagi MONGODB_URI ni o'zgartiring.
  echo.
)

if not exist "backend\node_modules" (
  echo  [1/3] Backend kutubxonalari o'rnatilmoqda...
  pushd backend && call npm install && popd
)
if not exist "frontend\node_modules" (
  echo  [2/3] Sayt kutubxonalari o'rnatilmoqda...
  pushd frontend && call npm install && popd
)

echo  [3/3] Ishga tushirilmoqda...
start "QurilishERP backend (5000)" cmd /k "cd /d %~dp0backend && npm run dev"
timeout /t 3 /nobreak >nul
start "QurilishERP sayt (5173)" cmd /k "cd /d %~dp0frontend && npm run dev"

echo.
echo  Tayyor. Brauzerda oching:  http://localhost:5173
echo.
echo  Backend:  http://localhost:5000/health
echo  To'xtatish: ochilgan ikki oynada Ctrl+C
echo.
pause

@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════╗
echo ║     MiroFish → Railway Deployer      ║
echo ╚══════════════════════════════════════╝
echo.

echo [1/4] Klucz LLM - otwieram Groq w przegladarce...
start https://console.groq.com/keys
echo.
echo Na stronie Groq: kliknij "Create API Key", skopiuj klucz
echo.
set /p GROQ_KEY="Wklej klucz Groq (gsk_...): "

echo.
echo [2/4] Klucz Zep - otwieram w przegladarce...
start https://app.getzep.com
echo.
echo Na stronie Zep: Settings → API Keys → Create API Key
echo.
set /p ZEP_KEY="Wklej klucz Zep (z_...): "

echo.
echo [3/4] Inicjalizuje projekt Railway...
railway init --name mirofish

echo.
echo Ustawiam zmienne srodowiskowe...
railway variables set LLM_API_KEY="%GROQ_KEY%" LLM_BASE_URL="https://api.groq.com/openai/v1" LLM_MODEL_NAME="llama-3.3-70b-versatile" ZEP_API_KEY="%ZEP_KEY%" PORT=3000

echo.
echo [4/4] Wdrazam na Railway (3-5 minut)...
railway up --detach

echo.
echo ╔══════════════════════════════════════╗
echo ║            Gotowe!                   ║
echo ╚══════════════════════════════════════╝
echo.
railway status
pause

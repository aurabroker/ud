@echo off
chcp 65001 >nul
echo.
echo ╔══════════════════════════════════════╗
echo ║     MiroFish → Render Deployer       ║
echo ╚══════════════════════════════════════╝
echo.

echo [1/2] Klucz LLM - otwieram Groq w przegladarce...
start https://console.groq.com/keys
echo.
echo Na stronie Groq: kliknij "Create API Key", skopiuj klucz
echo.
set /p GROQ_KEY="Wklej klucz Groq (gsk_...): "

echo.
echo [2/2] Otwieram Render - zaloguj sie przez GitHub...
start https://dashboard.render.com/select-repo?type=web
echo.
echo Na stronie Render:
echo  1. Polaczy sie z GitHub i wybierz repo: aurabroker/ud
echo  2. Root Directory: MiroFish
echo  3. Runtime: Docker
echo  4. Kliknij "Advanced" i dodaj zmienne srodowiskowe:
echo.
echo     LLM_API_KEY     = %GROQ_KEY%
echo     LLM_BASE_URL    = https://api.groq.com/openai/v1
echo     LLM_MODEL_NAME  = llama-3.3-70b-versatile
echo     PORT            = 3000
echo.
echo  5. Kliknij "Create Web Service"
echo.
pause

#!/bin/bash
set -e

GREEN='\033[0;32m'
CYAN='\033[0;36m'
YELLOW='\033[1;33m'
NC='\033[0m'

open_browser() {
  open "$1" 2>/dev/null || xdg-open "$1" 2>/dev/null || start "$1" 2>/dev/null || true
}

echo -e "${CYAN}"
echo "╔══════════════════════════════════════╗"
echo "║     MiroFish → Railway Deployer      ║"
echo "╚══════════════════════════════════════╝"
echo -e "${NC}"

# Check railway CLI
if ! command -v railway &> /dev/null; then
  echo "Instaluję Railway CLI..."
  npm install -g @railway/cli
fi

# ── Krok 1: Groq API Key ──────────────────────────────────────────
echo -e "${YELLOW}[1/4] Klucz LLM (Groq — darmowy, bez karty)${NC}"
echo "Otwieram stronę w przeglądarce..."
open_browser "https://console.groq.com/keys"
echo ""
echo "Na stronie Groq: kliknij 'Create API Key', skopiuj klucz"
echo ""
read -p "Wklej klucz Groq (gsk_...): " GROQ_KEY
while [[ -z "$GROQ_KEY" ]]; do
  read -p "Klucz nie może być pusty. Wklej klucz Groq: " GROQ_KEY
done

# ── Krok 2: Zep API Key ───────────────────────────────────────────
echo ""
echo -e "${YELLOW}[2/4] Klucz Zep (darmowy)${NC}"
echo "Otwieram stronę w przeglądarce..."
open_browser "https://app.getzep.com"
echo ""
echo "Na stronie Zep: Settings → API Keys → Create API Key"
echo ""
read -p "Wklej klucz Zep (z_...): " ZEP_KEY
while [[ -z "$ZEP_KEY" ]]; do
  read -p "Klucz nie może być pusty. Wklej klucz Zep: " ZEP_KEY
done

# ── Krok 3: Railway init ──────────────────────────────────────────
echo ""
echo -e "${YELLOW}[3/4] Tworzę projekt na Railway...${NC}"
if [ ! -f ".railway/config.json" ]; then
  railway init --name mirofish
fi

echo ""
echo -e "${YELLOW}[3/4] Ustawiam zmienne środowiskowe...${NC}"
railway variables set \
  LLM_API_KEY="$GROQ_KEY" \
  LLM_BASE_URL="https://api.groq.com/openai/v1" \
  LLM_MODEL_NAME="llama-3.3-70b-versatile" \
  ZEP_API_KEY="$ZEP_KEY" \
  PORT=3000

# ── Krok 4: Deploy ────────────────────────────────────────────────
echo ""
echo -e "${YELLOW}[4/4] Wdrażam na Railway (może potrwać 3-5 minut)...${NC}"
railway up --detach

echo ""
echo -e "${GREEN}╔══════════════════════════════════════╗"
echo "║           Gotowe!                    ║"
echo "╚══════════════════════════════════════╝${NC}"
echo ""
echo "Sprawdzam URL aplikacji..."
railway status
echo ""
echo -e "${CYAN}Otwieranie aplikacji w przeglądarce...${NC}"
APP_URL=$(railway status --json 2>/dev/null | grep -o '"url":"[^"]*"' | head -1 | cut -d'"' -f4 || echo "")
if [[ -n "$APP_URL" ]]; then
  open_browser "https://$APP_URL"
fi

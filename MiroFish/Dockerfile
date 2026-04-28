FROM python:3.11

RUN apt-get update \
  && apt-get install -y --no-install-recommends nodejs npm nginx \
  && rm -rf /var/lib/apt/lists/*

COPY --from=ghcr.io/astral-sh/uv:0.9.26 /uv /uvx /bin/

WORKDIR /app

COPY package.json package-lock.json ./
COPY frontend/package.json frontend/package-lock.json ./frontend/
COPY backend/pyproject.toml backend/uv.lock ./backend/

RUN npm ci \
  && npm ci --prefix frontend \
  && cd backend && uv sync --frozen

COPY . .

RUN npm run build

COPY nginx.conf /etc/nginx/nginx.conf

EXPOSE 3000

CMD ["sh", "-c", "cd /app/backend && uv run python run.py & nginx -g 'daemon off;'"]

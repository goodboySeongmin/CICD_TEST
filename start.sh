#!/usr/bin/env sh
set -e
APP_MODULE="${APP_MODULE:-app:app}"   # <- 루트에 app.py면 app:app
HOST="${HOST:-0.0.0.0}"
PORT="${PORT:-8000}"
WORKERS="${WORKERS:-2}"

echo "Starting: uvicorn ${APP_MODULE} on ${HOST}:${PORT} (workers=${WORKERS})"
# exec uvicorn app:app --host 0.0.0.0 --port 8000 --workers "${WORKERS}" --proxy-headers
exec uvicorn app:app --reload

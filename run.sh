#!/usr/bin/env bash
set -e

cd "$(dirname "$0")"

if [ ! -d venv ]; then
  echo "Creating virtual environment..."
  python3 -m venv venv
fi

source venv/bin/activate
pip install -q -r backend/requirements.txt -r requirements-dev.txt

export PYTHONPATH="$(pwd)"
export FLASK_ENV="${FLASK_ENV:-development}"

exec gunicorn -b 0.0.0.0:${PORT:-5000} --workers 2 --timeout 120 --reload backend.main:app

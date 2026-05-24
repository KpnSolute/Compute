#!/bin/bash
# MJCC Inventory — start the API and website
kill $(lsof -ti :5000) 2>/dev/null
sleep 1
source venv/bin/activate
python3 backend/main.py

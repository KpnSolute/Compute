#!/bin/bash
# MJCC Inventory — start the API and website
kill $(lsof -ti :5000) 2>/dev/null
sleep 1
source venv/bin/activate
python3 backend/main.py &
PID=$!
for i in $(seq 1 15); do
  if curl -s -o /dev/null http://127.0.0.1:5000/ 2>/dev/null; then
    echo "Server ready at http://127.0.0.1:5000"
    break
  fi
  sleep 1
done
wait $PID

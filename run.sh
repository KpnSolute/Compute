#!/bin/bash
# MJCC Inventory — start the API and website
kill $(lsof -ti :5000) 2>/dev/null; sleep 0.5
source venv/bin/activate
setsid python3 backend/main.py > /tmp/mjcc-server.log 2>&1 & disown
for i in $(seq 1 15); do
  if curl -s -o /dev/null http://127.0.0.1:5000/ 2>/dev/null; then
    echo "Server ready at http://127.0.0.1:5000 (log: /tmp/mjcc-server.log)"
    exit 0
  fi
  sleep 1
done
echo "Server failed to start — check /tmp/mjcc-server.log"
exit 1

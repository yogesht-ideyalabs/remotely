#!/bin/bash
# Kills the POC processes started by start.sh (matched by port/script name).
pkill -f "tsx src/index.ts" 2>/dev/null || true
pkill -f "vite --port 5173" 2>/dev/null || true
echo "Stopped."

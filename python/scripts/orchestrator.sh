#!/bin/bash
# Orchestratore: aspetta v6, lancia v7, aspetta v7, esegue report finale.
set -e
LOG_DIR=/tmp/hex_tactics_orchestrator
mkdir -p "$LOG_DIR"

PYTHON=/Users/flaviacasini/claude-bot/venv/bin/python3
SCRIPTS=/Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python/scripts

# Step 1: attendi v6
echo "[$(date)] orchestrator started, waiting for v6..." > "$LOG_DIR/main.log"
while pgrep -f "scripts/train_dqn_v6_selfplay.py" > /dev/null; do
    sleep 60
done
echo "[$(date)] v6 finished" >> "$LOG_DIR/main.log"

# Step 2: lancia v7
mkdir -p /tmp/hex_tactics_dqn_v7_charbuilder
echo "[$(date)] launching v7 (random PG 1M step)" >> "$LOG_DIR/main.log"
cd /Users/flaviacasini/claude-bot/sandboxes/valerio/hex-tactics/python
$PYTHON -u "$SCRIPTS/train_dqn_v7_charbuilder.py" > /tmp/hex_tactics_dqn_v7_charbuilder/train.log 2>&1 &
V7_PID=$!
echo "[$(date)] v7 PID=$V7_PID" >> "$LOG_DIR/main.log"

# Step 3: attendi v7
while kill -0 "$V7_PID" 2>/dev/null; do
    sleep 120
done
echo "[$(date)] v7 finished" >> "$LOG_DIR/main.log"

# Step 4: report finale
mkdir -p /tmp/hex_tactics_final_report
echo "[$(date)] generating final report" >> "$LOG_DIR/main.log"
$PYTHON -u "$SCRIPTS/final_analysis_report.py" > /tmp/hex_tactics_final_report/report.log 2>&1
echo "[$(date)] orchestrator DONE" >> "$LOG_DIR/main.log"

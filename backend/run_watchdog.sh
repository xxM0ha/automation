#!/bin/bash
# POS pipeline watchdog runner (invoked by cron every few minutes).
# Sources .env so Django settings load, then runs the watchdog command.
cd /root/PrimeAutomation/backend || exit 1
set -a
[ -f .env ] && . ./.env
set +a
exec venv/bin/python manage.py pos_watchdog

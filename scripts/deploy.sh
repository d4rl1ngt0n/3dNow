#!/usr/bin/env bash
# Pull latest main from GitHub and rebuild the quote engine container.
set -euo pipefail
cd "$(dirname "$0")"

git fetch origin
git checkout main
git pull --ff-only origin main

mkdir -p /var/lib/3dnow/{uploads,submissions,output/gcode,data}
chown -R 1000:1000 /var/lib/3dnow || true

if [[ ! -f .env ]]; then
  echo "Missing .env. Copy .env.example to .env and fill production values."
  exit 1
fi

docker compose up -d --build
docker compose ps
docker compose logs --tail=40 quote-engine

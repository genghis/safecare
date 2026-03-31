#!/bin/bash -e
# Pre-pull Docker images into the image so first boot doesn't need to download them.
# This makes the image ~3 GB larger but the first-boot experience much better.

on_chroot << 'CHEOF'

# Start Docker daemon temporarily
dockerd &
DOCKER_PID=$!

# Wait for Docker to be ready
for i in $(seq 1 30); do
  docker info >/dev/null 2>&1 && break
  sleep 1
done

# Pull infrastructure images
docker pull postgres:16-alpine
docker pull redis:7-alpine
docker pull mediagis/nominatim:4.4
docker pull osrm/osrm-backend:latest
docker pull bbernhard/signal-cli-rest-api:latest

# Build application images
if [ -d /opt/safecare/docker ]; then
  cd /opt/safecare
  docker compose -f docker/docker-compose.yml build backend dashboard pwa 2>/dev/null || true
fi

# Stop Docker daemon
kill $DOCKER_PID
wait $DOCKER_PID 2>/dev/null || true

CHEOF

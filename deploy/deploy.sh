#!/bin/sh
# Builds and deploys the current checkout (docs/go-live.md §8). Migrations
# and grants run on their own first: if either fails, the running app and
# worker are left untouched and this script stops.
set -eu
cd "$(dirname "$0")"
APP_VERSION="${APP_VERSION:-$(git rev-parse --short HEAD)}"
export APP_VERSION
compose() { docker compose ${COMPOSE_ARGS:-} "$@"; }
compose build
compose up -d --wait db
compose run --rm migrate
compose run --rm grants
compose up -d --remove-orphans
compose ps

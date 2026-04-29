#!/usr/bin/env bash
set -euo pipefail

export DATABASE_URL="${DATABASE_URL:-postgres://workpowers:workpowers@localhost:5432/workpowers_live_fork}"

run_as_root() {
  if [ "$(id -u)" = "0" ]; then
    "$@"
  elif command -v sudo >/dev/null 2>&1; then
    sudo "$@"
  else
    echo "Need root privileges to run: $*" >&2
    return 1
  fi
}

add_postgres_to_path() {
  for bin_dir in /usr/lib/postgresql/*/bin; do
    if [ -d "$bin_dir" ]; then
      export PATH="$bin_dir:$PATH"
    fi
  done
}

install_postgres_with_apt() {
  if ! command -v apt-get >/dev/null 2>&1; then
    return 1
  fi

  run_as_root apt-get update
  run_as_root env DEBIAN_FRONTEND=noninteractive apt-get install -y postgresql postgresql-client
  add_postgres_to_path
}

if command -v pg_isready >/dev/null 2>&1 && pg_isready -d "$DATABASE_URL" >/dev/null 2>&1; then
  echo "Postgres is already accepting connections"
  exit 0
fi

if command -v docker >/dev/null 2>&1 && docker compose version >/dev/null 2>&1; then
  docker compose up -d postgres
  until docker compose exec -T postgres pg_isready -U workpowers -d workpowers_live_fork >/dev/null 2>&1; do
    sleep 1
  done
  echo "Postgres started with docker compose"
  exit 0
fi

if ! command -v initdb >/dev/null 2>&1 || ! command -v pg_ctl >/dev/null 2>&1; then
  install_postgres_with_apt || true
fi

add_postgres_to_path

if command -v initdb >/dev/null 2>&1 && command -v pg_ctl >/dev/null 2>&1; then
  pg_root=".sandbox/postgres"
  pg_data="$pg_root/data"
  pg_log="$pg_root/postgres.log"
  mkdir -p "$pg_root"

  if [ ! -d "$pg_data" ]; then
    initdb -D "$pg_data" --username workpowers --pwfile=<(printf "workpowers")
    {
      echo "listen_addresses = '127.0.0.1'"
      echo "port = 5432"
    } >> "$pg_data/postgresql.conf"
  fi

  pg_ctl -D "$pg_data" -l "$pg_log" start
  until pg_isready -h 127.0.0.1 -p 5432 -U workpowers >/dev/null 2>&1; do
    sleep 1
  done
  createdb -h 127.0.0.1 -U workpowers workpowers_live_fork >/dev/null 2>&1 || true
  echo "Postgres started with local pg_ctl"
  exit 0
fi

echo "No supported Postgres runtime found. Install Docker or Postgres in the sandbox template." >&2
exit 1

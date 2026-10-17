#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${OSA_REPO_URL:-https://github.com/HazEOskA/osa-proof.git}"
BRANCH="${OSA_WORKER_BRANCH:-release/osa-proof-v0.1.0}"
INSTALL_DIR="${OSA_WORKER_INSTALL_DIR:-/opt/osa-worker}"
DOMAIN="${OSA_WORKER_DOMAIN:-worker.osatechgpt.dev}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "bootstrap must run as root" >&2
  exit 1
fi

source "$(dirname -- "${BASH_SOURCE[0]}")/config.sh"
if [[ ! "$INSTALL_DIR" =~ ^/[A-Za-z0-9_/-]+$ || "$INSTALL_DIR" == / || ! "$BRANCH" =~ ^[A-Za-z0-9][A-Za-z0-9._/-]{0,199}$ ]]; then
  echo "Nieprawidłowy katalog instalacji lub gałąź workera." >&2
  exit 10
fi
osa_worker_load_config "${INSTALL_DIR}/deploy/worker/.env"

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends git curl ca-certificates openssl docker.io docker-compose-v2 ufw

systemctl enable --now docker

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  git -C "${INSTALL_DIR}" fetch origin "${BRANCH}"
  git -C "${INSTALL_DIR}" checkout "${BRANCH}"
  git -C "${INSTALL_DIR}" reset --hard "origin/${BRANCH}"
else
  git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

ENV_FILE="deploy/worker/.env"
osa_worker_write_config "${ENV_FILE}" "${DOMAIN}"

docker build \
  -f packages/workspace-runtime/docker/Dockerfile.node22 \
  -t osa/workspace-node22:v0.1 \
  packages/workspace-runtime/docker

docker compose \
  --env-file deploy/worker/.env \
  -f deploy/worker/compose.yml \
  up -d --build --remove-orphans

ufw allow OpenSSH
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 443/udp
ufw --force enable

for _ in $(seq 1 30); do
  if curl -fsS http://127.0.0.1:8787/health >/tmp/osa-worker-health.json; then
    cat /tmp/osa-worker-health.json
    echo
    echo "OSA Worker Host local health: PASS"
    exit 0
  fi
  sleep 2
done

echo "OSA Worker Host failed local health check" >&2
docker compose --env-file deploy/worker/.env -f deploy/worker/compose.yml ps >&2 || true
docker compose --env-file deploy/worker/.env -f deploy/worker/compose.yml logs --tail=100 worker >&2 || true
exit 1

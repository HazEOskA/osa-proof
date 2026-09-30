#!/usr/bin/env bash
set -euo pipefail

REPO_URL="${OSA_REPO_URL:-https://github.com/HazEOskA/osa-proof.git}"
BRANCH="${OSA_WORKER_BRANCH:-feature/worker-deploy-v0.1}"
INSTALL_DIR="${OSA_WORKER_INSTALL_DIR:-/opt/osa-worker}"
DOMAIN="${OSA_WORKER_DOMAIN:-worker.osatechgpt.dev}"

if [[ "${EUID}" -ne 0 ]]; then
  echo "bootstrap must run as root" >&2
  exit 1
fi

export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y --no-install-recommends git curl ca-certificates openssl docker.io docker-compose-v2 ufw

systemctl enable --now docker

if [[ -d "${INSTALL_DIR}/.git" ]]; then
  git -C "${INSTALL_DIR}" fetch origin "${BRANCH}"
  git -C "${INSTALL_DIR}" checkout "${BRANCH}"
  git -C "${INSTALL_DIR}" reset --hard "origin/${BRANCH}"
else
  rm -rf "${INSTALL_DIR}"
  git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" "${INSTALL_DIR}"
fi

cd "${INSTALL_DIR}"

ENV_FILE="deploy/worker/.env"
if [[ ! -f "${ENV_FILE}" ]]; then
  umask 077
  TOKEN="$(openssl rand -hex 32)"
  cat > "${ENV_FILE}" <<EOF
OSA_WORKER_DOMAIN=${DOMAIN}
OSA_WORKER_TOKEN=${TOKEN}
OSA_WORKSPACE_DOCKER_IMAGE=osa/workspace-node22:v0.1
OSA_WORKSPACE_DOCKER_NETWORK=bridge
EOF
  chmod 600 "${ENV_FILE}"
fi

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

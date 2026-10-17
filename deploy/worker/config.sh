#!/usr/bin/env bash
# Wspólna konfiguracja istniejącego Worker Hosta; bez source/eval pliku z sekretami.
osa_worker_env_value() {
  [[ -f "$1" ]] || return 0
  awk -v key="$2" -F= '$1 == key { value = substr($0, index($0, "=") + 1) } END { print value }' "$1"
}

osa_worker_validate_scope() {
  if [[ ! "$1" =~ ^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$ || ! "$2" =~ ^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$ ]]; then
    echo "Wymagane poprawne OSA_WORKER_ORGANIZATION_ID i OSA_WORKER_PROJECT_ID." >&2
    return 12
  fi
}

osa_worker_load_config() {
  local existing="$1"
  OSA_WORKER_ORGANIZATION_ID="${OSA_WORKER_ORGANIZATION_ID:-$(osa_worker_env_value "$existing" OSA_WORKER_ORGANIZATION_ID)}"
  OSA_WORKER_PROJECT_ID="${OSA_WORKER_PROJECT_ID:-$(osa_worker_env_value "$existing" OSA_WORKER_PROJECT_ID)}"
  osa_worker_validate_scope "$OSA_WORKER_ORGANIZATION_ID" "$OSA_WORKER_PROJECT_ID" || return $?
  OSA_CONFIG_TOKEN="${OSA_WORKER_TOKEN:-$(osa_worker_env_value "$existing" OSA_WORKER_TOKEN)}"
  if [[ -n "$OSA_CONFIG_TOKEN" && ( ${#OSA_CONFIG_TOKEN} -lt 32 || ${#OSA_CONFIG_TOKEN} -gt 4096 || ! "$OSA_CONFIG_TOKEN" =~ ^[A-Za-z0-9_.:/+=-]+$ ) ]]; then
    echo "Token workera musi mieć 32–4096 znaków bez białych znaków i składni powłoki." >&2
    return 13
  fi
  OSA_CONFIG_IMAGE="${OSA_WORKSPACE_DOCKER_IMAGE:-$(osa_worker_env_value "$existing" OSA_WORKSPACE_DOCKER_IMAGE)}"
  OSA_CONFIG_IMAGE="${OSA_CONFIG_IMAGE:-osa/workspace-node22:v0.1}"
  OSA_CONFIG_NETWORK="${OSA_WORKSPACE_DOCKER_NETWORK:-$(osa_worker_env_value "$existing" OSA_WORKSPACE_DOCKER_NETWORK)}"
  OSA_CONFIG_NETWORK="${OSA_CONFIG_NETWORK:-none}"
  if [[ ! "$OSA_CONFIG_IMAGE" =~ ^[A-Za-z0-9][A-Za-z0-9./_:@-]{0,255}$ || ! "$OSA_CONFIG_NETWORK" =~ ^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$ ]]; then
    echo "Nieprawidłowy obraz lub sieć sandboxa." >&2
    return 14
  fi
}

osa_worker_write_config() {
  local file="$1" domain="$2" temp
  [[ "$domain" =~ ^[A-Za-z0-9][A-Za-z0-9.-]{0,252}[A-Za-z0-9]$ ]] || { echo "Nieprawidłowa domena workera." >&2; return 15; }
  [[ -n "$OSA_CONFIG_TOKEN" ]] || OSA_CONFIG_TOKEN="$(openssl rand -hex 32)"
  umask 077
  temp="$(mktemp "${file}.XXXXXX")" || return $?
  if ! printf '%s\n' "OSA_WORKER_DOMAIN=${domain}" "OSA_WORKER_TOKEN=${OSA_CONFIG_TOKEN}" \
    "OSA_WORKER_ORGANIZATION_ID=${OSA_WORKER_ORGANIZATION_ID}" "OSA_WORKER_PROJECT_ID=${OSA_WORKER_PROJECT_ID}" \
    "OSA_WORKSPACE_DOCKER_IMAGE=${OSA_CONFIG_IMAGE}" "OSA_WORKSPACE_DOCKER_NETWORK=${OSA_CONFIG_NETWORK}" > "$temp"; then
    rm -f -- "$temp"; return 16
  fi
  chmod 600 "$temp"
  mv -- "$temp" "$file"
  unset OSA_CONFIG_TOKEN
}

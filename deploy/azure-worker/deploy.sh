#!/usr/bin/env bash
set -euo pipefail

RG="${OSA_AZURE_RG:-rg-osa-worker}"
PRIMARY_LOCATION="${OSA_AZURE_LOCATION:-northeurope}"
VM_NAME="${OSA_AZURE_VM_NAME:-osa-worker-v01}"
VM_SIZE_OVERRIDE="${OSA_AZURE_VM_SIZE:-}"
BUDGET_AMOUNT="${OSA_AZURE_BUDGET_AMOUNT:-40}"
AUTO_SHUTDOWN_UTC="${OSA_AZURE_AUTO_SHUTDOWN_UTC:-0100}"
ADMIN_USER="${OSA_AZURE_ADMIN_USER:-osa}"
BRANCH="${OSA_WORKER_BRANCH:-feature/azure-worker-deploy-v0.1}"
REPO_URL="${OSA_REPO_URL:-https://github.com/HazEOskA/osa-proof.git}"

if ! command -v az >/dev/null 2>&1; then
  echo "Azure CLI is required. Run this script in Azure Cloud Shell." >&2
  exit 2
fi

if ! az account show >/dev/null 2>&1; then
  echo "Azure CLI is not logged in. Run: az login" >&2
  exit 3
fi

SUBSCRIPTION_ID="$(az account show --query id -o tsv)"
SUBSCRIPTION_NAME="$(az account show --query name -o tsv)"
TENANT_ID="$(az account show --query tenantId -o tsv)"

echo "Subscription: ${SUBSCRIPTION_NAME}"
echo "Subscription ID: ${SUBSCRIPTION_ID}"

SPENDING_LIMIT="$(az rest \
  --method get \
  --url "https://management.azure.com/subscriptions/${SUBSCRIPTION_ID}?api-version=2022-12-01" \
  --query "subscriptionPolicies.spendingLimit" -o tsv)"

if [[ "${SPENDING_LIMIT}" != "On" ]]; then
  echo "BLOCKED: Azure subscription spendingLimit=${SPENDING_LIMIT:-unknown}." >&2
  echo "OSA policy requires spendingLimit=On before creating the Worker VM." >&2
  echo "Do NOT remove the Azure spending limit for this deployment." >&2
  exit 20
fi

echo "Spending limit: ON (hard guard present)"

REQUIRED_PROVIDERS=(
  Microsoft.KeyVault
  Microsoft.Compute
  Microsoft.Network
  Microsoft.Storage
  Microsoft.ManagedIdentity
  Microsoft.DevTestLab
)

for provider in "${REQUIRED_PROVIDERS[@]}"; do
  state="$(az provider show --namespace "${provider}" --query registrationState -o tsv 2>/dev/null || true)"
  if [[ "${state}" != "Registered" ]]; then
    echo "Registering Azure provider ${provider} ..."
    az provider register --namespace "${provider}" --wait --output none
  fi
done

echo "Required Azure providers: REGISTERED"

az group create \
  --name "${RG}" \
  --location "${PRIMARY_LOCATION}" \
  --tags osa=framework component=worker environment=preview costGuard=true \
  --output none

echo "Creating resource-group budget before billable compute..."
az deployment group create \
  --resource-group "${RG}" \
  --template-file deploy/azure-worker/budget.bicep \
  --parameters amount="${BUDGET_AMOUNT}" \
  --output none

SUB_SHORT="$(printf '%s' "${SUBSCRIPTION_ID}" | tr -d '-' | cut -c1-8)"
KV_NAME="kvosa${SUB_SHORT}"
SSH_KEY="${HOME}/.ssh/osa-worker-azure"

if [[ ! -f "${SSH_KEY}" || ! -f "${SSH_KEY}.pub" ]]; then
  mkdir -p "${HOME}/.ssh"
  chmod 700 "${HOME}/.ssh"
  ssh-keygen -q -t ed25519 -N "" -f "${SSH_KEY}" -C "osa-worker-azure"
fi

if ! az keyvault show -g "${RG}" -n "${KV_NAME}" >/dev/null 2>&1; then
  az keyvault create \
    --resource-group "${RG}" \
    --name "${KV_NAME}" \
    --location "${PRIMARY_LOCATION}" \
    --enable-rbac-authorization true \
    --retention-days 7 \
    --output none
fi

WORKER_TOKEN="$(openssl rand -hex 32)"
az keyvault secret set \
  --vault-name "${KV_NAME}" \
  --name osa-worker-token \
  --value "${WORKER_TOKEN}" \
  --output none
unset WORKER_TOKEN

# Pick the cheapest guarded 2-vCPU / 8-GB option across nearby EU regions.
# An explicit OSA_AZURE_LOCATION disables automatic region fallback.
if [[ -n "${OSA_AZURE_LOCATION:-}" ]]; then
  LOCATION_CANDIDATES=("${PRIMARY_LOCATION}")
else
  LOCATION_CANDIDATES=(
    northeurope
    westeurope
    swedencentral
    germanywestcentral
    francecentral
  )
fi

if [[ -n "${VM_SIZE_OVERRIDE}" ]]; then
  VM_SIZE_CANDIDATES=("${VM_SIZE_OVERRIDE}")
else
  VM_SIZE_CANDIDATES=(
    Standard_B2ms
    Standard_D2as_v5
    Standard_D2s_v5
    Standard_D2_v5
  )
fi

LOCATION=""
VM_SIZE=""

# Size-first ordering keeps the cheaper B2ms preferred across all candidate regions.
for candidate_size in "${VM_SIZE_CANDIDATES[@]}"; do
  for candidate_location in "${LOCATION_CANDIDATES[@]}"; do
    echo "Checking VM size ${candidate_size} in ${candidate_location} ..."

    allowed="$(az vm list-skus \
      --location "${candidate_location}" \
      --resource-type virtualMachines \
      --size "${candidate_size}" \
      --all \
      --query "[?name=='${candidate_size}' && length(restrictions)==\`0\`].name | [0]" \
      -o tsv 2>/dev/null || true)"

    if [[ "${allowed}" == "${candidate_size}" ]]; then
      LOCATION="${candidate_location}"
      VM_SIZE="${candidate_size}"
      break 2
    fi

    echo "Restricted/unavailable: ${candidate_size} @ ${candidate_location}"
  done
done

if [[ -z "${LOCATION}" || -z "${VM_SIZE}" ]]; then
  echo "BLOCKED: no approved 2-vCPU/8-GB VM SKU is available in the guarded EU region pool." >&2
  echo "No larger VM and no non-EU region will be selected automatically." >&2
  exit 32
fi

echo "Selected worker placement: ${VM_SIZE} @ ${LOCATION}"

REGION_TAG="$(printf '%s' "${LOCATION}" | tr -cd '[:alnum:]-')"
DNS_LABEL="osa-worker-${SUB_SHORT}-${REGION_TAG}"
VNET_NAME="osa-worker-vnet-${REGION_TAG}"
SUBNET_NAME="worker"
NSG_NAME="osa-worker-nsg-${REGION_TAG}"
PIP_NAME="osa-worker-pip-${REGION_TAG}"
NIC_NAME="osa-worker-nic-${REGION_TAG}"

# Cleanup exact legacy pre-VM networking created by earlier V0.1 attempts.
# This runs only while the Worker VM does not exist.
if ! az vm show -g "${RG}" -n "${VM_NAME}" >/dev/null 2>&1; then
  if az network nic show -g "${RG}" -n osa-worker-nic >/dev/null 2>&1; then
    echo "Cleaning legacy pre-VM NIC osa-worker-nic ..."
    az network nic delete -g "${RG}" -n osa-worker-nic --output none
  fi
  if az network public-ip show -g "${RG}" -n osa-worker-pip >/dev/null 2>&1; then
    echo "Cleaning legacy pre-VM Public IP osa-worker-pip ..."
    az network public-ip delete -g "${RG}" -n osa-worker-pip --output none
  fi
  if az network nsg show -g "${RG}" -n osa-worker-nsg >/dev/null 2>&1; then
    echo "Cleaning legacy pre-VM NSG osa-worker-nsg ..."
    az network nsg delete -g "${RG}" -n osa-worker-nsg --output none
  fi
  if az network vnet show -g "${RG}" -n osa-worker-vnet >/dev/null 2>&1; then
    echo "Cleaning legacy pre-VM VNet osa-worker-vnet ..."
    az network vnet delete -g "${RG}" -n osa-worker-vnet --output none
  fi
fi

az network vnet create \
  --resource-group "${RG}" \
  --location "${LOCATION}" \
  --name "${VNET_NAME}" \
  --address-prefixes 10.60.0.0/16 \
  --subnet-name "${SUBNET_NAME}" \
  --subnet-prefixes 10.60.1.0/24 \
  --output none

az network nsg create \
  --resource-group "${RG}" \
  --location "${LOCATION}" \
  --name "${NSG_NAME}" \
  --output none

az network nsg rule create \
  --resource-group "${RG}" \
  --nsg-name "${NSG_NAME}" \
  --name AllowSSH \
  --priority 100 \
  --access Allow \
  --protocol Tcp \
  --direction Inbound \
  --source-address-prefixes Internet \
  --destination-port-ranges 22 \
  --output none

az network nsg rule create \
  --resource-group "${RG}" \
  --nsg-name "${NSG_NAME}" \
  --name AllowHTTP \
  --priority 110 \
  --access Allow \
  --protocol Tcp \
  --direction Inbound \
  --source-address-prefixes Internet \
  --destination-port-ranges 80 \
  --output none

az network nsg rule create \
  --resource-group "${RG}" \
  --nsg-name "${NSG_NAME}" \
  --name AllowHTTPS \
  --priority 120 \
  --access Allow \
  --protocol Tcp \
  --direction Inbound \
  --source-address-prefixes Internet \
  --destination-port-ranges 443 \
  --output none

az network public-ip create \
  --resource-group "${RG}" \
  --location "${LOCATION}" \
  --name "${PIP_NAME}" \
  --sku Standard \
  --allocation-method Static \
  --dns-name "${DNS_LABEL}" \
  --output none

az network nic create \
  --resource-group "${RG}" \
  --location "${LOCATION}" \
  --name "${NIC_NAME}" \
  --vnet-name "${VNET_NAME}" \
  --subnet "${SUBNET_NAME}" \
  --network-security-group "${NSG_NAME}" \
  --public-ip-address "${PIP_NAME}" \
  --output none

if ! az vm show -g "${RG}" -n "${VM_NAME}" >/dev/null 2>&1; then
  echo "Creating ${VM_NAME} as ${VM_SIZE} in ${LOCATION} ..."

  rm -f /tmp/osa-vm-create.err
  if ! az vm create \
    --resource-group "${RG}" \
    --location "${LOCATION}" \
    --name "${VM_NAME}" \
    --nics "${NIC_NAME}" \
    --image Ubuntu2404 \
    --size "${VM_SIZE}" \
    --admin-username "${ADMIN_USER}" \
    --ssh-key-values "${SSH_KEY}.pub" \
    --authentication-type ssh \
    --os-disk-size-gb 64 \
    --storage-sku StandardSSD_LRS \
    --security-type Standard \
    --assign-identity \
    --tags osa=framework component=worker environment=preview autoShutdown=true \
    --output none 2>/tmp/osa-vm-create.err; then
    cat /tmp/osa-vm-create.err >&2
    if grep -Eq 'SkuNotAvailable|Capacity Restrictions|AllocationFailed|ZonalAllocationFailed' /tmp/osa-vm-create.err; then
      echo "Azure capacity changed after SKU discovery. Re-run the script; the guarded selector will probe the current pool again." >&2
      exit 33
    fi
    exit 30
  fi
else
  LOCATION="$(az vm show -g "${RG}" -n "${VM_NAME}" --query location -o tsv)"
  VM_SIZE="$(az vm show -g "${RG}" -n "${VM_NAME}" --query hardwareProfile.vmSize -o tsv)"
fi

PRINCIPAL_ID="$(az vm identity show -g "${RG}" -n "${VM_NAME}" --query principalId -o tsv)"
KV_ID="$(az keyvault show -g "${RG}" -n "${KV_NAME}" --query id -o tsv)"

if ! az role assignment list \
  --assignee-object-id "${PRINCIPAL_ID}" \
  --scope "${KV_ID}" \
  --role "Key Vault Secrets User" \
  --query "[0].id" -o tsv | grep -q .; then
  az role assignment create \
    --assignee-object-id "${PRINCIPAL_ID}" \
    --assignee-principal-type ServicePrincipal \
    --role "Key Vault Secrets User" \
    --scope "${KV_ID}" \
    --output none
fi

az vm auto-shutdown \
  --resource-group "${RG}" \
  --name "${VM_NAME}" \
  --time "${AUTO_SHUTDOWN_UTC}" \
  --output none

FQDN="$(az network public-ip show -g "${RG}" -n "${PIP_NAME}" --query dnsSettings.fqdn -o tsv)"
PUBLIC_IP="$(az network public-ip show -g "${RG}" -n "${PIP_NAME}" --query ipAddress -o tsv)"

echo "Deploying OSA Worker Host to ${FQDN} ..."

BOOTSTRAP_SCRIPT="$(cat <<EOF
set -euo pipefail
export DEBIAN_FRONTEND=noninteractive
if ! command -v az >/dev/null 2>&1; then
  curl -sL https://aka.ms/InstallAzureCLIDeb | bash
fi
az login --identity --allow-no-subscriptions >/dev/null
TOKEN=""
for i in $(seq 1 30); do
  TOKEN=\$(az keyvault secret show --vault-name "${KV_NAME}" --name osa-worker-token --query value -o tsv 2>/dev/null || true)
  if [ -n "\${TOKEN}" ]; then break; fi
  sleep 10
done
if [ -z "\${TOKEN}" ]; then
  echo "Unable to retrieve worker token from Key Vault" >&2
  exit 31
fi
export OSA_WORKER_TOKEN="\${TOKEN}"
export OSA_WORKER_DOMAIN="${FQDN}"
export OSA_WORKER_BRANCH="${BRANCH}"
export OSA_REPO_URL="${REPO_URL}"
apt-get update
apt-get install -y --no-install-recommends git ca-certificates curl
rm -rf /tmp/osa-worker-bootstrap
git clone --branch "${BRANCH}" --depth 1 "${REPO_URL}" /tmp/osa-worker-bootstrap
bash /tmp/osa-worker-bootstrap/deploy/worker/bootstrap.sh
unset TOKEN OSA_WORKER_TOKEN
EOF
)"

az vm run-command invoke \
  --resource-group "${RG}" \
  --name "${VM_NAME}" \
  --command-id RunShellScript \
  --scripts "${BOOTSTRAP_SCRIPT}" \
  --query "value[0].message" -o tsv

for i in $(seq 1 40); do
  if curl -fsS --max-time 10 "https://${FQDN}/health" >/tmp/osa-azure-worker-health.json 2>/dev/null; then
    break
  fi
  sleep 5
done

if [[ ! -s /tmp/osa-azure-worker-health.json ]]; then
  echo "Worker public HTTPS health check failed." >&2
  echo "Check: az vm run-command invoke -g ${RG} -n ${VM_NAME} --command-id RunShellScript --scripts 'cd /opt/osa-worker && docker compose --env-file deploy/worker/.env -f deploy/worker/compose.yml ps && docker compose --env-file deploy/worker/.env -f deploy/worker/compose.yml logs --tail=100'" >&2
  exit 40
fi

cat /tmp/osa-azure-worker-health.json
echo

cat > "${HOME}/osa-worker-control-plane.env" <<EOF
OSA_BUILDER_MODE=native
OSA_WORKSPACE_PROVIDER=remote
OSA_WORKER_BASE_URL=https://${FQDN}
OSA_WORKER_TOKEN=$(az keyvault secret show --vault-name "${KV_NAME}" --name osa-worker-token --query value -o tsv)
OSA_WORKER_REQUEST_TIMEOUT_MS=120000
EOF
chmod 600 "${HOME}/osa-worker-control-plane.env"

echo
echo "AZURE WORKER DEPLOY V0.1: PASS"
echo "Worker URL: https://${FQDN}"
echo "Worker IP: ${PUBLIC_IP}"
echo "Worker location: ${LOCATION}"
echo "VM size: ${VM_SIZE}"
echo "Monthly RG budget: ${BUDGET_AMOUNT}"
echo "Auto-shutdown UTC: ${AUTO_SHUTDOWN_UTC}"
echo "Control-plane env saved securely to: ${HOME}/osa-worker-control-plane.env"
echo "SSH: ssh -i ${SSH_KEY} ${ADMIN_USER}@${FQDN}"

# Azure Worker Deploy V0.1

This slice deploys the OSA Worker Host to a dedicated Azure Linux VM.

## Cost guards

The deploy script refuses to create billable compute unless Azure reports:

```text
subscriptionPolicies.spendingLimit = On
```

That is the hard subscription-level guard for eligible credit/free subscriptions.

It also creates a resource-group budget before the VM and configures daily VM
auto-shutdown. Azure budgets are alerts, not hard stops.

Defaults:

```text
resource group: rg-osa-worker
region: northeurope
VM: Standard_B2ms
budget: 40 (subscription billing currency)
auto-shutdown: 01:00 UTC
```

Override with:

```bash
export OSA_AZURE_BUDGET_AMOUNT=30
export OSA_AZURE_VM_SIZE=Standard_B2ms
export OSA_AZURE_AUTO_SHUTDOWN_UTC=0100
```

## Run

Use Azure Cloud Shell:

```bash
git clone --branch feature/azure-worker-deploy-v0.1 --depth 1 https://github.com/HazEOskA/osa-proof.git
cd osa-proof
bash deploy/azure-worker/deploy.sh
```

The script creates:

- dedicated resource group,
- resource-group monthly budget,
- VNet/subnet/NSG,
- static Public IP with Azure DNS name,
- Ubuntu 24.04 VM,
- system-assigned managed identity,
- Azure Key Vault secret for the worker token,
- Key Vault RBAC assignment,
- daily VM auto-shutdown,
- Docker/Caddy/OSA Worker Host,
- public TLS endpoint.

The worker token is stored in Key Vault and written to
`~/osa-worker-control-plane.env` in Cloud Shell with mode 0600. It is not
committed to Git.

## Safety

Do not remove the Azure subscription spending limit for this deployment.

The script aborts before VM creation when the reported spending limit is not
`On`.

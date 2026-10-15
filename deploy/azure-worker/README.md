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
VM: guarded 2-vCPU / 8-GB candidate pool (B2ms -> D2as_v5 -> D2s_v5 -> D2_v5)
budget: 40 (subscription billing currency)
auto-shutdown: 01:00 UTC
```

Override with:

```bash
export OSA_AZURE_BUDGET_AMOUNT=30
export OSA_AZURE_VM_SIZE=Standard_D2as_v5
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


## Capacity fallback

Azure can report a SKU as unavailable in a region even when the VM family is
generally supported. The deploy script therefore tries only a bounded set of
2-vCPU / 8-GB SKUs and never auto-escalates to a larger VM:

```text
Standard_B2ms
Standard_D2as_v5
Standard_D2s_v5
Standard_D2_v5
```

SKUs that Azure marks as restricted for the subscription are skipped. If
preflight still returns a capacity/allocation error, the next candidate is
tried. Any non-capacity error stops the deployment immediately.


## Guarded EU region fallback

When the preferred region has subscription or capacity restrictions, the deploy
script probes only this EU pool:

```text
northeurope
westeurope
swedencentral
germanywestcentral
francecentral
```

Selection is size-first, so `Standard_B2ms` is preferred across all candidate
regions before moving to the more expensive D-series candidates. The deploy
never auto-selects a larger VM and never leaves the EU region pool.

Set `OSA_AZURE_LOCATION` explicitly to disable automatic region fallback.

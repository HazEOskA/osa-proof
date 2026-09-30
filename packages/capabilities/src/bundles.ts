import { ExecutorRegistry } from "../../runtime/src";
import { digest } from "../../proof-core/src";
import { Capability, CapabilityCatalog } from "./index";
export interface IntegrationBundle { schema:"osa.integration_bundle.v1"; bundle_id:string; version:string; kind:"SKILL"|"PLUGIN"; capabilities:Capability[]; bundle_sha256:string }
/** Declarative bundle binds known executors; never require()/eval()/install untrusted packages in control plane. */
export function registerIntegrationBundle(bundle:IntegrationBundle,catalog:CapabilityCatalog,registry:ExecutorRegistry):void {
  const {bundle_sha256,...body}=bundle;
  if(digest(body)!==bundle_sha256 || bundle.schema!=="osa.integration_bundle.v1" || !bundle.bundle_id || !bundle.version || !["SKILL","PLUGIN"].includes(bundle.kind) || !bundle.capabilities.length || bundle.capabilities.some(c=>c.kind!==bundle.kind || c.version!==bundle.version))throw new Error("INTEGRATION_BUNDLE_INVALID");
  // Resolve all dependencies before any registration.
  const executors=bundle.capabilities.map(c=>registry.get(c.executor_ref));
  catalog.registerBatch(bundle.capabilities.map((definition,i)=>({definition,execute:executors[i]})));
}

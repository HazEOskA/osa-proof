import { Server } from "node:http";
import { createApiServer } from "./index";
import { AgentExecutor } from "../../../packages/contracts/src";
import { ExecutorRegistry } from "../../../packages/runtime/src";
import {
  createBuilderBridgeExecutor,
  createCapabilityRouterExecutor,
  createExecutionForceExecutor,
  createFleetChatExecutor,
  createModelProvider,
  createOsaAgentControlExecutor,
  createProviderBuilderExecutor,
  createProviderPlannerExecutor,
  describeIntegrationRegistry,
  loadIntegrationConfig,
  loadProviderConfig,
  ModelProvider,
} from "../../../packages/adapters/src";

type Env = Record<string, string | undefined>;

// Stable DEV executor refs. Team Graph and UI reference only these; the server
// decides (via OSA_EXECUTION_MODE) which implementation is registered under them.
export const DEV_PLANNER_REF = "dev.planner.v1";
export const DEV_BUILDER_REF = "dev.builder.v1";

export type ExecutionMode = "fixture" | "provider";

export class ExecutionConfigError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExecutionConfigError";
  }
}

export function loadExecutionMode(env: Env): ExecutionMode {
  const mode = env.OSA_EXECUTION_MODE?.trim();
  if (mode === "fixture" || mode === "provider") return mode;
  throw new ExecutionConfigError(
    mode ? "OSA_EXECUTION_MODE must be one of: fixture, provider" : "OSA_EXECUTION_MODE is required (fixture | provider)"
  );
}

const fixturePlanner: AgentExecutor = ({ input, mission }) => ({
  output: {
    plan: "fixture-build",
    objective: mission.objective,
    received: input,
  },
  evidence: [
    {
      kind: "plan",
      data: {
        status: "ready",
        objective: mission.objective,
        source: "dev-fixture",
      },
    },
  ],
});

const fixtureBuilder: AgentExecutor = ({ input, mission }) => ({
  output: {
    artifact: "dev-fixture-artifact.txt",
    objective: mission.objective,
    upstream: input,
  },
  evidence: [
    {
      kind: "artifact",
      data: {
        status: "built",
        artifact: "dev-fixture-artifact.txt",
        objective: mission.objective,
        source: "dev-fixture",
      },
    },
  ],
});

export function createDevFixtureRegistry(): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  registry.register(DEV_PLANNER_REF, fixturePlanner);
  registry.register(DEV_BUILDER_REF, fixtureBuilder);
  // Legacy explicit fixture refs, available only in fixture mode.
  registry.register("dev.planner.fixture.v1", fixturePlanner);
  registry.register("dev.builder.fixture.v1", fixtureBuilder);
  return registry;
}

export function createDevProviderRegistry(provider: ModelProvider): ExecutorRegistry {
  const registry = new ExecutorRegistry();
  registry.register(DEV_PLANNER_REF, createProviderPlannerExecutor(provider));
  registry.register(DEV_BUILDER_REF, createProviderBuilderExecutor(provider));
  return registry;
}

function installIntegrationRouter(
  registry: ExecutorRegistry,
  env: Env,
  fallbackBuilder: AgentExecutor
): Record<string, unknown> {
  const integration = loadIntegrationConfig(env);
  if (!integration.enabled) return {};

  registry.register(
    DEV_BUILDER_REF,
    createCapabilityRouterExecutor({
      fallback: fallbackBuilder,
      builder: integration.builder ? createBuilderBridgeExecutor(integration.builder) : undefined,
      executionForce: integration.executionForce
        ? createExecutionForceExecutor(integration.executionForce)
        : undefined,
      osaAgent: integration.osaAgent
        ? createOsaAgentControlExecutor(integration.osaAgent)
        : undefined,
      fleet: integration.fleet ? createFleetChatExecutor(integration.fleet) : undefined,
    })
  );

  return {
    integration: "v0.1",
    registry: describeIntegrationRegistry(integration),
  };
}

export interface DevExecution {
  mode: ExecutionMode;
  registry: ExecutorRegistry;
  // Safe to log: never contains credentials.
  description: Record<string, unknown>;
}

// Fails closed on missing/unknown mode and on incomplete provider configuration.
export function createDevExecution(env: Env): DevExecution {
  const mode = loadExecutionMode(env);
  if (mode === "fixture") {
    const registry = createDevFixtureRegistry();
    const integration = installIntegrationRouter(registry, env, fixtureBuilder);
    return { mode, registry, description: { mode, ...integration } };
  }

  const config = loadProviderConfig(env);
  const provider = createModelProvider(config);
  const registry = createDevProviderRegistry(provider);
  const integration = installIntegrationRouter(registry, env, createProviderBuilderExecutor(provider));
  return {
    mode,
    registry,
    description: { mode, provider: config.provider, model: config.model, ...integration },
  };
}

export function startApiServer(env: Env = process.env): Server {
  const port = Number(env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid PORT: ${env.PORT ?? "3000"}`);
  }

  const host = env.HOST ?? "0.0.0.0";
  const execution = createDevExecution(env);
  const server = createApiServer(execution.registry);
  server.listen(port, host, () => {
    console.log(JSON.stringify({
      service: "osa-proof-api",
      ...execution.description,
      host,
      port,
    }));
  });
  return server;
}

if (require.main === module) {
  try {
    startApiServer();
  } catch (error) {
    console.error(JSON.stringify({
      service: "osa-proof-api",
      error: error instanceof Error ? error.name : "Error",
      message: error instanceof Error ? error.message : String(error),
    }));
    process.exit(1);
  }
}

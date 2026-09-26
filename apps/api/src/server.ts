import { Server } from "node:http";
import { createApiServer } from "./index";
import { ExecutorRegistry } from "../../../packages/runtime/src";

export function createDevFixtureRegistry(): ExecutorRegistry {
  const registry = new ExecutorRegistry();

  registry.register("dev.planner.fixture.v1", ({ input, mission }) => ({
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
  }));

  registry.register("dev.builder.fixture.v1", ({ input, mission }) => ({
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
  }));

  return registry;
}

export function startApiServer(): Server {
  const port = Number(process.env.PORT ?? "3000");
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    throw new Error(`invalid PORT: ${process.env.PORT ?? "3000"}`);
  }

  const host = process.env.HOST ?? "0.0.0.0";
  const server = createApiServer(createDevFixtureRegistry());
  server.listen(port, host, () => {
    console.log(JSON.stringify({
      service: "osa-proof-api",
      mode: "dev-fixture",
      host,
      port,
    }));
  });
  return server;
}

if (require.main === module) {
  startApiServer();
}

import type { WorkspaceHandle } from "../../workspace-runtime/src";
import { fileExists, readTextFile, runInProject } from "./commands";
import type {
  BuilderEventSink,
  ValidationCheck,
  ValidationGateName,
  ValidationResult,
} from "./types";

type PackageManager = "pnpm" | "yarn" | "npm";

const VALIDATION_GATES: readonly ValidationGateName[] = [
  "type-check",
  "lint",
  "build",
  "test",
];

async function emit(
  sink: BuilderEventSink | undefined,
  event: Parameters<BuilderEventSink>[0]
): Promise<void> {
  await sink?.(event);
}

async function detectPackageManager(
  workspace: WorkspaceHandle,
  packageManager?: unknown
): Promise<PackageManager> {
  if (typeof packageManager === "string") {
    if (packageManager.startsWith("pnpm@")) return "pnpm";
    if (packageManager.startsWith("yarn@")) return "yarn";
    if (packageManager.startsWith("npm@")) return "npm";
  }

  if (await fileExists(workspace, "pnpm-lock.yaml")) return "pnpm";
  if (await fileExists(workspace, "yarn.lock")) return "yarn";
  return "npm";
}

function installArgs(packageManager: PackageManager): string[] {
  if (packageManager === "pnpm") return ["install", "--frozen-lockfile"];
  if (packageManager === "yarn") return ["install", "--frozen-lockfile"];
  return [];
}

export async function installProjectDependencies(
  workspace: WorkspaceHandle,
  emitEvent?: BuilderEventSink
): Promise<{ packageManager?: PackageManager; installed: boolean }> {
  const packageJsonRaw = await readTextFile(workspace, "package.json");
  if (!packageJsonRaw) {
    await emit(emitEvent, {
      stage: "dependencies",
      status: "skipped",
      detail: "package.json not found",
    });
    return { installed: false };
  }

  let packageJson: { packageManager?: string };
  try {
    packageJson = JSON.parse(packageJsonRaw);
  } catch {
    throw new Error("BUILDER_PACKAGE_JSON_INVALID");
  }

  const packageManager = await detectPackageManager(workspace, packageJson.packageManager);
  await emit(emitEvent, {
    stage: "dependencies",
    status: "started",
    data: { package_manager: packageManager },
  });

  let result;
  if (packageManager === "npm") {
    const hasLock = await fileExists(workspace, "package-lock.json");
    result = await runInProject(
      workspace,
      "npm",
      hasLock
        ? ["ci", "--no-audit", "--no-fund"]
        : ["install", "--no-audit", "--no-fund"]
    );
  } else {
    result = await runInProject(workspace, packageManager, installArgs(packageManager));
  }

  if (result.exitCode !== 0) {
    await emit(emitEvent, {
      stage: "dependencies",
      status: "failed",
      detail: result.stderr || `${packageManager} install failed`,
    });
    return { packageManager, installed: false };
  }

  await emit(emitEvent, {
    stage: "dependencies",
    status: "completed",
    data: { package_manager: packageManager },
  });
  return { packageManager, installed: true };
}

async function dependenciesAvailable(workspace: WorkspaceHandle): Promise<boolean> {
  for (const marker of ["node_modules", ".pnp.cjs", ".pnp.js"]) {
    if (await fileExists(workspace, marker)) return true;
  }
  return false;
}

function scriptArgs(packageManager: PackageManager, script: ValidationGateName): string[] {
  return packageManager === "yarn" ? [script] : ["run", script];
}

function unresolvedChecks(packageJson: {
  scripts?: Record<string, string>;
}): ValidationCheck[] {
  return VALIDATION_GATES.map((name) => ({
    name,
    status: packageJson.scripts?.[name] ? "UNKNOWN" : "NOT_CONFIGURED",
  }));
}

export function validationAllowsPush(result: ValidationResult): boolean {
  return (
    result.status === "PASS" &&
    result.checks.every(
      (check) => check.status === "PASS" || check.status === "NOT_CONFIGURED"
    )
  );
}

export async function validateRepository(
  workspace: WorkspaceHandle,
  emitEvent?: BuilderEventSink
): Promise<ValidationResult> {
  await emit(emitEvent, { stage: "validation", status: "started" });

  const packageJsonRaw = await readTextFile(workspace, "package.json");
  if (!packageJsonRaw) {
    const result: ValidationResult = {
      status: "UNKNOWN",
      checks: VALIDATION_GATES.map((name) => ({ name, status: "UNKNOWN" })),
    };
    await emit(emitEvent, {
      stage: "validation",
      status: "failed",
      detail: "package.json not found",
    });
    return result;
  }

  let packageJson: {
    scripts?: Record<string, string>;
    packageManager?: string;
  };
  try {
    packageJson = JSON.parse(packageJsonRaw);
  } catch {
    const result: ValidationResult = {
      status: "UNKNOWN",
      checks: VALIDATION_GATES.map((name) => ({ name, status: "UNKNOWN" })),
    };
    await emit(emitEvent, {
      stage: "validation",
      status: "failed",
      detail: "package.json is invalid JSON",
    });
    return result;
  }

  const packageManager = await detectPackageManager(
    workspace,
    packageJson.packageManager
  );
  const hasConfiguredGate = VALIDATION_GATES.some((name) =>
    Boolean(packageJson.scripts?.[name])
  );

  if (hasConfiguredGate && !(await dependenciesAvailable(workspace))) {
    const installed = await installProjectDependencies(workspace, emitEvent);
    if (!installed.installed) {
      const result: ValidationResult = {
        status: "UNKNOWN",
        checks: unresolvedChecks(packageJson),
      };
      await emit(emitEvent, {
        stage: "validation",
        status: "failed",
        detail: "validation dependency bootstrap failed",
      });
      return result;
    }
  }

  const checks: ValidationCheck[] = [];

  for (const name of VALIDATION_GATES) {
    if (!packageJson.scripts?.[name]) {
      checks.push({ name, status: "NOT_CONFIGURED" });
      continue;
    }

    const commandResult = await runInProject(
      workspace,
      packageManager,
      scriptArgs(packageManager, name)
    );

    checks.push(
      commandResult.exitCode === 0
        ? { name, status: "PASS", exitCode: 0 }
        : { name, status: "FAIL", exitCode: commandResult.exitCode }
    );
  }

  const status = checks.some((check) => check.status === "UNKNOWN")
    ? "UNKNOWN"
    : checks.some((check) => check.status === "FAIL")
      ? "FAIL"
      : "PASS";

  await emit(emitEvent, {
    stage: "validation",
    status: status === "PASS" ? "completed" : "failed",
    data: {
      status,
      checks: checks.map((check) => ({
        name: check.name,
        status: check.status,
        exit_code: check.exitCode,
      })),
    },
  });

  return { status, checks };
}

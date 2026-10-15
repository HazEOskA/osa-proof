import type { WorkspaceHandle } from "../../workspace-runtime/src";
import { runInProject } from "./commands";
import type {
  BuilderAgentResult,
  BuilderAgentRunInput,
  BuilderAgentType,
} from "./types";

async function emit(
  input: BuilderAgentRunInput,
  status: "started" | "completed" | "failed",
  detail?: string,
  data?: Record<string, unknown>
): Promise<void> {
  await input.emit?.({
    stage: "agent",
    status,
    detail,
    data,
  });
}

async function hasCommand(
  workspace: WorkspaceHandle,
  command: string
): Promise<boolean> {
  return (await workspace.exec("which", [command])).exitCode === 0;
}

async function detectChanges(
  workspace: WorkspaceHandle
): Promise<boolean> {
  const status = await runInProject(workspace, "git", ["status", "--porcelain"]);
  return status.exitCode === 0 && Boolean(status.stdout.trim());
}

async function runClaude(input: BuilderAgentRunInput): Promise<BuilderAgentResult> {
  const key = input.credentials?.anthropicApiKey?.trim();
  if (!key) {
    return {
      success: false,
      cliName: "claude",
      changesDetected: false,
      error: "ANTHROPIC_API_KEY_REQUIRED",
    };
  }

  if (!(await hasCommand(input.workspace, "claude"))) {
    const install = await input.workspace.exec("sh", [
      "-lc",
      "curl -fsSL https://claude.ai/install.sh | bash",
    ]);
    if (install.exitCode !== 0) {
      return {
        success: false,
        cliName: "claude",
        changesDetected: false,
        error: "CLAUDE_CLI_INSTALL_FAILED",
      };
    }
  }

  const args: string[] = [
    "--permission-mode",
    "acceptEdits",
    "--print",
  ];

  if (input.selectedModel?.trim()) {
    args.push("--model", input.selectedModel.trim());
  }

  args.push(input.prompt);

  const result = await runInProject(
    input.workspace,
    "claude",
    args,
    {
      env: {
        ANTHROPIC_API_KEY: key,
        CI: "true",
      },
      timeoutMs: 20 * 60_000,
    }
  );

  const changed = await detectChanges(input.workspace);
  return {
    success: result.exitCode === 0,
    cliName: "claude",
    changesDetected: changed,
    output: result.stdout.trim() || undefined,
    error: result.exitCode === 0 ? undefined : result.stderr.trim() || "CLAUDE_CLI_FAILED",
  };
}

async function runCodex(input: BuilderAgentRunInput): Promise<BuilderAgentResult> {
  const key = input.credentials?.openaiApiKey?.trim();
  if (!key) {
    return {
      success: false,
      cliName: "codex",
      changesDetected: false,
      error: "OPENAI_API_KEY_REQUIRED",
    };
  }

  if (!(await hasCommand(input.workspace, "codex"))) {
    const install = await input.workspace.exec(
      "npm",
      ["install", "-g", "@openai/codex"],
      { timeoutMs: 5 * 60_000 }
    );
    if (install.exitCode !== 0) {
      return {
        success: false,
        cliName: "codex",
        changesDetected: false,
        error: "CODEX_CLI_INSTALL_FAILED",
      };
    }
  }

  const args = ["exec", "--sandbox", "workspace-write"];
  if (input.selectedModel?.trim()) {
    args.push("--model", input.selectedModel.trim());
  }
  args.push(input.prompt);

  const result = await runInProject(
    input.workspace,
    "codex",
    args,
    {
      env: {
        OPENAI_API_KEY: key,
        CI: "true",
      },
      timeoutMs: 20 * 60_000,
    }
  );

  const changed = await detectChanges(input.workspace);
  return {
    success: result.exitCode === 0,
    cliName: "codex",
    changesDetected: changed,
    output: result.stdout.trim() || undefined,
    error: result.exitCode === 0 ? undefined : result.stderr.trim() || "CODEX_CLI_FAILED",
  };
}

export interface BuilderAgentRunner {
  run(input: BuilderAgentRunInput): Promise<BuilderAgentResult>;
}

export class CommandBuilderAgentRunner implements BuilderAgentRunner {
  async run(input: BuilderAgentRunInput): Promise<BuilderAgentResult> {
    await emit(input, "started", undefined, {
      agent: input.selectedAgent,
      model: input.selectedModel,
    });

    let result: BuilderAgentResult;
    switch (input.selectedAgent) {
      case "claude":
        result = await runClaude(input);
        break;
      case "codex":
        result = await runCodex(input);
        break;
      default: {
        const neverAgent: never = input.selectedAgent;
        throw new Error(`UNSUPPORTED_BUILDER_AGENT: ${String(neverAgent)}`);
      }
    }

    await emit(
      input,
      result.success ? "completed" : "failed",
      result.error,
      {
        agent: result.cliName,
        changes_detected: result.changesDetected,
      }
    );

    return result;
  }
}

export function parseBuilderAgent(value: unknown): BuilderAgentType {
  if (value === undefined || value === null || value === "") return "claude";
  if (value === "claude" || value === "codex") return value;
  throw new Error("BUILDER_AGENT_UNSUPPORTED");
}

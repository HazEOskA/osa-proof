import type { WorkspaceProvider } from "../../workspace-runtime/src";
import { CommandBuilderAgentRunner, type BuilderAgentRunner } from "./agents";
import { installProjectDependencies } from "./validation";
import { prepareRepository, validateCommitAndPush } from "./git";
import type {
  BuilderEventSink,
  BuilderRequest,
  NativeBuilderResult,
} from "./types";

export interface NativeBuilderOptions {
  workspaceProvider: WorkspaceProvider;
  agentRunner?: BuilderAgentRunner;
}

export class NativeBuilder {
  private readonly workspaceProvider: WorkspaceProvider;
  private readonly agentRunner: BuilderAgentRunner;

  constructor(options: NativeBuilderOptions) {
    this.workspaceProvider = options.workspaceProvider;
    this.agentRunner = options.agentRunner ?? new CommandBuilderAgentRunner();
  }

  async run(
    request: BuilderRequest,
    emit?: BuilderEventSink
  ): Promise<NativeBuilderResult> {
    let workspaceId: string | undefined;
    let branchName: string | undefined;
    let changed = false;
    let pushed = false;

    const workspace = await this.workspaceProvider.create({
      workspaceId: request.taskId,
      timeoutMs: request.timeoutMs,
      runtime: "node22",
      cpu: 4,
      memoryMb: 4096,
    });
    workspaceId = workspace.id;

    await emit?.({
      stage: "workspace",
      status: "completed",
      data: {
        workspace_id: workspace.id,
        workspace_provider: this.workspaceProvider.id,
      },
    });

    try {
      const prepared = await prepareRepository(workspace, request, emit);
      branchName = prepared.branchName;

      if (request.installDependencies) {
        const dependencies = await installProjectDependencies(workspace, emit);
        if (!dependencies.installed) {
          throw new Error("BUILDER_DEPENDENCY_INSTALL_FAILED");
        }
      } else {
        await emit?.({
          stage: "dependencies",
          status: "skipped",
          detail: "dependency installation deferred to validation",
        });
      }

      const agent = await this.agentRunner.run({
        workspace,
        projectDir: "/workspace/project",
        prompt: request.prompt,
        selectedAgent: request.selectedAgent,
        selectedModel: request.selectedModel,
        credentials: request.credentials,
        emit,
      });

      if (!agent.success) {
        return {
          status: "failed",
          taskId: request.taskId,
          workspaceId,
          workspaceProvider: this.workspaceProvider.id,
          repoUrl: request.repoUrl,
          branchName,
          selectedAgent: request.selectedAgent,
          selectedModel: request.selectedModel,
          changed: agent.changesDetected,
          pushed: false,
          agent,
          error: agent.error || "BUILDER_AGENT_FAILED",
        };
      }

      const git = await validateCommitAndPush(
        workspace,
        request,
        branchName,
        prepared.gitEnv,
        emit
      );

      changed = git.changed;
      pushed = git.pushed;

      return {
        status: "completed",
        taskId: request.taskId,
        workspaceId,
        workspaceProvider: this.workspaceProvider.id,
        repoUrl: request.repoUrl,
        branchName,
        selectedAgent: request.selectedAgent,
        selectedModel: request.selectedModel,
        validation: git.validation,
        changed,
        pushed,
        agent,
      };
    } catch (error) {
      return {
        status: "failed",
        taskId: request.taskId,
        workspaceId,
        workspaceProvider: this.workspaceProvider.id,
        repoUrl: request.repoUrl,
        branchName,
        selectedAgent: request.selectedAgent,
        selectedModel: request.selectedModel,
        changed,
        pushed,
        error: error instanceof Error ? error.message : String(error),
      };
    } finally {
      await emit?.({ stage: "cleanup", status: "started" });
      try {
        await workspace.stop();
        await emit?.({
          stage: "cleanup",
          status: "completed",
          data: { workspace_id: workspace.id },
        });
      } catch (error) {
        await emit?.({
          stage: "cleanup",
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
  }
}

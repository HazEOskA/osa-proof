import { Buffer } from "node:buffer";
import type { WorkspaceHandle } from "../../workspace-runtime/src";
import { PROJECT_DIR, runInProject, sanitizeBranchSegment } from "./commands";
import { validateRepository, validationAllowsPush } from "./validation";
import type {
  BuilderEventSink,
  BuilderRequest,
  ValidationResult,
} from "./types";

function githubAuthEnv(repoUrl: string, token?: string): Record<string, string> {
  if (!token) return { GIT_TERMINAL_PROMPT: "0" };

  let url: URL;
  try {
    url = new URL(repoUrl);
  } catch {
    throw new Error("BUILDER_REPO_URL_INVALID");
  }

  if (url.protocol !== "https:" && url.protocol !== "http:") {
    throw new Error("BUILDER_REPO_URL_UNSUPPORTED");
  }

  const scope = `${url.protocol}//${url.host}/`;
  const authorization = Buffer.from(`x-access-token:${token}`).toString("base64");

  return {
    GIT_CONFIG_COUNT: "1",
    GIT_CONFIG_KEY_0: `http.${scope}.extraheader`,
    GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${authorization}`,
    GIT_TERMINAL_PROMPT: "0",
  };
}

async function emit(
  sink: BuilderEventSink | undefined,
  event: Parameters<BuilderEventSink>[0]
): Promise<void> {
  await sink?.(event);
}

function defaultBranchName(taskId: string): string {
  return `osa/${sanitizeBranchSegment(taskId).slice(0, 80)}`;
}

export async function prepareRepository(
  workspace: WorkspaceHandle,
  request: BuilderRequest,
  emitEvent?: BuilderEventSink
): Promise<{ branchName: string; gitEnv: Record<string, string> }> {
  await emit(emitEvent, {
    stage: "repo",
    status: "started",
    data: { repo_url: request.repoUrl },
  });

  const gitEnv = githubAuthEnv(request.repoUrl, request.credentials?.githubToken);

  const mkdir = await workspace.exec("mkdir", ["-p", PROJECT_DIR]);
  if (mkdir.exitCode !== 0) {
    throw new Error("BUILDER_WORKSPACE_PROJECT_DIR_CREATE_FAILED");
  }

  const clone = await workspace.exec(
    "git",
    ["clone", "--depth", "1", request.repoUrl, PROJECT_DIR],
    { env: gitEnv }
  );

  if (clone.exitCode !== 0) {
    await emit(emitEvent, {
      stage: "repo",
      status: "failed",
      detail: clone.stderr || "git clone failed",
    });
    throw new Error("BUILDER_GIT_CLONE_FAILED");
  }

  const authorName = request.gitAuthorName?.trim() || "OSA Builder";
  const authorEmail =
    request.gitAuthorEmail?.trim() || "osa-builder@users.noreply.github.com";

  const nameResult = await runInProject(
    workspace,
    "git",
    ["config", "user.name", authorName]
  );
  const emailResult = await runInProject(
    workspace,
    "git",
    ["config", "user.email", authorEmail]
  );

  if (nameResult.exitCode !== 0 || emailResult.exitCode !== 0) {
    throw new Error("BUILDER_GIT_IDENTITY_CONFIG_FAILED");
  }

  const branchName = sanitizeBranchSegment(
    request.branchName?.trim() || defaultBranchName(request.taskId)
  );

  const remoteBranch = await runInProject(
    workspace,
    "git",
    ["ls-remote", "--heads", "origin", branchName],
    { env: gitEnv }
  );

  if (remoteBranch.exitCode === 0 && remoteBranch.stdout.trim()) {
    const fetch = await runInProject(
      workspace,
      "git",
      ["fetch", "origin", `${branchName}:${branchName}`],
      { env: gitEnv }
    );
    if (fetch.exitCode !== 0) {
      throw new Error("BUILDER_GIT_BRANCH_FETCH_FAILED");
    }

    const checkout = await runInProject(
      workspace,
      "git",
      ["checkout", branchName]
    );
    if (checkout.exitCode !== 0) {
      throw new Error("BUILDER_GIT_BRANCH_CHECKOUT_FAILED");
    }
  } else {
    const checkout = await runInProject(
      workspace,
      "git",
      ["checkout", "-b", branchName]
    );
    if (checkout.exitCode !== 0) {
      throw new Error("BUILDER_GIT_BRANCH_CREATE_FAILED");
    }
  }

  const origin = await runInProject(
    workspace,
    "git",
    ["remote", "get-url", "origin"]
  );
  if (origin.exitCode !== 0 || /https?:\/\/[^/@]+@/i.test(origin.stdout.trim())) {
    throw new Error("BUILDER_GIT_ORIGIN_CREDENTIAL_CHECK_FAILED");
  }

  await emit(emitEvent, {
    stage: "repo",
    status: "completed",
    data: { branch_name: branchName },
  });

  return { branchName, gitEnv };
}

export async function validateCommitAndPush(
  workspace: WorkspaceHandle,
  request: BuilderRequest,
  branchName: string,
  gitEnv: Record<string, string>,
  emitEvent?: BuilderEventSink
): Promise<{
  changed: boolean;
  pushed: boolean;
  validation: ValidationResult;
}> {
  const status = await runInProject(workspace, "git", ["status", "--porcelain"]);
  if (status.exitCode !== 0) {
    throw new Error("BUILDER_GIT_STATUS_FAILED");
  }

  if (!status.stdout.trim()) {
    await emit(emitEvent, {
      stage: "git",
      status: "skipped",
      detail: "no file changes",
    });

    return {
      changed: false,
      pushed: false,
      validation: {
        status: "PASS",
        checks: [],
      },
    };
  }

  const validation = await validateRepository(workspace, emitEvent);
  if (!validationAllowsPush(validation)) {
    throw new Error("BUILDER_VALIDATION_BLOCKED_PUSH");
  }

  await emit(emitEvent, { stage: "git", status: "started" });

  const add = await runInProject(workspace, "git", ["add", "."]);
  if (add.exitCode !== 0) throw new Error("BUILDER_GIT_ADD_FAILED");

  const commitMessage = `build(osa): ${request.prompt
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 72) || request.taskId}`;

  const commit = await runInProject(
    workspace,
    "git",
    ["commit", "-m", commitMessage]
  );
  if (commit.exitCode !== 0) {
    throw new Error("BUILDER_GIT_COMMIT_FAILED");
  }

  const push = await runInProject(
    workspace,
    "git",
    ["push", "-u", "origin", branchName],
    { env: gitEnv }
  );
  if (push.exitCode !== 0) {
    throw new Error("BUILDER_GIT_PUSH_FAILED");
  }

  await emit(emitEvent, {
    stage: "git",
    status: "completed",
    data: { branch_name: branchName },
  });

  return { changed: true, pushed: true, validation };
}

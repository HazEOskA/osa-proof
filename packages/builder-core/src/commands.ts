import type {
  WorkspaceCommandOptions,
  WorkspaceCommandResult,
  WorkspaceHandle,
} from "../../workspace-runtime/src";

export const PROJECT_DIR = "/workspace/project";

export async function runCommand(
  workspace: WorkspaceHandle,
  command: string,
  args: readonly string[] = [],
  options: WorkspaceCommandOptions = {}
): Promise<WorkspaceCommandResult> {
  return workspace.exec(command, args, options);
}

export async function runInProject(
  workspace: WorkspaceHandle,
  command: string,
  args: readonly string[] = [],
  options: Omit<WorkspaceCommandOptions, "cwd"> = {}
): Promise<WorkspaceCommandResult> {
  return workspace.exec(command, args, { ...options, cwd: PROJECT_DIR });
}

export function commandSucceeded(result: WorkspaceCommandResult): boolean {
  return result.exitCode === 0;
}

export async function fileExists(
  workspace: WorkspaceHandle,
  path: string,
  cwd = PROJECT_DIR
): Promise<boolean> {
  return commandSucceeded(await workspace.exec("test", ["-e", path], { cwd }));
}

export async function readTextFile(
  workspace: WorkspaceHandle,
  path: string,
  cwd = PROJECT_DIR
): Promise<string | undefined> {
  const result = await workspace.exec("cat", [path], { cwd });
  return commandSucceeded(result) ? result.stdout : undefined;
}

export function sanitizeBranchSegment(value: string): string {
  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9._/-]+/g, "-")
    .replace(/\.{2,}/g, ".")
    .replace(/\/{2,}/g, "/")
    .replace(/^[-./]+|[-./]+$/g, "");

  return normalized || "task";
}

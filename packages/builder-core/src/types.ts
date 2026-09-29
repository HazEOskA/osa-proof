import type { WorkspaceHandle } from "../../workspace-runtime/src";

export type BuilderAgentType = "claude" | "codex";
export type ValidationStatus = "PASS" | "FAIL" | "NOT_CONFIGURED" | "UNKNOWN";
export type ValidationGateName = "type-check" | "lint" | "build" | "test";

export interface ValidationCheck {
  name: ValidationGateName;
  status: ValidationStatus;
  exitCode?: number;
}

export interface ValidationResult {
  status: "PASS" | "FAIL" | "UNKNOWN";
  checks: ValidationCheck[];
}

export interface BuilderCredentials {
  githubToken?: string;
  anthropicApiKey?: string;
  openaiApiKey?: string;
}

export interface BuilderRequest {
  taskId: string;
  repoUrl: string;
  prompt: string;
  branchName?: string;
  selectedAgent: BuilderAgentType;
  selectedModel?: string;
  installDependencies?: boolean;
  timeoutMs: number;
  gitAuthorName?: string;
  gitAuthorEmail?: string;
  credentials?: BuilderCredentials;
}

export interface BuilderEvent {
  stage:
    | "workspace"
    | "repo"
    | "dependencies"
    | "agent"
    | "validation"
    | "git"
    | "cleanup";
  status: "started" | "completed" | "failed" | "skipped";
  detail?: string;
  data?: Record<string, unknown>;
}

export type BuilderEventSink = (event: BuilderEvent) => void | Promise<void>;

export interface BuilderAgentRunInput {
  workspace: WorkspaceHandle;
  projectDir: string;
  prompt: string;
  selectedAgent: BuilderAgentType;
  selectedModel?: string;
  credentials?: BuilderCredentials;
  emit?: BuilderEventSink;
}

export interface BuilderAgentResult {
  success: boolean;
  cliName: BuilderAgentType;
  changesDetected: boolean;
  output?: string;
  error?: string;
}

export interface NativeBuilderResult {
  status: "completed" | "failed";
  taskId: string;
  workspaceId?: string;
  workspaceProvider: string;
  repoUrl: string;
  branchName?: string;
  selectedAgent: BuilderAgentType;
  selectedModel?: string;
  validation?: ValidationResult;
  changed: boolean;
  pushed: boolean;
  agent?: BuilderAgentResult;
  error?: string;
}

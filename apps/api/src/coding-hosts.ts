// Public coding-host status. This process has no Cursor, Claude Code, or ChatGPT
// agent session. Key presence stays on the session-gated secrets inventory.
export type CodingHostId = "cursor" | "claude_code" | "chatgpt";
export type CodingHostState = "NOT_CONNECTED";

export interface CodingHost {
  id: CodingHostId;
  label: string;
  state: CodingHostState;
  detail: string;
}

const HOSTS: Array<{ id: CodingHostId; label: string }> = [
  { id: "cursor", label: "Cursor" },
  { id: "claude_code", label: "Claude Code" },
  { id: "chatgpt", label: "ChatGPT" },
];

export function codingHosts(): CodingHost[] {
  return HOSTS.map((host) => ({
    id: host.id,
    label: host.label,
    state: "NOT_CONNECTED",
    detail: "Brak sesji agenta w tym procesie.",
  }));
}

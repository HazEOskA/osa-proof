// Coding hosts sit under the chat. A present key is not an agent session.
export type CodingHostId = "cursor" | "claude_code" | "chatgpt";
export type CodingHostState = "NOT_CONNECTED" | "KEY_PRESENT";

export interface CodingHost {
  id: CodingHostId;
  label: string;
  state: CodingHostState;
  detail: string;
}

const HOSTS: Array<{ id: CodingHostId; label: string; env: string }> = [
  { id: "cursor", label: "Cursor", env: "CURSOR_API_KEY" },
  { id: "claude_code", label: "Claude Code", env: "ANTHROPIC_API_KEY" },
  { id: "chatgpt", label: "ChatGPT", env: "OPENAI_API_KEY" },
];

export function codingHosts(env: Record<string, string | undefined>): CodingHost[] {
  return HOSTS.map((host) => {
    const present = Boolean(env[host.env]?.trim());
    return {
      id: host.id,
      label: host.label,
      state: present ? "KEY_PRESENT" : "NOT_CONNECTED",
      detail: present
        ? "Klucz jest w środowisku procesu. Nie ma sesji agenta ani połączenia z czatem."
        : "Brak klucza i brak sesji agenta w tym procesie.",
    };
  });
}

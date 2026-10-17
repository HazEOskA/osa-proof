import { useEffect, useState } from "react";
import { requestJson } from "../data/data";

interface GithubSession { enabled: boolean; signed_in: boolean; display_name?: string }
export function useGithubSession() {
  const [status, setStatus] = useState<GithubSession | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let active = true;
    void requestJson<GithubSession>("/auth/github/status").then(value => { if (active) setStatus(value); })
      .catch(() => { if (active) setError("Nie udało się sprawdzić logowania GitHub."); });
    return () => { active = false; };
  }, []);
  return { status, error };
}

export default function GithubLogin({ auth }: { auth: ReturnType<typeof useGithubSession> }) {
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const loginResult = new URLSearchParams(window.location.search).get("github_login");
  async function logout() {
    setBusy(true); setError("");
    try {
      await requestJson("/session/logout", { method: "POST", body: "{}" });
      try { localStorage.removeItem("osa.native-chat.v1"); localStorage.removeItem("osa.native-chat.active.v1"); } catch { /* optional local cache */ }
      window.location.assign("/");
    } catch { setError("Nie udało się wylogować. Spróbuj ponownie."); setBusy(false); }
  }
  return <div className="flex flex-wrap items-center gap-2 text-xs">
    {auth.status?.signed_in ? <><span>GitHub: {auth.status.display_name}</span><button type="button" className="underline" disabled={busy} onClick={() => void logout()}>Wyloguj</button></> :
      auth.status?.enabled ? <a className="underline" href="/api/auth/github/login">Zaloguj przez GitHub</a> :
      <span className="text-dim">{auth.error || (auth.status ? "Logowanie GitHub nie jest skonfigurowane." : "Sprawdzanie logowania…")}</span>}
    {(error || loginResult) && <span role="alert" className="text-warn">{error || (loginResult === "access_denied" ? "To konto GitHub nie ma dostępu do projektu." : "Logowanie GitHub nie powiodło się. Spróbuj ponownie.")}</span>}
  </div>;
}

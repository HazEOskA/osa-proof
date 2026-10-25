import { useEffect, useState } from "react";

type AuthStatus = {
  configured: boolean;
  authenticated: boolean;
  identity: null | { display_name?: string; provider: string };
};
const STATUS = "/api/auth/github/status";

export default function AccountControl() {
  const [status, setStatus] = useState<AuthStatus | null>(null);
  const [error, setError] = useState("");
  const [dialog, setDialog] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    fetch(STATUS, { signal: controller.signal, credentials: "same-origin", cache: "no-store" })
      .then(async response => {
        if (!response.ok) throw new Error("AUTH_STATUS_UNAVAILABLE");
        return response.json() as Promise<AuthStatus>;
      })
      .then(value => setStatus(value))
      .catch(() => { if (!controller.signal.aborted) setError("Nie udało się sprawdzić sesji."); });
    return () => controller.abort();
  }, []);
  const signIn = () => {
    if (!status?.configured) { setDialog(true); return; }
    const returnTo = location.pathname + location.search;
    location.assign("/api/auth/github/start?return_to=" + encodeURIComponent(returnTo));
  };
  const signOut = async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/github/logout", {
        method: "POST", credentials: "same-origin",
        headers: { "content-type": "application/json" },
      });
      if (!response.ok) throw new Error("Wylogowanie nie powiodło się.");
      setStatus(previous => previous ? { ...previous, authenticated:false, identity:null } : previous);
      location.reload();
    } catch (e) { setError(e instanceof Error ? e.message : "Błąd wylogowania."); }
    finally { setBusy(false); }
  };
  return (
    <div className="relative z-30 flex shrink-0 items-center">
      {status?.authenticated ? (
        <div className="flex items-center gap-2">
          <span className="mono hidden max-w-[120px] truncate text-[10px] text-cyan sm:block" title="Zalogowano przez GitHub">
            {status.identity?.display_name ?? "Operator"}
          </span>
          <button type="button" disabled={busy} onClick={signOut}
            className="focus-ring tap rounded-md border border-line2 bg-panel px-3 text-xs font-semibold text-fg hover:bg-raise disabled:opacity-50">
            Wyloguj
          </button>
        </div>
      ) : (
        <button type="button" onClick={signIn} aria-haspopup="dialog"
          className="focus-ring tap rounded-md border border-brand bg-brand px-3 text-xs font-bold text-white hover:brightness-110">
          Zaloguj
        </button>
      )}
      {error && <span role="status" title={error} className="ml-1 text-xs text-warn">!</span>}
      {dialog && (
        <div className="fixed inset-0 z-[200] grid place-items-center bg-black/75 p-4" role="dialog"
          aria-modal="true" aria-label="Logowanie operatora">
          <div className="glass w-full max-w-[440px] rounded-xl bg-ink p-5 shadow-xl">
            <div className="flex items-start justify-between gap-3">
              <h2 className="font-display text-base text-hero">Logowanie OSA</h2>
              <button type="button" onClick={() => setDialog(false)}
                className="focus-ring tap rounded px-3 text-lg" aria-label="Zamknij">×</button>
            </div>
            <p className="mt-3 text-sm leading-6 text-fg">
              GitHub OAuth nie jest skonfigurowany dla tego Preview. Nie uruchamiamy pozornego logowania ani konta lokal-dev.
            </p>
            <p className="mt-3 text-xs leading-5 text-dim">
              Administrator musi ustawić po stronie Vercel dane GitHub OAuth, sekret sesji i listę dozwolonych kont.
              Osobna ochrona Vercel Authentication może zablokować wejście przed tym ekranem.
            </p>
            <button type="button" onClick={() => setDialog(false)}
              className="focus-ring tap mt-4 w-full rounded-md border border-line2 px-4 text-sm">Zamknij</button>
          </div>
        </div>
      )}
    </div>
  );
}

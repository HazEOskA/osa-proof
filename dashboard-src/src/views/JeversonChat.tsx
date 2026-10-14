import { useState } from "react";

// Hosts the EXISTING private Jeverson application. No copied private source,
// duplicate chat runtime, credential passing, or invented proof receipts.
function approvedUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

const jeversonUrl = approvedUrl(import.meta.env.VITE_OSA_JEVERSON_URL as string | undefined);

export default function JeversonChat() {
  const [iframeError, setIframeError] = useState(false);
  return (
    <div className="flex h-full min-h-[540px] flex-col bg-void">
      <div className="flex flex-wrap items-center gap-3 border-b border-line bg-ink px-4 py-3">
        <div className="flex-1">
          <h2 className="text-[15px] font-semibold">Jeverson · istniejący Chat / Agent World</h2>
          <p className="mt-1 text-[11px] text-dim">Osadzona istniejąca aplikacja. Bez kopiowania prywatnego UI i bez drugiego runtime’u.</p>
        </div>
        {jeversonUrl && <a href={jeversonUrl} target="_blank" rel="noopener noreferrer"
          className="focus-ring rounded border border-line px-3 py-2 text-[12px] text-fg">Otwórz Jeverson ↗</a>}
      </div>
      {!jeversonUrl ? (
        <div className="grid flex-1 place-items-center p-6">
          <div className="max-w-xl space-y-3 rounded-lg border border-line bg-panel p-6">
            <div className="label">JEVERSON · DISCONNECTED</div>
            <p className="text-[14px]">Brak zatwierdzonego adresu istniejącej aplikacji Jeverson.</p>
            <p className="mono text-[12px] text-dim">Ustaw VITE_OSA_JEVERSON_URL jako HTTPS origin przy budowaniu dashboardu. Nie zastępuj Jeversona atrapą czatu.</p>
          </div>
        </div>
      ) : (
        <>
          {iframeError && <p className="px-4 py-2 text-[12px] text-dim">Jeżeli osadzenie jest blokowane przez CSP lub X-Frame-Options, otwórz Jeverson w osobnej karcie.</p>}
          <iframe title="Jeverson Chat" src={jeversonUrl} className="min-h-0 w-full flex-1 border-0"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
            referrerPolicy="no-referrer" onError={() => setIframeError(true)} />
        </>
      )}
      <div className="mono border-t border-line bg-ink px-4 py-2 text-[10px] text-dim">
        UI EMBED ONLY · Jeverson receipts ≠ OSA Proof receipts · E2E verification pending
      </div>
    </div>
  );
}

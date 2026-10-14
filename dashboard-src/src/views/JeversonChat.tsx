import { useState } from "react";

// Reuse the existing Jeverson application. Do not copy its runtime or forward secrets.
function approvedUrl(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) return null;
    return url.origin;
  } catch { return null; }
}

const jeversonUrl = approvedUrl(import.meta.env.VITE_OSA_JEVERSON_URL as string | undefined);
const themePreviewUrl = approvedUrl(import.meta.env.VITE_OSA_JEVERSON_THEME_PREVIEW_URL as string | undefined);

export default function JeversonChat() {
  const [iframeError, setIframeError] = useState(false);
  return (
    <section aria-label="Jeverson Chat" className="flex h-full min-h-0 min-w-0 flex-col overflow-hidden bg-void">
      {/* One compact, non-wrapping bar. On a 320px phone the title never competes
          with a full sentence or a pair of desktop-sized buttons. */}
      <header data-testid="jeverson-toolbar"
        className="flex min-h-[56px] shrink-0 items-center justify-between gap-2 border-b border-line bg-ink px-3 py-2 sm:min-h-[68px] sm:px-5">
        <div className="min-w-0 flex-1">
          <h2 className="truncate text-[13px] font-semibold tracking-[.06em] text-fg sm:text-[15px]">
            <span className="sm:hidden">JEV / CHAT</span>
            <span className="hidden sm:inline">Jeverson Chat</span>
          </h2>
          <p className="mt-0.5 truncate text-[10px] tracking-wide text-dim sm:text-[11px]">
            OSA AGENT WORLD <span aria-hidden="true">·</span> LIVE UI
          </p>
        </div>
        <nav aria-label="Jeverson links" className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          {themePreviewUrl && <a href={themePreviewUrl} target="_blank" rel="noopener noreferrer"
            title="Otwórz osobno chronione preview motywu Vercel Black"
            className="focus-ring inline-flex h-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-line2 bg-panel px-2.5 text-[11px] text-fg hover:bg-raise sm:h-10 sm:px-3 sm:text-[12px]">
            <span className="sm:hidden">Motyw ↗</span><span className="hidden sm:inline">Vercel Black ↗</span>
          </a>}
          {jeversonUrl && <a href={jeversonUrl} target="_blank" rel="noopener noreferrer"
            aria-label="Otwórz Jeverson w pełnym ekranie" title="Otwórz Jeverson w nowej karcie"
            className="focus-ring inline-flex h-9 min-w-9 shrink-0 items-center justify-center whitespace-nowrap rounded-md border border-line px-2.5 text-[12px] text-fg hover:bg-raise sm:h-10 sm:px-3">
            <span className="sm:hidden">↗</span><span className="hidden sm:inline">Pełny ekran ↗</span>
          </a>}
        </nav>
      </header>
      {!jeversonUrl ? (
        <div className="grid min-h-0 flex-1 place-items-center p-4">
          <div className="max-w-xl space-y-2 rounded-lg border border-line bg-panel p-5">
            <div className="label">JEVERSON · DISCONNECTED</div>
            <p className="text-[13px]">Nie ustawiono adresu istniejącej aplikacji Jeverson.</p>
            <p className="mono text-[11px] text-dim">Brak VITE_OSA_JEVERSON_URL (HTTPS).</p>
          </div>
        </div>
      ) : (
        <>
          {iframeError && <p role="status" className="shrink-0 border-b border-line px-3 py-2 text-[11px] text-dim">
            Nie można załadować osadzonego Jeversona. Otwórz go przyciskiem ↗ w nowej karcie.
          </p>}
          <iframe title="Jeverson Chat" src={jeversonUrl}
            className="block min-h-0 min-w-0 w-full flex-1 border-0 bg-void"
            sandbox="allow-scripts allow-same-origin allow-forms allow-downloads"
            referrerPolicy="no-referrer" onError={() => setIframeError(true)} />
        </>
      )}
      <footer className="mono flex h-7 shrink-0 items-center border-t border-line bg-ink px-3 text-[9px] text-dim sm:h-8 sm:px-5 sm:text-[10px]">
        <span className="truncate sm:hidden">UI EMBED · E2E PROOF PENDING</span>
        <span className="hidden truncate sm:inline">
          UI EMBED ONLY · Jeverson receipts ≠ OSA Proof receipts · E2E verification pending
        </span>
      </footer>
    </section>
  );
}

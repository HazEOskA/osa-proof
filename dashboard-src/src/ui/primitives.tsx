import type { ReactNode } from "react";
import type { Verdict } from "../data/types";
import { useOsa } from "../ctx";
import { vercelIcon } from "../brand/vercelIcons";
import { LOGO } from "../brand/icons";

export const Mono = ({ children, className = "" }: { children: ReactNode; className?: string }) => <span className={`mono ${className}`}>{children}</span>;
export const short = (s: string, n = 12) => (s.length > n * 2 + 1 ? `${s.slice(0, n)}…${s.slice(-6)}` : s);

const V: Record<string, { c: string; t: string }> = {
  VERIFIED: { c: "var(--ok)", t: "VERIFIED" }, PASS: { c: "var(--ok)", t: "PASS" },
  FAILED: { c: "var(--bad)", t: "FAILED" }, MISMATCH: { c: "var(--bad)", t: "MISMATCH" },
  INCOMPLETE: { c: "var(--warn)", t: "INCOMPLETE" }, MATCH: { c: "var(--ok)", t: "MATCH" },
  UNKNOWN: { c: "var(--faint)", t: "UNKNOWN" }, SNAPSHOT: { c: "var(--warn)", t: "SNAPSHOT" }, LIVE: { c: "var(--ok)", t: "LIVE" },
  PREVIEW: { c: "var(--warn)", t: "PREVIEW" }, SOON: { c: "var(--faint)", t: "SOON" },
};
// Design system StatusBadge: dot plus a word, tracked uppercase, never colour alone.
export function Status({ v, label, framed = false }: { v: Verdict | string; label?: string; framed?: boolean }) {
  const s = V[v] ?? { c: "var(--cyan)", t: v };
  return (
    <span className={`inline-flex items-center gap-2 whitespace-nowrap text-[11px] font-medium uppercase tracking-[.16em] text-fg ${framed ? "rounded-sm border border-line2 bg-panel px-2 py-1" : ""}`}>
      <span className="inline-block h-2 w-2 shrink-0 rounded-full" style={{ background: s.c, boxShadow: `0 0 8px ${s.c}` }} />{label ?? s.t}
    </span>
  );
}
export const Unknown = ({ why = "not reported by osa-proof" }: { why?: string }) => <span className="mono text-[11px] text-dim" title={why}>unknown</span>;

export function Section({ title, children, right }: { title: string; children: ReactNode; right?: ReactNode }) {
  return (
    <section className="border-b border-line py-3 last:border-0">
      <div className="mb-2 flex items-center justify-between"><span className="label">{title}</span>{right}</div>
      {children}
    </section>
  );
}
export function Kv({ k, children }: { k: string; children: ReactNode }) {
  return <div className="flex items-baseline justify-between gap-4 py-1 text-[13px]"><span className="text-dim">{k}</span><span className="mono min-w-0 break-all text-right text-[12px] text-fg">{children}</span></div>;
}
export function Empty({ title, body, steps, action, onAction }: { title: string; body: string; steps?: string[]; action?: string; onAction?: () => void }) {
  return (
    <div className="grid h-full place-items-center p-8">
      <div className="max-w-md">
        <div className="label mb-3">{title}</div>
        <p className="mb-4 text-[15px] leading-relaxed text-fg">{body}</p>
        {steps && <ul className="mono mb-5 space-y-1 text-[12px] text-dim">{steps.map((s) => <li key={s}>→ {s}</li>)}</ul>}
        {action && <button onClick={onAction} className="focus-ring tap rounded-md border border-cyan/40 bg-cyan/10 px-4 text-[13px] text-cyan hover:bg-cyan/15">{action}</button>}
      </div>
    </div>
  );
}
export const Icon = ({ d, className = "h-4 w-4" }: { d: string; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden><path d={d} /></svg>
);
export function Logo({ size = 28 }: { size?: number }) {
  // OSA bee mark (brand lock, src/brand/icons.ts). size = height in px.
  return <img className="osa-logo" src={LOGO.wings} alt="OSA" height={size} style={{ height: size, width: "auto", filter: "drop-shadow(0 0 6px rgb(var(--brand-rgb) / .35))" }} draggable={false} />;
}
export function OsaIcon({ src, size = 22, className = "" }: { src: string; size?: number; className?: string }) {
  const { theme } = useOsa();
  return <img src={theme === "vercel" ? vercelIcon(src) : src} alt="" aria-hidden width={size} height={size} draggable={false} className={`shrink-0 object-contain ${className}`} style={{ width: size, height: size }} />;
}

export { ThemeSwitch } from "./Themes";

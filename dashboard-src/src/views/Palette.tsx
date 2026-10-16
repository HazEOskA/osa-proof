import { useEffect, useMemo, useRef, useState } from "react";
import { useOsa, type ViewId } from "../ctx";
import { BUILD_LABELS, type BuildPage } from "../build";
import { Status } from "../ui/primitives";

interface Cmd { id: string; label: string; hint: string; group: string; run?: () => void; disabled?: string }

export default function Palette({ onClose }: { onClose: () => void }) {
  const { go, data, graph, runId, runMission, setRunId } = useOsa();
  const [q, setQ] = useState(""); const [sel, setSel] = useState(0);
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => { ref.current?.focus(); }, []);
  const to = (v: ViewId, o?: { runId?: string; focus?: string }) => () => { go(v, o); onClose(); };
  const cmds: Cmd[] = useMemo(() => {
    const base: Cmd[] = [
      { id: "home", label: "Otwórz stronę główną", hint: "Przegląd systemu", group: "Nawigacja", run: to("home") },
      { id: "world", label: "Otwórz świat wiedzy", hint: "graph", group: "Nawigacja", run: to("world") },
      { id: "missions", label: "Otwórz misje", hint: "Graf wykonywania", group: "Nawigacja", run: to("missions") },
      { id: "trace", label: "Otwórz śledzenie", hint: "Drzewo śladów / oś czasu", group: "Nawigacja", run: to("trace") },
      { id: "proofs", label: "Sprawdź dowody", hint: "Oblicz ponownie skróty w przeglądarce", group: "Polecenie", run: to("proofs") },
      { id: "replay", label: "Odtwórz wykonanie", hint: "Przeglądaj kolejne zdarzenia", group: "Polecenie", run: to("replay") },
      { id: "repo", label: "Otwórz repozytorium", hint: data.source.repo, group: "Polecenie", run: () => { window.open(`https://github.com/${data.source.repo}`, "_blank", "noopener"); onClose(); } },
      { id: "health", label: "Sprawdź stan systemu", hint: "Dostępność API", group: "Polecenie", run: to("home") },
      { id: "create-agent", label: "Utwórz agenta", hint: "TeamGraph", group: "Budowanie", run: to("build:agents") },
      {
        id: "run-mission",
        label: "Uruchom bieżącą misję",
        hint: data.runs.find((r) => r.run_id === runId)?.proof.mission_id ?? data.missions[0]?.mission_id ?? "brak misji",
        group: "Polecenie",
        run: () => {
          const missionId = data.runs.find((r) => r.run_id === runId)?.proof.mission_id ?? data.missions[0]?.mission_id;
          if (!missionId) return;
          void runMission(missionId).then((fresh) => { setRunId(fresh.run_id); go("trace", { runId: fresh.run_id }); onClose(); });
        },
      },
      { id: "deploy", label: "Wdróż silnik wykonawczy", hint: "", group: "Niedostępne", disabled: "OSA Proof nie ma podłączonego modułu wdrożeń" },
      { id: "inspect-model", label: "Sprawdź model", hint: "", group: "Niedostępne", disabled: "Nie przypisano modelu do grafu zespołu (model_ref)" },
    ];
    for (const [page, label] of Object.entries(BUILD_LABELS)) base.push({ id: `build:${page}`, label: `Otwórz ${label}`, hint: "Budowanie", group: "Budowanie", run: to(`build:${page as BuildPage}`) });
    for (const r of data.runs) base.push({ id: `run:${r.run_id}`, label: `Sprawdź ${r.proof.mission_id} · ${r.verdict}`, hint: r.run_id, group: "Wykonania", run: to("trace", { runId: r.run_id }) });
    return base;
  }, [data, runId]); // eslint-disable-line
  const qq = q.trim().toLowerCase();
  const nodeHits = useMemo(() => (qq.length < 2 ? [] : graph.nodes.filter((n) => `${n.label} ${n.sub ?? ""} ${n.type}`.toLowerCase().includes(qq)).slice(0, 8)), [qq, graph]);
  const list: Cmd[] = [
    ...cmds.filter((c) => !qq || `${c.label} ${c.hint} ${c.group}`.toLowerCase().includes(qq)),
    ...nodeHits.map((n) => ({ id: `n:${n.id}`, label: n.label, hint: `${n.type} · ${n.sub ?? ""}`, group: "Szukaj wiedzy", run: to("world", { focus: n.id }) })),
  ];
  useEffect(() => setSel(0), [q]);
  const key = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") { e.preventDefault(); setSel((s) => Math.min(list.length - 1, s + 1)); }
    else if (e.key === "ArrowUp") { e.preventDefault(); setSel((s) => Math.max(0, s - 1)); }
    else if (e.key === "Enter") { const c = list[sel]; if (c && !c.disabled) c.run?.(); }
  };
  let last = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 p-3 pt-[10dvh] backdrop-blur-sm" onMouseDown={onClose} role="dialog" aria-modal="true" aria-label="Paleta poleceń">
      <div className="glass slide-in w-full max-w-[620px] overflow-hidden rounded-lg shadow-[0_24px_64px_rgba(0,0,0,.55)]" onMouseDown={(e) => e.stopPropagation()}>
        <input ref={ref} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={key} placeholder="Szukaj agentów, misji, dowodów, śladów, repozytoriów lub poleceń…" className="tap w-full border-b border-line bg-transparent px-4 text-[15px] outline-none placeholder:text-dim" />
        <div className="max-h-[52dvh] overflow-y-auto py-1">
          {list.length === 0 && <div className="mono px-4 py-6 text-[12px] text-dim">Brak wyników</div>}
          {list.map((c, i) => {
            const head = c.group !== last; last = c.group;
            return (
              <div key={c.id}>
                {head && <div className="label px-4 pb-1 pt-3">{c.group}</div>}
                <button disabled={!!c.disabled} onMouseEnter={() => setSel(i)} onClick={() => c.run?.()} title={c.disabled}
                  className={`tap flex w-full items-center justify-between gap-3 px-4 text-left text-[14px] ${i === sel ? "bg-raise sel-mark" : ""} ${c.disabled ? "cursor-not-allowed text-dim" : ""}`}>
                  <span className="truncate">{c.label}</span>
                  <span className="mono truncate text-[11px] text-dim">{c.disabled ? "niedostępne" : c.hint}</span>
                </button>
              </div>
            );
          })}
        </div>
        <div className="mono flex justify-between border-t border-line px-4 py-2 text-[10px] text-dim"><span>↑↓ wybierz · ↵ uruchom · Esc zamknij</span><Status v="UNKNOWN" label="Polecenia @ nie są jeszcze podłączone" /></div>
      </div>
    </div>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";
import type { Graph, GNode } from "../lib/graph";
import { typeColor } from "../lib/graph";
import { tok } from "../lib/tok";

interface Props {
  graph: Graph; selectedId?: string | null; onSelect?: (id: string | null) => void;
  highlight?: { nodes: Set<string>; edges: Set<string> } | null; hiddenTypes?: Set<string>;
  query?: string; interactive?: boolean; ambient?: boolean; labels?: "auto" | "all" | "none"; fitPad?: number; className?: string;
  focusId?: string | null;
}
interface View { x: number; y: number; k: number }

function shapePath(n: GNode): string {
  const r = n.r;
  switch (n.type) {
    case "PROOF": case "EVIDENCE": return `M0 ${-r * 1.25}L${r * 1.25} 0L0 ${r * 1.25}L${-r * 1.25} 0Z`;
    case "AGENT": { const p: string[] = []; for (let i = 0; i < 6; i++) { const a = (Math.PI / 3) * i - Math.PI / 6; p.push(`${(Math.cos(a) * r * 1.2).toFixed(2)} ${(Math.sin(a) * r * 1.2).toFixed(2)}`); } return `M${p.join("L")}Z`; }
    case "REPOSITORY": case "SERVICE": case "CODE": case "POLICY": return `M${-r} ${-r}H${r}V${r}H${-r}Z`;
    default: return "";
  }
}

export default function GraphCanvas({ graph, selectedId, onSelect, highlight, hiddenTypes, query, interactive = true, ambient = false, labels = "auto", fitPad = 40, className, focusId }: Props) {
  const wrap = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 800, h: 600 });
  const [view, setView] = useState<View>({ x: 0, y: 0, k: 1 });
  const [hover, setHover] = useState<string | null>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const drag = useRef<{ x: number; y: number; vx: number; vy: number; moved: boolean } | null>(null);
  const pinch = useRef<{ d: number; k: number } | null>(null);

  const visible = useMemo(() => graph.nodes.filter((n) => !hiddenTypes?.has(n.type)), [graph, hiddenTypes]);
  const visIds = useMemo(() => new Set(visible.map((n) => n.id)), [visible]);
  const bounds = useMemo(() => {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const n of visible) { x0 = Math.min(x0, n.x - n.r); y0 = Math.min(y0, n.y - n.r); x1 = Math.max(x1, n.x + n.r); y1 = Math.max(y1, n.y + n.r); }
    return { x0, y0, x1, y1 };
  }, [visible]);

  const fit = (w = size.w, h = size.h) => {
    const bw = bounds.x1 - bounds.x0 || 1, bh = bounds.y1 - bounds.y0 || 1;
    const k = Math.min((w - fitPad * 2) / bw, (h - fitPad * 2) / bh, 3);
    setView({ k, x: w / 2 - ((bounds.x0 + bounds.x1) / 2) * k, y: h / 2 - ((bounds.y0 + bounds.y1) / 2) * k });
  };

  useEffect(() => {
    const el = wrap.current; if (!el) return;
    const ro = new ResizeObserver(() => { const r = el.getBoundingClientRect(); setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) }); });
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { fit(); /* eslint-disable-next-line */ }, [size.w, size.h, bounds.x0, bounds.x1, bounds.y0, bounds.y1]);
  useEffect(() => {
    if (!focusId) return; const n = graph.byId.get(focusId); if (!n) return;
    const k = Math.max(view.k, 1.6);
    setView({ k, x: size.w / 2 - n.x * k, y: size.h / 2 - n.y * k });
    // eslint-disable-next-line
  }, [focusId]);

  const zoomAt = (cx: number, cy: number, f: number) => setView((v) => {
    const k = Math.max(0.2, Math.min(6, v.k * f)); const r = k / v.k;
    return { k, x: cx - (cx - v.x) * r, y: cy - (cy - v.y) * r };
  });
  const rel = (e: { clientX: number; clientY: number }) => { const r = wrap.current!.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!interactive) return;
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    pointers.current.set(e.pointerId, rel(e));
    if (pointers.current.size === 2) { const [a, b] = [...pointers.current.values()]; pinch.current = { d: Math.hypot(a.x - b.x, a.y - b.y), k: view.k }; drag.current = null; }
    else drag.current = { ...rel(e), vx: view.x, vy: view.y, moved: false };
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!interactive || !pointers.current.has(e.pointerId)) return;
    pointers.current.set(e.pointerId, rel(e));
    if (pointers.current.size === 2 && pinch.current) {
      const [a, b] = [...pointers.current.values()]; const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      zoomAt(cx, cy, (pinch.current.k * (d / pinch.current.d)) / view.k);
    } else if (drag.current) {
      const p = rel(e); const dx = p.x - drag.current.x, dy = p.y - drag.current.y;
      if (Math.abs(dx) + Math.abs(dy) > 4) drag.current.moved = true;
      setView((v) => ({ ...v, x: drag.current!.vx + dx, y: drag.current!.vy + dy }));
    }
  };
  const onPointerUp = (e: React.PointerEvent) => {
    pointers.current.delete(e.pointerId); if (pointers.current.size < 2) pinch.current = null;
    if (pointers.current.size === 0 && drag.current && !drag.current.moved && onSelect && (e.target as Element).closest("[data-node]") === null) onSelect(null);
    if (pointers.current.size === 0) drag.current = null;
  };
  const onWheel = (e: React.WheelEvent) => { if (!interactive) return; const p = rel(e); zoomAt(p.x, p.y, Math.exp(-e.deltaY * 0.0015)); };

  const q = query?.trim().toLowerCase();
  const matches = (n: GNode) => !q || `${n.label} ${n.sub ?? ""} ${n.type} ${n.id}`.toLowerCase().includes(q);
  const hl = highlight && highlight.nodes.size ? highlight : null;
  const neigh = useMemo(() => {
    const focus = hover ?? selectedId; const s = new Set<string>();
    if (focus) { s.add(focus); for (const e of graph.edges) { if (e.from === focus) s.add(e.to); if (e.to === focus) s.add(e.from); } }
    return s;
  }, [hover, selectedId, graph]);

  return (
    <div ref={wrap} className={`overflow-hidden ${className ?? "relative"}`} style={{ touchAction: interactive ? "none" : "auto" }}
      onPointerDown={onPointerDown} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerCancel={onPointerUp} onWheel={onWheel}>
      <svg width={size.w} height={size.h} className="block select-none" role="img" aria-label="OSA knowledge graph">
        <g transform={`translate(${view.x} ${view.y}) scale(${view.k})`}>
          {graph.edges.map((e) => {
            if (!visIds.has(e.from) || !visIds.has(e.to)) return null;
            const a = graph.byId.get(e.from)!, b = graph.byId.get(e.to)!;
            const on = hl?.edges.has(e.id); const dim = (hl && !on) || (q && !(matches(a) || matches(b))) || (!hl && neigh.size > 0 && !(neigh.has(e.from) && neigh.has(e.to)));
            const stroke = on ? tok("cyan") : tok("line2");
            return <line key={e.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={stroke} strokeWidth={(on ? 1.8 : 0.8) / Math.sqrt(view.k)} opacity={dim ? 0.08 : on ? 0.95 : e.flow ? 0.55 : 0.32} className={(on || (ambient && e.flow)) && !dim ? "flow-edge" : undefined} />;
          })}
          {visible.map((n) => {
            const col = typeColor(n); const sel = selectedId === n.id; const on = hl?.nodes.has(n.id);
            const dim = (hl && !on) || (q && !matches(n)) || (!hl && neigh.size > 0 && !neigh.has(n.id));
            const sp = shapePath(n); const showLabel = labels === "all" || (labels === "auto" && (sel || hover === n.id || on || (view.k > 1.1 && n.r >= 8) || view.k > 2.2 || (!!q && matches(n))));
            return (
              <g key={n.id} data-node transform={`translate(${n.x} ${n.y})`} opacity={dim ? 0.14 : 1} style={{ cursor: onSelect ? "pointer" : "default" }}
                onPointerEnter={() => interactive && setHover(n.id)} onPointerLeave={() => setHover(null)}
                onClick={(ev) => { ev.stopPropagation(); onSelect?.(n.id); }}>
                {(ambient || n.type === "PROOF" || n.type === "AGENT") && <circle r={n.r * 1.9} fill={col} className={ambient ? "pulse-halo" : undefined} opacity={0.14} style={{ animationDelay: `${(n.x * 7 + n.y * 3) % 3}s` }} />}
                {sel && <circle r={n.r * 2.3} fill="none" stroke={tok("cyan")} strokeWidth={1.2 / Math.sqrt(view.k)} />}
                {sp ? <path d={sp} fill={tok("panel")} stroke={col} strokeWidth={1.6 / Math.sqrt(view.k)} /> : <circle r={n.r} fill={tok("panel")} stroke={col} strokeWidth={1.6 / Math.sqrt(view.k)} />}
                <circle r={Math.max(1.6, n.r * 0.32)} fill={col} />
                <circle r={Math.max(14, n.r * 2.2)} fill="transparent" />
                {showLabel && <text y={n.r + 13 / Math.sqrt(Math.max(view.k, 0.8))} textAnchor="middle" fontSize={11 / Math.sqrt(Math.max(view.k, 0.8))} fill={tok("fg")} style={{ fontFamily: "JetBrains Mono, monospace", paintOrder: "stroke", stroke: tok("void"), strokeWidth: 3 }}>{n.label}</text>}
              </g>
            );
          })}
        </g>
      </svg>
      {interactive && (
        <div className="absolute bottom-3 right-3 flex flex-col gap-1.5">
          {[["+", () => zoomAt(size.w / 2, size.h / 2, 1.3), "Zoom in"], ["−", () => zoomAt(size.w / 2, size.h / 2, 1 / 1.3), "Zoom out"], ["⤢", () => fit(), "Fit to view"]].map(([t, fn, label]) => (
            <button key={label as string} aria-label={label as string} onPointerDown={(e) => e.stopPropagation()} onClick={fn as () => void} className="focus-ring glass grid h-9 w-9 place-items-center rounded-md text-dim hover:text-fg">{t as string}</button>
          ))}
        </div>
      )}
    </div>
  );
}

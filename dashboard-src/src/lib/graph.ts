import type { Snapshot } from "../data/types";
import { tok } from "./tok";

export type NodeType = "AGENT" | "MODEL" | "MISSION" | "TOOL" | "MEMORY" | "KNOWLEDGE" | "CODE" | "REPOSITORY" | "SERVICE" | "CLOUD" | "PROOF" | "EVIDENCE" | "POLICY" | "USER" | "WORKSPACE";
export const NODE_TYPES: NodeType[] = ["AGENT", "MODEL", "MISSION", "TOOL", "MEMORY", "KNOWLEDGE", "CODE", "REPOSITORY", "SERVICE", "CLOUD", "PROOF", "EVIDENCE", "POLICY", "USER", "WORKSPACE"];

export interface GNode {
  id: string; type: NodeType; label: string; sub?: string;
  state?: "VERIFIED" | "FAILED"; detail: Record<string, string | undefined>;
  runId?: string; x: number; y: number; r: number;
}
export interface GEdge { id: string; from: string; to: string; kind: string; flow?: boolean }
export interface Graph { nodes: GNode[]; edges: GEdge[]; byId: Map<string, GNode> }

export const typeColor = (n: { type: NodeType; state?: string }): string => {
  if (n.type === "PROOF") return n.state === "VERIFIED" ? tok("ok") : n.state === "FAILED" ? tok("bad") : tok("dim");
  switch (n.type) {
    case "AGENT": case "MODEL": return tok("violet");
    case "EVIDENCE": return tok("info");
    case "MISSION": return tok("brand");
    case "WORKSPACE": return tok("cyan");
    case "KNOWLEDGE": return tok("hero");
    case "POLICY": return tok("dim");
    default: return tok("line2");
  }
};

const short = (s: string, n = 10) => (s.length > n ? `${s.slice(0, n)}…` : s);

export function buildGraph(d: Snapshot): Graph {
  const nodes: GNode[] = [];
  const edges: GEdge[] = [];
  const add = (n: Omit<GNode, "x" | "y" | "r"> & { r?: number }) => nodes.push({ x: 0, y: 0, r: 7, ...n });
  const link = (from: string, to: string, kind: string, flow = false) => edges.push({ id: `${from}>${to}:${kind}`, from, to, kind, flow });
  const t = d.team;

  add({ id: "org", type: "WORKSPACE", label: t.organization_id, sub: "organization", r: 10, detail: { identity: t.organization_id, kind: "organization" } });
  add({ id: "prj", type: "WORKSPACE", label: t.project_id, sub: "project", r: 9, detail: { identity: t.project_id, kind: "project", owner: t.organization_id } });
  link("org", "prj", "contains");
  add({ id: "team", type: "WORKSPACE", label: t.team_id, sub: `Team Graph v${t.version}`, r: 10, detail: { identity: t.team_id, kind: "Team Graph (source of truth)", version: t.version, owner: t.project_id } });
  link("prj", "team", "contains");

  add({ id: "repo", type: "REPOSITORY", label: "osa-proof", sub: d.source.repo, r: 12, detail: { identity: d.source.repo, version: d.source.commit ?? undefined, kind: "git repository" } });
  for (const p of d.repo.packages) {
    add({ id: `pkg:${p}`, type: "CODE", label: p, sub: `packages/${p}`, r: 6, detail: { identity: `packages/${p}`, kind: "package", owner: d.source.repo, version: d.source.commit ?? undefined } });
    link("repo", `pkg:${p}`, "contains");
  }
  for (const a of d.repo.apps) {
    add({ id: `app:${a}`, type: "SERVICE", label: `apps/${a}`, sub: "application", r: 8, detail: { identity: `apps/${a}`, kind: "application", owner: d.source.repo } });
    link("repo", `app:${a}`, "contains");
  }
  for (const f of d.repo.docs) {
    add({ id: `doc:${f}`, type: "KNOWLEDGE", label: f.replace(/\.md$/, "").replace(/_/g, " "), sub: `docs/${f}`, r: 5.5, detail: { identity: `docs/${f}`, kind: "contract / architecture document", owner: d.source.repo } });
    link("repo", `doc:${f}`, "documents");
  }
  for (const l of d.layers) {
    add({ id: `layer:${l.layer_id}`, type: "POLICY", label: `${l.label} gate`, sub: `${l.product_layer} · ${l.access_mode}`, r: 6, detail: { identity: `layer:${l.layer_id}`, kind: "layer entry policy", state: l.access_mode === "REGULATED" ? "GATED (fails closed)" : "ALLOWED", inputs: l.requirements.length ? l.requirements.join(", ") : "none required", owner: "osa-proof API (POST /layers/:id/enter)" } });
    link("app:api", `layer:${l.layer_id}`, "enforces");
  }
  for (const a of t.agents) {
    add({ id: `agent:${a.agent_id}`, type: "AGENT", label: a.agent_id, sub: a.role, r: 9, detail: { identity: a.agent_id, kind: `agent · ${a.role}`, version: `team v${t.version}`, owner: t.team_id, dependencies: a.executor_ref, model: a.model_ref } });
    link("team", `agent:${a.agent_id}`, "contains");
    add({ id: `exec:${a.executor_ref}`, type: "CODE", label: a.executor_ref, sub: "executor ref", r: 5.5, detail: { identity: a.executor_ref, kind: "executor binding", owner: "osa-proof API registry" } });
    link(`agent:${a.agent_id}`, `exec:${a.executor_ref}`, "runs");
  }
  for (const e of t.edges) link(`agent:${e.from_agent_id}`, `agent:${e.to_agent_id}`, e.kind, true);

  for (const run of d.runs) {
    const m = d.missions.find((x) => x.mission_id === run.proof.mission_id);
    const state = run.verdict === "FAILED" ? "FAILED" : run.verdict === "VERIFIED" ? "VERIFIED" : undefined;
    const mid = `mission:${run.proof.mission_id}`;
    add({ id: mid, type: "MISSION", label: run.proof.mission_id, sub: m?.objective ?? "mission", r: 9, state, runId: run.run_id, detail: { identity: run.proof.mission_id, kind: "mission", state: run.verdict, version: `team v${run.proof.team_version}`, inputs: m ? JSON.stringify(m.input) : undefined, outputs: `final_output sha256 ${short(String(run.proof.final_output_sha256), 16)}`, owner: run.proof.team_id } });
    link("team", mid, "executes");
    if (m) link(mid, `agent:${m.entry_agent_id}`, "entry", true);
    for (const ev of run.evidence) {
      const eid = `evidence:${ev.evidence_id}`;
      add({ id: eid, type: "EVIDENCE", label: `${ev.kind} #${ev.sequence}`, sub: short(ev.evidence_sha256, 14), r: 6, runId: run.run_id, detail: { identity: ev.evidence_id, kind: `evidence · ${ev.kind}`, state: String(ev.data.status ?? ""), inputs: `operation ${ev.producer.operation_id}`, outputs: `evidence_sha256 ${ev.evidence_sha256}`, owner: ev.agent_id, version: ev.provenance } });
      link(`agent:${ev.agent_id}`, eid, "produced", true);
      link(mid, eid, "evidence");
    }
    const pid = `proof:${run.proof.proof_id}`;
    add({ id: pid, type: "PROOF", label: `proof_${run.proof.proof_id.slice(6, 14)}…`, sub: run.verdict, r: 9, state, runId: run.run_id, detail: { identity: run.proof.proof_id, kind: run.proof.schema, state: run.verdict, version: `verifier ${run.proof.verifier.name} v${run.proof.verifier.version}`, "last change": run.proof.created_at, owner: run.proof.verifier.name, outputs: `receipt_sha256 ${run.proof.receipt_sha256}` } });
    link(mid, pid, "sealed by");
    for (const ev of run.evidence) link(`evidence:${ev.evidence_id}`, pid, "verified in", true);
  }
  return layout({ nodes, edges, byId: new Map() });
}

// Deterministic force layout (seeded ring init; repulsion + springs + centering).
function layout(g: Graph): Graph {
  const { nodes, edges } = g;
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const groups = ["WORKSPACE", "REPOSITORY", "CODE", "SERVICE", "KNOWLEDGE", "POLICY", "AGENT", "MISSION", "EVIDENCE", "PROOF"];
  nodes.forEach((n, i) => {
    const gi = Math.max(0, groups.indexOf(n.type));
    const a = (gi / groups.length) * Math.PI * 2 + i * 0.37;
    const rad = 120 + (i % 7) * 26;
    n.x = Math.cos(a) * rad; n.y = Math.sin(a) * rad;
  });
  const vx = new Float64Array(nodes.length), vy = new Float64Array(nodes.length);
  for (let it = 0; it < 420; it++) {
    const cool = 1 - it / 420;
    for (let i = 0; i < nodes.length; i++) for (let j = i + 1; j < nodes.length; j++) {
      let dx = nodes[i].x - nodes[j].x, dy = nodes[i].y - nodes[j].y;
      const d2 = dx * dx + dy * dy + 0.01, d = Math.sqrt(d2);
      const f = (2600 / d2) * cool; dx /= d; dy /= d;
      vx[i] += dx * f; vy[i] += dy * f; vx[j] -= dx * f; vy[j] -= dy * f;
    }
    for (const e of edges) {
      const a = idx.get(e.from), b = idx.get(e.to); if (a === undefined || b === undefined) continue;
      const dx = nodes[b].x - nodes[a].x, dy = nodes[b].y - nodes[a].y, d = Math.sqrt(dx * dx + dy * dy) + 0.01;
      const f = (d - 74) * 0.02;
      vx[a] += (dx / d) * f; vy[a] += (dy / d) * f; vx[b] -= (dx / d) * f; vy[b] -= (dy / d) * f;
    }
    for (let i = 0; i < nodes.length; i++) {
      vx[i] -= nodes[i].x * 0.004; vy[i] -= nodes[i].y * 0.004;
      nodes[i].x += Math.max(-12, Math.min(12, vx[i])); nodes[i].y += Math.max(-12, Math.min(12, vy[i]));
      vx[i] *= 0.6; vy[i] *= 0.6;
    }
  }
  return { nodes, edges, byId: new Map(nodes.map((n) => [n.id, n])) };
}

// Causal path for a mission, using only nodes that exist in the captured run.
export function causalPath(g: Graph, missionId: string): { nodes: Set<string>; edges: Set<string> } {
  const ids = new Set<string>();
  const start = g.byId.get(`mission:${missionId}`);
  if (!start) return { nodes: ids, edges: new Set() };
  const eIds = new Set<string>();
  const KINDS = new Set(["entry", "produced", "handoff", "verified in", "sealed by"]);
  // Follow only edges that belong to this mission's run; agents are shared across runs.
  const inRun = (id: string) => { const n = g.byId.get(id)!; return n.type === "AGENT" || n.runId === start.runId; };
  const walk = (id: string) => {
    if (ids.has(id)) return; ids.add(id);
    for (const e of g.edges) if (e.from === id && KINDS.has(e.kind) && inRun(e.to)) { eIds.add(e.id); walk(e.to); }
  };
  walk(start.id);
  return { nodes: ids, edges: eIds };
}

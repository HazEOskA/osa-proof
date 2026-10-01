import { useEffect, useState } from "react";
import { loadWeb3Mission, observeWeb3, refreshWeb3Status, setWeb3Session, useWeb3Data, type Web3Page } from "../data/web3";
import { Mono, Section, short } from "../ui/primitives";
import { useOsa } from "../ctx";
const TITLES: Record<Web3Page,string> = { overview: "Web3 Overview", chains: "Chains", wallets: "Wallets", entities: "Entities", events: "Events", transactions: "Transactions", agents: "Agents", protocols: "Protocols", risk: "Risk", proof: "Proof" };
function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return <div className="overflow-x-auto border-y border-line"><table className="w-full text-left text-[12px]"><thead className="text-dim"><tr>{columns.map(c => <th key={c} className="px-3 py-3 font-normal">{c}</th>)}</tr></thead><tbody>{rows.map((row,i) => <tr key={i} className="border-t border-line/50">{row.map((cell,j) => <td key={j} className="mono max-w-[360px] break-all px-3 py-3">{cell}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="px-3 py-6 text-[13px] text-dim">Brak zapisanych obserwacji dla wybranej Mission.</p>}</div>;
}
export default function Web3({ page }: { page: Web3Page }) {
  const { status, mission, busy, error } = useWeb3Data(); const { go } = useOsa();
  const [missionId,setMissionId] = useState(mission?.record.mission.mission_id ?? "");
  const [operation,setOperation] = useState("balance"); const [identifier,setIdentifier] = useState(""); const [session,setSession] = useState("");
  useEffect(() => { void refreshWeb3Status(); },[]);
  const world = mission?.world; const entities = world?.entities ?? []; const run = mission?.record.run;
  const read = () => {
    const input: Record<string, unknown> = { chain: "solana",operation };
    if (["transaction","status","verify"].includes(operation)) input.signature = identifier;
    else if (operation === "block") input.slot = Number(identifier);
    else if (operation !== "slot") input.address = identifier;
    void observeWeb3(missionId,input);
  };
  const inputClass = "focus-ring tap mono rounded border border-line bg-panel px-3 text-[12px]";
  return <div className="mx-auto flex max-w-[1200px] flex-col gap-6 px-4 py-6 md:px-8">
    <header className="border-b border-line pb-5"><div className="label mb-2">WEB3 · SOLANA · READ FIRST</div><h2 className="font-display text-[clamp(20px,3vw,34px)] font-normal">{TITLES[page] ?? "Web3"}</h2><p className="mt-2 max-w-[76ch] text-[14px] text-dim">Obserwacje chain przez istniejący runtime OSA. Integralność evidence i receipt jest weryfikowana przez OSA; odpowiedź RPC nie jest kryptograficznym dowodem chain.</p></header>
    <div className="flex flex-wrap items-center gap-3 text-[12px]"><Mono>{status?.mode ?? "UNKNOWN"}</Mono><span>RPC: {status ? status.rpcConfigured ? "skonfigurowane" : "brak konfiguracji" : "UNKNOWN"}</span><span>Signing: DISABLED</span><span>Submit: DISABLED</span><button onClick={() => void refreshWeb3Status()} className={inputClass}>Odśwież API</button></div>
    {error && <p role="alert" className="mono text-[12px] text-bad">{error}</p>}
    <Section title="Mission context"><div className="flex flex-wrap gap-2"><input aria-label="Web3 mission id" placeholder="mission_id" value={missionId} onChange={e => setMissionId(e.target.value)} className={inputClass}/><button disabled={busy || !missionId} onClick={() => void loadWeb3Mission(missionId)} className={inputClass}>Odczytaj zapis</button>{mission && <span className="mono self-center text-[12px]">{mission.record.state} · {mission.record.mission.project_id}</span>}</div></Section>
    {page === "overview" && <>
      <Section title="Solana observation"><div className="flex flex-wrap gap-2"><select aria-label="Solana read operation" value={operation} onChange={e => setOperation(e.target.value)} className={inputClass}>{["wallet","balance","tokens","transaction","status","verify","slot","block","events"].map(o => <option key={o}>{o}</option>)}</select><input aria-label="Address signature or slot" placeholder="address / signature / slot" value={identifier} onChange={e => setIdentifier(e.target.value)} className={`${inputClass} min-w-[240px] flex-1`}/><button disabled={busy || !missionId || !status?.rpcConfigured} onClick={read} className={inputClass}>{busy ? "Odczyt…" : "Uruchom READ Mission"}</button></div><p className="mt-3 text-[12px] text-dim">Monitoring → Analysis → Risk → Verification. Nowy odczyt wymaga nowego mission_id; ponowienie identycznej zakończonej Mission zwraca jej zapis. Watch pobiera ograniczoną stronę historii, bez procesu działającego w tle.</p></Section>
      <Section title="Access"><p className="mb-2 text-[12px] text-dim">Auth: {status?.authMode ?? "UNKNOWN"}. W trybie session użyj istniejącej sesji OSA. Token pozostaje w sessionStorage i trafia wyłącznie do własnego API.</p><div className="flex gap-2"><input type="password" autoComplete="off" aria-label="OSA session token" value={session} onChange={e => setSession(e.target.value)} className={inputClass}/><button onClick={() => { setWeb3Session(session);setSession("");void refreshWeb3Status(); }} className={inputClass}>Ustaw sesję</button></div></Section>
      <Section title="Runtime state"><Table columns={["Entity","Event","Evidence","Mission"]} rows={mission ? [[String(entities.length),String(world?.events.length ?? 0),String(run?.evidence.length ?? 0),mission.record.mission.mission_id]] : []}/><button onClick={() => go("world")} className={`${inputClass} mt-3`}>Otwórz istniejący World</button></Section>
    </>}
    {page === "chains" && <Table columns={["Chain","Network / genesis","Assurance"]} rows={entities.filter(e => e.type === "Chain").map(e => [e.chain.id,e.chain.network,"RPC_VALIDATED"])}/>}
    {["wallets","entities","transactions"].includes(page) && <Table columns={["Type","Identifier","Observed state","Evidence references"]} rows={entities.filter(e => page === "entities" || e.type === (page === "wallets" ? "Wallet" : "Transaction")).map(e => [e.type,e.identifier,JSON.stringify(e.metadata),e.proofRefs.map(r => short(r)).join(", ")])}/>}
    {page === "events" && <Table columns={["Type","Slot","Transaction","Source","Evidence"]} rows={(world?.events ?? []).map(e => [e.eventType,String(e.slot ?? "UNKNOWN"),e.transactionRef ?? "—",e.source,e.proofRef ?? "—"])}/>}
    {page === "agents" && <><Table columns={["OSA role","Executor","Status"]} rows={status?.agents.map(a => [a.role,a.executor_ref,a.status ?? (status.rpcConfigured ? "REGISTERED" : "UNAVAILABLE")]) ?? []}/><Table columns={["Capability","Availability"]} rows={status?.capabilities.map(c => [c.id,c.health]) ?? []}/></>}
    {page === "protocols" && <Table columns={["Protocol domain","Implemented support"]} rows={status?.protocols.map(p => [p.id,p.support]) ?? []}/>}
    {page === "risk" && <><p className="text-[13px] text-dim">Domyślna polityka blokuje transakcje. Brak symulacji, allowlist lub limitu oznacza odmowę. Ocena ekonomiczna i audyt kontraktów: UNKNOWN. Human approval nie odblokowuje execution w V0.1.</p><Table columns={["Gate","Default"]} rows={[["Chains","Solana"],["Tokens / programs / wallets","deny until explicitly allowlisted"],["Value / frequency","base-unit limits; 1/min contract"],["Simulation","required; unavailable in V0.1"],["Human approval","required; execution disabled"],["High / unknown risk","blocked"]]}/></>}
    {page === "proof" && <><Table columns={["OSA verdict","Evidence root","Mission receipt"]} rows={run ? [[run.verdict,run.proof.evidence_root,mission?.record.mission_receipt?.receipt_sha256 ?? "NOT_CREATED"]] : []}/><Table columns={["Evidence kind","ID","Digest"]} rows={run?.evidence.map(e => [e.kind,e.evidence_id,e.evidence_sha256]) ?? []}/><p className="text-[12px] text-dim">VERIFIED oznacza spełnienie jawnych wymagań Mission. Assurance chain pozostaje RPC_VALIDATED; cryptographicProof=false.</p></>}
  </div>;
}

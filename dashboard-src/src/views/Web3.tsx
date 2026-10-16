import { useEffect, useState } from "react";
import { loadWeb3Mission, observeWeb3, refreshWeb3Status, setWeb3Session, useWeb3Data, type Web3Page } from "../data/web3";
import { Mono, Section, short } from "../ui/primitives";
import { useOsa } from "../ctx";
const TITLES: Record<Web3Page,string> = { overview: "Przegląd Web3", chains: "Sieci blockchain", wallets: "Portfele", entities: "Encje", events: "Zdarzenia", transactions: "Transakcje", agents: "Agenci", protocols: "Protokoły", risk: "Ryzyko", proof: "Dowody" };
function Table({ columns, rows }: { columns: string[]; rows: string[][] }) {
  return <div className="overflow-x-auto border-y border-line"><table className="w-full text-left text-[12px]"><thead className="text-dim"><tr>{columns.map(c => <th key={c} className="px-3 py-3 font-normal">{c}</th>)}</tr></thead><tbody>{rows.map((row,i) => <tr key={i} className="border-t border-line/50">{row.map((cell,j) => <td key={j} className="mono max-w-[360px] break-all px-3 py-3">{cell}</td>)}</tr>)}</tbody></table>{!rows.length && <p className="px-3 py-6 text-[13px] text-dim">Brak zapisanych obserwacji dla wybranej misji.</p>}</div>;
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
    <header className="border-b border-line pb-5"><div className="label mb-2">WEB3 · SOLANA · TYLKO ODCZYT</div><h2 className="font-display text-[clamp(20px,3vw,34px)] font-normal">{TITLES[page] ?? "Web3"}</h2><p className="mt-2 max-w-[76ch] text-[14px] text-dim">Obserwacje blockchain przez silnik OSA. Integralność materiałów dowodowych i potwierdzeń jest sprawdzana przez OSA; odpowiedź RPC nie jest kryptograficznym dowodem stanu sieci.</p></header>
    <div className="flex flex-wrap items-center gap-3 text-[12px]"><Mono>{status?.mode ?? "UNKNOWN"}</Mono><span>RPC: {status ? status.rpcConfigured ? "skonfigurowane" : "brak konfiguracji" : "UNKNOWN"}</span><span>Podpisywanie: WYŁĄCZONE</span><span>Wysyłanie: WYŁĄCZONE</span><button onClick={() => void refreshWeb3Status()} className={inputClass}>Odśwież API</button></div>
    {error && <p role="alert" className="mono text-[12px] text-bad">{error}</p>}
    <Section title="Kontekst misji"><div className="flex flex-wrap gap-2"><input aria-label="Identyfikator misji Web3" placeholder="mission_id" value={missionId} onChange={e => setMissionId(e.target.value)} className={inputClass}/><button disabled={busy || !missionId} onClick={() => void loadWeb3Mission(missionId)} className={inputClass}>Odczytaj zapis</button>{mission && <span className="mono self-center text-[12px]">{mission.record.state} · {mission.record.mission.project_id}</span>}</div></Section>
    {page === "overview" && <>
      <Section title="Obserwacja Solany"><div className="flex flex-wrap gap-2"><select aria-label="Operacja odczytu Solany" value={operation} onChange={e => setOperation(e.target.value)} className={inputClass}>{["wallet","balance","tokens","transaction","status","verify","slot","block","events"].map(o => <option key={o}>{o}</option>)}</select><input aria-label="Adres, podpis lub numer slotu" placeholder="address / signature / slot" value={identifier} onChange={e => setIdentifier(e.target.value)} className={`${inputClass} min-w-[240px] flex-1`}/><button disabled={busy || !missionId || !status?.rpcConfigured} onClick={read} className={inputClass}>{busy ? "Odczyt…" : "Uruchom READ Mission"}</button></div><p className="mt-3 text-[12px] text-dim">Monitorowanie → Analiza → Ryzyko → Weryfikacja. Nowy odczyt wymaga nowego mission_id; ponowienie zakończonej misji zwraca zapis. Obserwacja pobiera ograniczoną porcję historii bez pracy w tle.</p></Section>
      <Section title="Dostęp"><p className="mb-2 text-[12px] text-dim">Uwierzytelnianie: {status?.authMode ?? "NIEZNANE"}. W trybie session użyj istniejącej sesji OSA. Token pozostaje w sessionStorage i trafia wyłącznie do własnego API.</p><div className="flex gap-2"><input type="password" autoComplete="off" aria-label="Token sesji OSA" value={session} onChange={e => setSession(e.target.value)} className={inputClass}/><button onClick={() => { setWeb3Session(session);setSession("");void refreshWeb3Status(); }} className={inputClass}>Ustaw sesję</button></div></Section>
      <Section title="Stan silnika wykonawczego"><Table columns={["Encje","Zdarzenia","Dowody","Misja"]} rows={mission ? [[String(entities.length),String(world?.events.length ?? 0),String(run?.evidence.length ?? 0),mission.record.mission.mission_id]] : []}/><button onClick={() => go("world")} className={`${inputClass} mt-3`}>Otwórz świat wiedzy</button></Section>
    </>}
    {page === "chains" && <Table columns={["Sieć","Sieć / genesis","Poziom potwierdzenia"]} rows={entities.filter(e => e.type === "Chain").map(e => [e.chain.id,e.chain.network,"RPC_VALIDATED"])}/>}
    {["wallets","entities","transactions"].includes(page) && <Table columns={["Typ","Identyfikator","Zaobserwowany stan","Odwołania do dowodów"]} rows={entities.filter(e => page === "entities" || e.type === (page === "wallets" ? "Wallet" : "Transaction")).map(e => [e.type,e.identifier,JSON.stringify(e.metadata),e.proofRefs.map(r => short(r)).join(", ")])}/>}
    {page === "events" && <Table columns={["Typ","Slot","Transakcja","Źródło","Dowody"]} rows={(world?.events ?? []).map(e => [e.eventType,String(e.slot ?? "UNKNOWN"),e.transactionRef ?? "—",e.source,e.proofRef ?? "—"])}/>}
    {page === "agents" && <><Table columns={["Rola OSA","Wykonawca","Stan"]} rows={status?.agents.map(a => [a.role,a.executor_ref,a.status ?? (status.rpcConfigured ? "REGISTERED" : "UNAVAILABLE")]) ?? []}/><Table columns={["Możliwość","Dostępność"]} rows={status?.capabilities.map(c => [c.id,c.health]) ?? []}/></>}
    {page === "protocols" && <Table columns={["Domena protokołu","Zaadaptowana obsługa"]} rows={status?.protocols.map(p => [p.id,p.support]) ?? []}/>}
    {page === "risk" && <><p className="text-[13px] text-dim">Domyślne zasady blokują transakcje. Brak symulacji, listy dozwolonych adresów lub limitu oznacza odmowę. Ocena ekonomiczna i audyt kontraktów: NIEZNANE. Zgoda człowieka nie odblokowuje wykonania w wersji 0.1.</p><Table columns={["Bramka","Domyślnie"]} rows={[["Chains","Solana"],["Tokens / programs / wallets","odmowa do czasu jawnego dopuszczenia"],["Value / frequency","limity jednostek; 1/min na kontrakt"],["Simulation","wymagane; niedostępne w wersji 0.1"],["Human approval","wymagane; wykonywanie wyłączone"],["High / unknown risk","zablokowane"]]}/></>}
    {page === "proof" && <><Table columns={["Werdykt OSA","Korzeń dowodów","Potwierdzenie misji"]} rows={run ? [[run.verdict,run.proof.evidence_root,mission?.record.mission_receipt?.receipt_sha256 ?? "NOT_CREATED"]] : []}/><Table columns={["Rodzaj dowodu","ID","Skrót"]} rows={run?.evidence.map(e => [e.kind,e.evidence_id,e.evidence_sha256]) ?? []}/><p className="text-[12px] text-dim">ZWERYFIKOWANO oznacza spełnienie jawnych wymagań misji. Potwierdzenie stanu sieci pozostaje na poziomie RPC_VALIDATED; cryptographicProof=false.</p></>}
  </div>;
}

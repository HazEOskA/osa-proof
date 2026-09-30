import type { AgentNode } from '../data/types';
const crewAtlas='/assets/crew/osa-crew-atlas.png';
const fleetAtlas='/assets/crew/osa-fleet-atlas.png';
type Portrait = { name:string; role:string; family:'agent'|'minion'|'worker'; atlas:string; rect:[number,number,number,number]; atlasHeight:number; color:string };
export const CREW:Record<string,Portrait>={
 agent:{name:'OSA',role:'Autonomiczne wykonanie',family:'agent',atlas:crewAtlas,rect:[190,173,151,167],atlasHeight:864,color:'#ffbe43'},
 kai:{name:'KAI',role:'Strateg / planner',family:'agent',atlas:fleetAtlas,rect:[490,28,161,136],atlasHeight:559,color:'#ffc34b'},
 ren:{name:'REN',role:'Research / analiza',family:'agent',atlas:fleetAtlas,rect:[655,28,151,136],atlasHeight:559,color:'#41dfff'},
 sora:{name:'SORA',role:'Content / kreacja',family:'agent',atlas:fleetAtlas,rect:[809,28,150,136],atlasHeight:559,color:'#ee69ff'},
 aki:{name:'AKI',role:'Editor / dopracowanie',family:'agent',atlas:fleetAtlas,rect:[963,28,143,136],atlasHeight:559,color:'#ff7854'},
 minion:{name:'MINION',role:'Zadania pomocnicze',family:'minion',atlas:crewAtlas,rect:[839,205,112,133],atlasHeight:864,color:'#40d9ff'},
 scout:{name:'SCOUT',role:'Odkrywanie / zbieranie',family:'worker',atlas:crewAtlas,rect:[953,205,117,133],atlasHeight:864,color:'#61efba'},
 builder:{name:'BUILDER',role:'Kod / build',family:'worker',atlas:crewAtlas,rect:[1072,201,109,137],atlasHeight:864,color:'#ffd252'},
 tester:{name:'TESTER',role:'QA / weryfikacja',family:'worker',atlas:crewAtlas,rect:[1182,201,110,137],atlasHeight:864,color:'#ff557e'},
 devops:{name:'DEVOPS',role:'Deploy / skalowanie',family:'worker',atlas:crewAtlas,rect:[1296,202,112,136],atlasHeight:864,color:'#c565ff'},
 analyst:{name:'ANALYST',role:'Dane / insights',family:'worker',atlas:crewAtlas,rect:[1411,202,120,136],atlasHeight:864,color:'#41caff'},
 analyzer:{name:'ANALYZER',role:'Ekstrakcja / klasyfikacja',family:'worker',atlas:fleetAtlas,rect:[1282,45,76,99],atlasHeight:559,color:'#5bdfff'},
 executor:{name:'EXECUTOR',role:'Uruchamianie / testy',family:'worker',atlas:fleetAtlas,rect:[1366,46,79,98],atlasHeight:559,color:'#ffc65b'},
 monitor:{name:'MONITOR',role:'Obserwacja / alerty',family:'worker',atlas:fleetAtlas,rect:[1450,27,78,117],atlasHeight:559,color:'#60dfff'},
};
export function resolvePortrait(agent:Pick<AgentNode,'agent_id'|'role'|'executor_ref'|'avatar_ref'>):string {
 if(agent.avatar_ref&&CREW[agent.avatar_ref])return agent.avatar_ref;
 const name=`${agent.agent_id} ${agent.role}`.toLowerCase();
 for(const id of ['kai','ren','sora','aki','minion','scout','builder','tester','devops','analyst','analyzer','executor','monitor'])if(new RegExp(`\\b${id}\\b`).test(name))return id;
 if(/planner|strateg|planista/.test(name))return 'kai';
 if(/research|badacz|wyszuk|analiz/.test(name))return 'ren';
 if(/content|treści|twórc|writer/.test(name))return 'sora';
 if(/editor|redaktor|polish/.test(name))return 'aki';
 if(/test|qa|verify|weryfik/.test(name))return 'tester';
 if(/deploy|ops/.test(name))return 'devops';
 if(/build|kod|program/.test(name)||agent.executor_ref.includes('builder'))return 'builder';
 if(/worker|narzędz|tool/.test(name))return 'executor';
 return 'agent';
}
export function CrewPortrait({id,size=96,className=''}:{id:string;size?:number;className?:string}) {
 const p=CREW[id]||CREW.agent;
 return <svg className={`osa-crew-portrait ${className}`} width={size} height={size} viewBox={p.rect.join(' ')} preserveAspectRatio="xMidYMid slice" role="img" aria-label={`${p.name} · ${p.role}`} style={{'--crew-color':p.color} as React.CSSProperties}><title>{p.name} · {p.role}</title><image href={p.atlas} width="1536" height={p.atlasHeight}/></svg>;
}
export function CommandShip({className=''}:{className?:string}) {
 return <svg className={`osa-command-ship ${className}`} viewBox="139 249 810 204" role="img" aria-label="OSA Leviathan · statek dowodzenia"><title>OSA Leviathan · statek dowodzenia</title><image href={fleetAtlas} width="1536" height="559"/></svg>;
}

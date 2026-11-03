// Browser-only persistence for native chat. IndexedDB stores full message/bundle objects.
// Legacy localStorage remains untouched for safe migration and emergency fallback.
export const CHAT_HISTORY_DB = "osa.native-chat.history.v2";
const VERSION = 1;
const SESSIONS = "sessions";
const META = "meta";
type Item = {id:string};
export type HistoryLoad<T extends Item> = {
  sessions:T[];
  activeId:string|null;
  source:"indexeddb"|"migrated";
};
function openDb():Promise<IDBDatabase> {
  return new Promise((resolve,reject)=>{
    if(typeof indexedDB==="undefined")return reject(new Error("HISTORY_INDEXEDDB_UNAVAILABLE"));
    let req:IDBOpenDBRequest;
    try{req=indexedDB.open(CHAT_HISTORY_DB,VERSION);}catch(e){reject(e);return;}
    req.onupgradeneeded=()=>{
      const db=req.result;
      if(!db.objectStoreNames.contains(SESSIONS))db.createObjectStore(SESSIONS,{keyPath:"id"});
      if(!db.objectStoreNames.contains(META))db.createObjectStore(META,{keyPath:"key"});
    };
    req.onsuccess=()=>{
      const db=req.result;
      db.onversionchange=()=>db.close();
      resolve(db);
    };
    req.onerror=()=>reject(req.error??new Error("HISTORY_INDEXEDDB_OPEN_FAILED"));
    req.onblocked=()=>reject(new Error("HISTORY_INDEXEDDB_BLOCKED"));
  });
}
function result<T>(request:IDBRequest<T>):Promise<T> {
  return new Promise((resolve,reject)=>{
    request.onsuccess=()=>resolve(request.result);
    request.onerror=()=>reject(request.error??new Error("HISTORY_INDEXEDDB_READ_FAILED"));
  });
}
function completed(tx:IDBTransaction):Promise<void> {
  return new Promise((resolve,reject)=>{
    tx.oncomplete=()=>resolve();
    tx.onabort=()=>reject(tx.error??new Error("HISTORY_INDEXEDDB_TX_ABORTED"));
    tx.onerror=()=>reject(tx.error??new Error("HISTORY_INDEXEDDB_TX_FAILED"));
  });
}
async function write<T extends Item>(db:IDBDatabase,sessions:T[],activeId:string):Promise<void> {
  const tx=db.transaction([SESSIONS,META],"readwrite");
  const done=completed(tx);
  const target=tx.objectStore(SESSIONS);
  target.clear();
  for(const session of sessions){
    if(!session||typeof session.id!=="string"||!session.id)throw new Error("HISTORY_INVALID_SESSION_ID");
    target.put(session);
  }
  const meta=tx.objectStore(META);
  meta.put({key:"active",value:activeId});
  meta.put({key:"migrated",value:true});
  await done; // Report saved ONLY after the complete/committed IndexedDB transaction.
}
export async function saveChatHistory<T extends Item>(sessions:T[],activeId:string):Promise<void> {
  const db=await openDb();
  try{await write(db,sessions,activeId);}finally{db.close();}
}
export async function loadChatHistory<T extends Item>(
  legacySessions:T[],legacyActiveId:string|null
):Promise<HistoryLoad<T>> {
  const db=await openDb();
  try{
    const tx=db.transaction([SESSIONS,META],"readonly");
    const done=completed(tx);
    const rows=result(tx.objectStore(SESSIONS).getAll() as IDBRequest<T[]>);
    const active=result(tx.objectStore(META).get("active") as IDBRequest<{key:string;value:string}|undefined>);
    const migrated=result(tx.objectStore(META).get("migrated") as IDBRequest<{key:string;value:boolean}|undefined>);
    const [stored,selected,migration]=await Promise.all([rows,active,migrated]);
    await done;
    if(migration?.value===true)return{sessions:stored,activeId:selected?.value??null,source:"indexeddb"};
    // Crash-tolerant migration: pre-existing DB data wins; never silently overwrite it
    // with stale legacy localStorage. Keep legacy values until the DB transaction commits.
    const sessions=stored.length?stored:legacySessions;
    const activeId=selected?.value??legacyActiveId??sessions[0]?.id??"";
    await write(db,sessions,activeId);
    return{sessions,activeId,source:"migrated"};
  }finally{db.close();}
}

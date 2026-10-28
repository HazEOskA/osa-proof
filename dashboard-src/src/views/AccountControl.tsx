import {useEffect,useState} from "react";
import {SocialLoginScreen, useSocialAuthStatus} from "./SocialLogin";

type Identity={display_name?:string;provider:string;roles?:string[]};
export default function AccountControl() {
  const {status:social}=useSocialAuthStatus();
  const [identity,setIdentity]=useState<Identity|null>(null);
  const [open,setOpen]=useState(false);
  const [busy,setBusy]=useState(false);
  const [error,setError]=useState("");
  useEffect(()=>{
    const controller=new AbortController();
    fetch("/api/session",{signal:controller.signal,credentials:"same-origin",cache:"no-store"})
      .then(async r=>r.ok?await r.json() as {identity?:Identity}:null)
      .then(r=>{
        if(controller.signal.aborted)return;
        if(r?.identity && r.identity.provider!=="local-dev")setIdentity(r.identity);
      }).catch(()=>{});
    return ()=>controller.abort();
  },[]);
  const logOut=async()=>{
    setBusy(true);setError("");
    try {
      const endpoint=social.authenticated?"/api/auth/social/logout":"/api/auth/github/logout";
      const r=await fetch(endpoint,{method:"POST",credentials:"same-origin"});
      if(!r.ok)throw Error("Wylogowanie nie powiodło się.");
      location.reload();
    }catch(e){setError(e instanceof Error?e.message:"Wylogowanie nie powiodło się.");}
    finally{setBusy(false);}
  };
  const owner=identity?.roles?.includes("owner")||identity?.roles?.includes("operator");
  const protectedPreview=identity?.provider==="vercel-preview";
  return <div className="relative z-30 flex shrink-0 items-center gap-2">
    {protectedPreview ? <span className="mono max-w-[165px] truncate rounded border border-line2 px-2 py-2 text-[10px] text-cyan"
      title="Operator chronionego Preview jest uwierzytelniany przez Vercel, nie przez OAuth; nie ma tutaj sesji OAuth do wylogowania.">
      Operator Preview
    </span> : identity?<>
      <span className="mono hidden max-w-[135px] truncate text-[10px] text-cyan sm:block" title={owner?"Właściciel / operator":"Zalogowane konto"}>
        {identity.display_name??identity.provider}{owner?" · OWNER":""}
      </span>
      <button type="button" disabled={busy} onClick={logOut}
        className="focus-ring tap rounded-md border border-line2 bg-panel px-3 text-xs font-semibold text-fg hover:bg-raise disabled:opacity-50">
        Wyloguj
      </button>
    </>:<button type="button" onClick={()=>setOpen(true)}
        className="focus-ring tap rounded-md border border-brand bg-brand px-3 text-xs font-bold text-white hover:brightness-110">
        Zaloguj
      </button>}
    {error&&<span role="status" className="text-xs text-warn">{error}</span>}
    {open&&<SocialLoginScreen status={social} onClose={()=>setOpen(false)}/>}
  </div>;
}

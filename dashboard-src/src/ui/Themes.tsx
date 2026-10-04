import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useOsa } from '../ctx';
import { MAX_THEME_BYTES } from '../theme';
export function ThemeSwitch() {
 const {theme,themes,setTheme,importTheme,removeTheme,themeStorageError}=useOsa();
 const [open,setOpen]=useState(false), [message,setMessage]=useState(''), [error,setError]=useState('');
 const dialog=useRef<HTMLDialogElement>(null);
 useEffect(()=>{if(open)dialog.current?.showModal();},[open]);
 const exportTheme=()=>{const selected=themes.find(t=>t.id===theme)!;const url=URL.createObjectURL(new Blob([JSON.stringify(selected,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`osa-theme-${selected.id.replace(':','-')}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);};
 return <div className="flex items-center gap-1">
  <select aria-label="Motyw" className="focus-ring max-w-[140px] rounded border border-line2 bg-panel px-2 py-2 text-xs text-fg" value={theme} onChange={e=>setTheme(e.target.value)}>
   {(['dark','light'] as const).map(mode=><optgroup key={mode} label={mode==='dark'?'Ciemne':'Jasne'}>{themes.filter(t=>t.mode===mode&&!t.id.startsWith('community:')).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>)}
   {themes.some(t=>t.id.startsWith('community:'))&&<optgroup label="Community">{themes.filter(t=>t.id.startsWith('community:')).map(t=><option key={t.id} value={t.id}>{t.name}</option>)}</optgroup>}
  </select>
  <button type="button" aria-label="Zarządzaj motywami" onClick={()=>setOpen(true)} className="focus-ring rounded border border-line2 px-2 py-2 text-xs text-dim hover:text-fg">Motywy</button>
  {open&&createPortal(<dialog ref={dialog} onClose={()=>setOpen(false)} aria-labelledby="theme-dialog-title" className="theme-dialog rounded-lg border border-line2 bg-ink p-0 text-fg shadow-2xl">
   <div className="sticky top-0 z-10 flex items-center justify-between border-b border-line bg-ink px-5 py-4"><h2 id="theme-dialog-title" className="font-display text-sm">Motywy</h2><button autoFocus className="focus-ring px-3 py-2 text-sm" onClick={()=>dialog.current?.close()}>Zamknij</button></div>
   <div className="space-y-6 p-5">
    <p className="text-sm text-dim">{themes.filter(t=>t.mode==='dark'&&!t.id.startsWith('community:')).length} ciemnych i {themes.filter(t=>t.mode==='light'&&!t.id.startsWith('community:')).length} jasnych motywów.</p>
    {(['dark','light'] as const).map(mode=><section key={mode}><h3 className="label mb-3">{mode==='dark'?'Ciemne':'Jasne'}</h3><div className="grid grid-cols-2 gap-2 sm:grid-cols-5">{themes.filter(t=>t.mode===mode&&!t.id.startsWith('community:')).map(t=><button key={t.id} type="button" aria-pressed={theme===t.id} onClick={()=>setTheme(t.id)} className="focus-ring overflow-hidden rounded border border-line2 text-left" style={{outline:theme===t.id?'2px solid var(--brand)':undefined}}><div className="flex h-16 items-end gap-1 p-3" style={{background:t.tokens.void}}>{['panel','brand','cyan','violet'].map(k=><span key={k} className="h-5 w-5 rounded-sm" style={{background:t.tokens[k as keyof typeof t.tokens]}}/>)}</div><div className="bg-panel px-3 py-2 text-xs">{t.name}{theme===t.id?' ✓':''}</div></button>)}</div></section>)}
    <section className="border-t border-line pt-4"><h3 className="label mb-2">Community themes</h3><p className="mb-3 text-sm text-dim">Share a JSON palette. Colors only, no scripts or CSS. Saved in this browser. Importing the same ID updates that community theme.</p>
     <div className="flex flex-wrap items-center gap-3"><label className="text-xs text-dim">Import JSON<input aria-label="Import community theme" className="mt-1 block max-w-full text-xs text-fg" type="file" accept=".json,application/json" onChange={async e=>{const file=e.target.files?.[0];e.target.value='';if(!file)return;try{setError('');setMessage('');if(file.size>MAX_THEME_BYTES)throw new Error('Theme file exceeds 24 KB.');const name=importTheme(await file.text());setMessage(`Imported ${name}.`);}catch(err){setError(err instanceof Error?err.message:'Unable to import theme.');}}}/></label><button className="focus-ring rounded border border-line2 px-3 py-2 text-xs" onClick={exportTheme}>Export selected</button></div>
     {themes.filter(t=>t.id.startsWith('community:')).map(t=><div key={t.id} className="mt-3 flex items-center justify-between gap-2 border-b border-line py-2"><button aria-pressed={theme===t.id} className="focus-ring text-sm" onClick={()=>setTheme(t.id)}>{t.name}{t.author?` · ${t.author}`:''}{theme===t.id?' ✓':''}</button><button aria-label={`Remove ${t.name}`} className="focus-ring text-xs text-dim" onClick={()=>removeTheme(t.id)}>Remove</button></div>)}
     <p role="status" className="mt-3 text-sm text-dim">{message}</p>{error&&<p role="alert" className="text-sm text-bad">{error}</p>}{themeStorageError&&<p role="alert" className="text-sm text-warn">Browser storage is unavailable. Changes will not survive a reload.</p>}
    </section>
   </div>
  </dialog>,document.body)}
 </div>;
}

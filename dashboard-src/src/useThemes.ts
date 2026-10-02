import { useRef, useState } from 'react';
import { BUILTIN_THEMES, MAX_COMMUNITY_THEMES, STORAGE_KEY, parseTheme, restoreThemes, themeRgb, TOKEN_KEYS, type ThemeDefinition } from './theme';
export function applyTheme(theme:ThemeDefinition) {
 for(const token of TOKEN_KEYS) document.documentElement.style.setProperty(`--${token}-rgb`,themeRgb(theme.tokens[token]));
 document.documentElement.style.colorScheme=theme.mode;
 document.documentElement.dataset.osaTheme=theme.id;
}
export function useThemes() {
 const [state,setState]=useState(()=>{let cached=null;try{cached=localStorage.getItem(STORAGE_KEY);}catch{/* browser storage may be disabled */}const restored=restoreThemes(cached);applyTheme([...BUILTIN_THEMES,...restored.communityThemes].find(t=>t.id===restored.theme)!);return restored;});
 const current = useRef(state);
 current.current = state;
 const [themeStorageError,setThemeStorageError]=useState(false);
 const themes=[...BUILTIN_THEMES,...state.communityThemes];
 const save=(next:typeof state)=>{applyTheme([...BUILTIN_THEMES,...next.communityThemes].find(t=>t.id===next.theme)!);current.current = next;setState(next);try{localStorage.setItem(STORAGE_KEY,JSON.stringify(next));setThemeStorageError(false);}catch{setThemeStorageError(true);}};
 const setTheme=(id:string)=>{if(themes.some(t=>t.id===id))save({...current.current,theme:id});};
 const importTheme=(text:string)=>{const parsed=parseTheme(text);const others=current.current.communityThemes.filter(t=>t.id!==parsed.id);if(others.length>=MAX_COMMUNITY_THEMES)throw new Error('Remove a community theme before importing another (limit: 20).');save({theme:parsed.id,communityThemes:[...others,parsed]});return parsed.name;};
 const removeTheme=(id:string)=>{if(!id.startsWith('community:'))return;save({theme:current.current.theme===id?'proof':current.current.theme,communityThemes:current.current.communityThemes.filter(t=>t.id!==id)});};
 return {theme:state.theme,activeTheme:themes.find(t=>t.id===state.theme)!,themes,setTheme,importTheme,removeTheme,themeStorageError};
}

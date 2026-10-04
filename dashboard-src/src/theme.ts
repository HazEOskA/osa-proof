export const TOKEN_KEYS = ['void','ink','panel','raise','line','line2','fg','hero','dim','faint','cyan','steel','brand','onbrand','violet','ok','warn','bad','info'] as const;
export type Token = typeof TOKEN_KEYS[number];
export interface ThemeDefinition { schema: 'osa.theme.v1'; id: string; name: string; mode: 'dark'|'light'; author?: string; tokens: Record<Token,string> }
export const STORAGE_KEY = 'osa.themes.v1';
export const MAX_THEME_BYTES = 24 * 1024;
export const MAX_COMMUNITY_THEMES = 20;
const dark: Record<Token,string> = {void:'#050d17',ink:'#070e1c',panel:'#0b1527',raise:'#181e35',line:'#304d84',line2:'#485c75',fg:'#e2ecf7',hero:'#d6e5fa',dim:'#91a6c7',faint:'#91a6c7',cyan:'#a5b8e2',steel:'#a5b8e2',brand:'#4b50f8',onbrand:'#ffffff',violet:'#bc9dff',ok:'#02f477',warn:'#cda15a',bad:'#f08079',info:'#50deda'};
const light: Record<Token,string> = {void:'#f7f8fc',ink:'#f0f2f8',panel:'#ffffff',raise:'#e5e9f2',line:'#cbd2e1',line2:'#a4afc4',fg:'#182336',hero:'#162b52',dim:'#46536a',faint:'#46536a',cyan:'#334c8c',steel:'#334c8c',brand:'#4248cd',onbrand:'#ffffff',violet:'#6843a0',ok:'#14613c',warn:'#765006',bad:'#ac2935',info:'#08646b'};
const preset = (id:string,name:string,mode:'dark'|'light',tokens:Partial<Record<Token,string>> = {}):ThemeDefinition => ({schema:'osa.theme.v1',id,name,mode,tokens:{...(mode==='dark'?dark:light),...tokens}});
export const BUILTIN_THEMES: ThemeDefinition[] = [
 preset('proof','Proof','dark'),
 preset('vercel','Vercel · czerń','dark',{void:'#000000',ink:'#0a0a0a',panel:'#111111',raise:'#1a1a1a',line:'#2e2e2e',line2:'#444444',fg:'#ededed',hero:'#ffffff',dim:'#a1a1a1',faint:'#a1a1a1',brand:'#ffffff',onbrand:'#000000',cyan:'#ededed',steel:'#ededed',violet:'#b3b3b3',ok:'#50e3c2',warn:'#f5a623',bad:'#ff6369',info:'#3291ff'}),
 preset('graphite','Graphite','dark',{void:'#101113',ink:'#161719',panel:'#1c1e21',raise:'#282b30',line:'#40444d',line2:'#69717e',dim:'#afb7c5',faint:'#afb7c5',brand:'#a9c0ee',onbrand:'#172033',cyan:'#bfd0ef',steel:'#bfd0ef'}),
 preset('midnight','Midnight','dark',{void:'#070919',ink:'#0e1228',panel:'#141a36',raise:'#202847',line:'#394779',brand:'#a393ff',onbrand:'#181333',dim:'#b0bad8',faint:'#b0bad8'}),
 preset('forest','Forest','dark',{void:'#081510',ink:'#0e201a',panel:'#142a22',raise:'#203a30',line:'#355d4e',line2:'#638e7d',dim:'#b2c8bd',faint:'#b2c8bd',brand:'#8cddaf',onbrand:'#12261b',cyan:'#a4d9bf',steel:'#a4d9bf',hero:'#d9f2e5'}),
 preset('plum','Plum','dark',{void:'#170c1c',ink:'#211127',panel:'#2d1834',raise:'#3d2546',line:'#694572',line2:'#9d77a8',dim:'#d2b6dc',faint:'#d2b6dc',brand:'#e7adcd',onbrand:'#301324',cyan:'#e2b8e9',steel:'#e2b8e9',hero:'#fae2ef'}),
 preset('porcelain','Porcelain','light'),
 preset('sand','Sand','light',{void:'#faf6ef',ink:'#f3ede2',panel:'#fffdf8',raise:'#eae1d2',line:'#d6c6ab',line2:'#ac9876',fg:'#342b20',hero:'#46321b',dim:'#63513b',faint:'#63513b',brand:'#79541d',cyan:'#725423',steel:'#725423'}),
 preset('sky','Sky','light',{void:'#f1f8ff',ink:'#e9f2fc',panel:'#fbfdff',raise:'#dcebf8',line:'#b8d0e8',line2:'#779cbe',brand:'#20599c',cyan:'#245783',steel:'#245783',hero:'#163d66'}),
 preset('mint','Mint','light',{void:'#f1faf5',ink:'#e7f3ec',panel:'#fcfffd',raise:'#dcece3',line:'#b9d5c6',line2:'#7fa591',fg:'#173629',dim:'#3d5a4d',faint:'#3d5a4d',brand:'#216b48',cyan:'#245d43',steel:'#245d43',hero:'#19432e'}),
 preset('rose','Rose','light',{void:'#fff6f8',ink:'#f9ecf1',panel:'#fffdfd',raise:'#f0dee7',line:'#ddbdcd',line2:'#b38b9f',fg:'#39232e',dim:'#644452',faint:'#644452',brand:'#914168',cyan:'#7d3d5a',steel:'#7d3d5a',hero:'#592a40'}),
];
export function contrast(a:string,b:string):number {
 const luminance = (hex:string) => {const v=hex.slice(1).match(/../g)!.map(x=>{const c=parseInt(x,16)/255;return c<=.04045?c/12.92:((c+.055)/1.055)**2.4;});return v[0]*.2126+v[1]*.7152+v[2]*.0722;};
 const x=luminance(a),y=luminance(b);return (Math.max(x,y)+.05)/(Math.min(x,y)+.05);
}
export function parseTheme(text:string):ThemeDefinition {
 if (new TextEncoder().encode(text).length>MAX_THEME_BYTES) throw new Error('Theme file exceeds 24 KB.');
 const o=JSON.parse(text);
 if(!o || typeof o!=='object' || Array.isArray(o) || Object.keys(o).some(k=>!['schema','id','name','mode','author','tokens'].includes(k))) throw new Error('Invalid theme fields.');
 if(o.schema!=='osa.theme.v1' || typeof o.id!=='string' || !/^(community:)?[a-z0-9-]{1,48}$/.test(o.id) || typeof o.name!=='string' || !o.name.trim() || o.name.length>64 || !['dark','light'].includes(o.mode) || (o.author!==undefined && (typeof o.author!=='string'||o.author.length>80))) throw new Error('Invalid theme metadata.');
 if(!o.tokens || typeof o.tokens!=='object' || Array.isArray(o.tokens) || Object.keys(o.tokens).length!==TOKEN_KEYS.length || TOKEN_KEYS.some(k=>typeof o.tokens[k]!=='string'||!/^#[0-9a-fA-F]{6}$/.test(o.tokens[k]))) throw new Error('Only the complete set of hex color tokens is accepted.');
 for(const bg of ['void','ink','panel','raise'] as const) for(const fg of ['fg','dim','faint'] as const) if(contrast(o.tokens[bg],o.tokens[fg])<4.5) throw new Error('Text contrast must be at least 4.5:1 on every surface.');
 if(contrast(o.tokens.brand,o.tokens.onbrand)<4.5) throw new Error('Accent text contrast must be at least 4.5:1.');
 return {schema:'osa.theme.v1',id:`community:${o.id.replace(/^community:/,'')}`,name:o.name.trim(),mode:o.mode,...(o.author!==undefined?{author:o.author}:{}),tokens:Object.fromEntries(TOKEN_KEYS.map(k=>[k,o.tokens[k].toLowerCase()])) as Record<Token,string>};
}
export function restoreThemes(text:string|null):{theme:string;communityThemes:ThemeDefinition[]} {
 try {const o=JSON.parse(text??'null');if(!o || !Array.isArray(o.communityThemes) || o.communityThemes.length>MAX_COMMUNITY_THEMES) throw new Error();const themes=o.communityThemes.map((t:unknown)=>parseTheme(JSON.stringify(t)));if(new Set(themes.map((t:ThemeDefinition)=>t.id)).size!==themes.length) throw new Error();return {theme:[...BUILTIN_THEMES,...themes].some(t=>t.id===o.theme)?o.theme:'proof',communityThemes:themes};}catch{return {theme:'proof',communityThemes:[]};}
}
export function themeRgb(hex:string):string {return hex.slice(1).match(/../g)!.map(v=>parseInt(v,16)).join(' ');}

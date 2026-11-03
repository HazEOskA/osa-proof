"use strict";
// Dependency-free contract tests. No browser, network, provider or repository mutations.
const assert = require("node:assert/strict");
const test = require("node:test");
const api = require("../apps/web/docs/agent-ready.js");

class TextNode {
  constructor(value) { this.nodeType = 3; this.nodeValue = value; this.parentElement = null; }
  get textContent() { return this.nodeValue; }
}
class Element {
  constructor(name, attrs = {}, ...nodes) {
    this.nodeType = 1;
    this.tagName = name.toUpperCase();
    this.attrs = { ...attrs };
    this.id = attrs.id || "";
    this.hidden = false;
    this.parentElement = null;
    this.childNodes = [];
    this.events = {};
    this.className = attrs.class || "";
    this.classList = { contains: (cls) => this.className.split(/\s+/).includes(cls) };
    for (const child of nodes) this.appendChild(typeof child === "string" ? new TextNode(child) : child);
  }
  get children() { return this.childNodes.filter((n) => n.nodeType === 1); }
  get firstChild() { return this.childNodes[0] || null; }
  get textContent() { return this.childNodes.map((n) => n.textContent).join(""); }
  set textContent(value) { this.childNodes = []; this.appendChild(new TextNode(value)); }
  getAttribute(name) { return this.attrs[name] ?? null; }
  setAttribute(name, value) { this.attrs[name] = String(value); if (name === "id") this.id = String(value); }
  hasAttribute(name) { return Object.prototype.hasOwnProperty.call(this.attrs, name); }
  appendChild(child) { if (child) { this.childNodes.push(child); child.parentElement = this; } return child; }
  insertBefore(child, next) {
    const i = this.childNodes.indexOf(next);
    if (i < 0) return this.appendChild(child);
    this.childNodes.splice(i, 0, child);
    child.parentElement = this;
    return child;
  }
  remove() { if(this.parentElement) this.parentElement.childNodes = this.parentElement.childNodes.filter((c)=>c!==this); }
  addEventListener(name, fn) { this.events[name] = fn; }
  click() { this.events.click?.({ currentTarget: this }); }
  closest(selector) { for (let n = this; n; n = n.parentElement) if (matches(n,selector)) return n; return null; }
  querySelectorAll(selector) {
    const results=[];
    function descend(n) { for (const c of n.children) { if(matches(c,selector)) results.push(c); descend(c); } }
    descend(this);
    return results;
  }
  querySelector(selector) { return this.querySelectorAll(selector)[0] || null; }
  showModal() { this.open = true; }
  close() { this.open = false; }
  focus() { this.focused = true; }
  select() { this.selected = true; }
}
function matches(n, selector) {
  if (!n || n.nodeType !== 1) return false;
  return selector.split(",").some((x)=>{
    x=x.trim();
    if (x === "main section[id]") return n.tagName === "SECTION" && n.hasAttribute("id") && n.closest("main") !== null;
    if (x === "section[id]") return n.tagName === "SECTION" && n.hasAttribute("id");
    if (x === 'meta[name="osa-docs-build-sha"]') return n.tagName === "META" && n.getAttribute("name") === "osa-docs-build-sha";
    if (x === "[id]") return n.hasAttribute("id");
    if(x.startsWith(".")) return n.classList.contains(x.slice(1));
    return x.toUpperCase() === n.tagName;
  });
}
function el(name, attrs, ...children) { return new Element(name, attrs, ...children); }
const source = { location: { origin:"https://osa-proof-three.vercel.app", pathname:"/docs" } };
function fixture(withSha = false) {
  const quick = el("section", {id:"quickstart"},
    el("h2", {}, "Quickstart"),
    el("p",{},"Instalacja ", el("strong",{},"bez klucza"),". Zobacz ",el("a",{href:"#api"},"HTTP API"),"."),
    el("ol", {class:"steps"},
      el("li",{},el("div",{class:"t"},"Instalacja"),el("div",{class:"d"},"Uruchom lokalnie"),
        el("div",{class:"code"},el("div",{class:"bar"},el("span",{class:"file"},"shell"),el("button",{class:"copy"},"Copy")),el("pre",{},"git clone https://github.com/HazEOskA/osa-proof.git\ncd osa-proof\nnpm ci"))),
      el("li",{},"Następnie użyj ",el("code",{},"npm test")," bez dodatkowego dostępu.")),
    el("p",{}, "Poniższe teksty pozostają źródłem danych: ",el("code",{},"token <secret>")," (przykład, nie sekret)."));
  const api = el("section",{id:"api"},el("h2",{},"HTTP API"),
    el("p",{}, "Tabela generowana z manifestu. Liczba tras: ",el("span",{"data-api-route-count":""},"2"),"."),
    el("table",{},el("thead",{},el("tr",{},el("th",{},"Method"),el("th",{},"Path"),el("th",{},"Auth"))),
      el("tbody",{},el("tr",{},el("td",{},"GET"),el("td",{},"/teams/:id?version="),el("td",{},"session")),
        el("tr",{},el("td",{},"POST"),el("td",{},"/missions"),el("td",{},"session")))),
    el("div",{class:"code"},el("div",{class:"bar"},el("span",{class:"file"},"json"),el("button",{class:"copy"},"Copy")),el("pre",{},'{"message":"zażółć gęślą jaźń"}')));
  const page = el("button",{id:"copypage",class:"copypage"},"Copy page");
  const top = el("div",{class:"pagebar"},page);
  const main = el("main",{},top,quick,api);
  const body = el("body",{},main);
  const root = el("html",{},...(withSha?[el("meta",{name:"osa-docs-build-sha",content:"a".repeat(40)})]:[]),body);
  const doc = {
    root,
    body,
    getElementById(id) { const scan = (n) => n.id === id ? n : (n.children || []).map(scan).find(Boolean); return scan(root) || null; },
    querySelectorAll(selector) {return root.querySelectorAll(selector);},
    querySelector(selector) {return root.querySelector(selector);},
    createElement(name) {return el(name,{});}
  };
  return {doc,quick,api,page};
}

test("COPY-01: pełny Markdown — nagłówki, linki, listy, bash/json, tabela i oryginalne polskie znaki", () => {
  const out = api.exportMarkdown(fixture().doc, source);
  assert.match(out, /# OSA Framework — dokumentacja dla agentów AI/);
  assert.match(out, /## Quickstart/);
  assert.match(out, /\[HTTP API\]\(https:\/\/osa-proof-three\.vercel\.app\/docs#api\)/);
  assert.match(out, /```bash[\s\S]*git clone https:\/\/github\.com\/HazEOskA\/osa-proof\.git[\s\S]*cd osa-proof[\s\S]*npm ci[\s\S]*```/);
  assert.match(out, /2\. Następnie użyj `npm test` bez dodatkowego dostępu\./);
  assert.match(out, /\| Method \| Path \| Auth \|/);
  assert.match(out, /\| POST \| \/missions \| session \|/);
  assert.match(out, /```json\n\{"message":"zażółć gęślą jaźń"\}\n```/);
  assert.doesNotMatch(out, /\nCopy page\n|\nCopy\n/);
  assert.equal(out.includes("Wersja dokumentacji (build SHA): UNKNOWN"),true);
});

test("COPY-02/04: sekcja Quickstart bez HTTP API, z absolutnym odnośnikiem", () => {
  const out = api.exportMarkdown(fixture().doc, source, "quickstart");
  assert.match(out, /SEKCJA: quickstart/);
  assert.match(out, /Źródło: https:\/\/osa-proof-three\.vercel\.app\/docs#quickstart/);
  assert.match(out, /## Quickstart/);
  assert.match(out, /git clone/);
  assert.doesNotMatch(out, /\| Method \|/);
  assert.throws(() => api.exportMarkdown(fixture().doc,source,"not-found"), /DOCS_SECTION_NOT_FOUND/);
});

test("COPY-05: zawartość API pochodzi z tabeli, a nie zaszytej wartości 87", () => {
  const out=api.exportMarkdown(fixture().doc,source,"api");
  assert.match(out, /Liczba tras: 2/);
  assert.match(out,/\| GET \| \/teams\/:id\?version= \| session \|/);
  assert.doesNotMatch(out,/87 par/);
});

test("COPY-06: SHA tylko z jawnej metadanej builda; bez niej UNKNOWN", () => {
  assert.match(api.exportMarkdown(fixture(true).doc,source),/build SHA\): a{40}/);
  assert.match(api.exportMarkdown(fixture().doc,source),/build SHA\): UNKNOWN/);
});

test("COPY-07: nie potwierdza skopiowania przy odrzuceniu schowka lub jego braku", async () => {
  let copied=0, fallback=0;
  const yes=()=>{copied++;return true;}, no=()=>{fallback++;return false;};
  assert.equal(await api.copyWithResult("A",{writeText:()=>Promise.resolve()},yes,no),true);
  assert.equal(await api.copyWithResult("B",{writeText:()=>Promise.reject(new Error("denied"))},yes,no),false);
  assert.equal(await api.copyWithResult("C",null,yes,no),false);
  assert.equal(copied,1); assert.equal(fallback,2);
});

test("COPY-08: dużych danych nie obcina", () => {
  const {doc,quick}=fixture();
  const big="X".repeat(500_000);
  quick.appendChild(el("p",{},big));
  const out=api.exportMarkdown(doc,source,"quickstart");
  assert.equal(out.includes(big),true);
});

test("COPY-09: Copy page i dynamiczne Copy section z aria-label/role=status", async () => {
  const {doc,page,quick,api:apiSection}=fixture();
  const calls=[];
  const env={...source, setTimeout(fn){ fn(); }, navigator:{clipboard:{writeText(value){calls.push(value); return Promise.resolve();}}}};
  api.install(doc,env);
  api.install(doc,env);
  assert.ok(page.events.click);
  assert.equal(quick.children.filter(n=>n.classList.contains("agent-copy-section")).length,1);
  assert.equal(apiSection.children.filter(n=>n.classList.contains("agent-copy-section")).length,1);
  const copyQuick=quick.children.find(n=>n.classList.contains("agent-copy-section"));
  assert.match(copyQuick.getAttribute("aria-label"),/Kopiuj sekcję: Quickstart/);
  page.click();
  await Promise.resolve();
  assert.equal(calls.length,1);
  assert.match(calls[0],/## HTTP API/);
  copyQuick.click();
  await Promise.resolve();
  assert.equal(calls.length,2);
  assert.doesNotMatch(calls[1],/\| Method \|/);
  assert.equal(doc.getElementById("agent-copy-status").getAttribute("aria-live"),"polite");
});

test("COPY-10: exporter nie odczytuje localStorage/cookies i nie żąda sieci", () => {
  const {doc}=fixture();
  const restricted={...source, get localStorage(){throw new Error("PRIVATE");}, get document(){throw new Error("PRIVATE");} };
  assert.match(api.exportMarkdown(doc,restricted),/## HTTP API/);
});

test("COPY-11: przygotowany portal wyłącza stary płaski handler, zachowuje kopiowanie code", () => {
  const fs=require("node:fs"),path=require("node:path");
  const htmlPath=path.join(__dirname,"..","apps","web","docs","index.html");
  assert.ok(fs.existsSync(htmlPath), "Brakuje testowanego pliku HTML portalu");
  const html=fs.readFileSync(htmlPath,"utf8");
  assert.match(html,/<script src="\/docs\/agent-ready\.js" defer><\/script>/);
  assert.doesNotMatch(html,/copyText\(m\.innerText, m, cp\)/);
  assert.match(html,/pre\.innerText, pre, btn/);
  assert.match(html,/data-api-route-count/);
});


test("COPY-07b: odmowa schowka udostępnia cały Markdown w dialogu, bez fałszywego sukcesu", async () => {
  const {doc,page}=fixture();
  const env={...source, setTimeout(fn){fn();}, navigator:{clipboard:{writeText(){return Promise.reject(new Error("denied"));}}}};
  api.install(doc,env);
  page.click();
  await Promise.resolve(); await Promise.resolve();
  const dialog=doc.body.querySelector("dialog");
  assert.ok(dialog && dialog.open);
  const area=dialog.querySelector("textarea");
  assert.ok(area.selected && area.focused);
  assert.match(area.value,/## HTTP API/);
  assert.match(doc.getElementById("agent-copy-status").textContent,/Nie skopiowano automatycznie/);
});

test("COPY-01b: znaczniki statusu PLANNED pozostają dokumentacją, a nie poleceniem", () => {
  const {doc,quick}=fixture();
  quick.appendChild(el("a",{href:"#not-available","data-nolink":""}, "Feature PLANNED"));
  const out=api.exportMarkdown(doc,source,"quickstart");
  assert.match(out,/Feature PLANNED/);
  assert.doesNotMatch(out,/\[Feature PLANNED\]/);
});

// Dependency-free DOM reconstruction from the ACTUAL apps/web/docs/index.html.
// Parsing only <main> keeps this harness deterministic: production JS/CSS/SVG are never executed.
function decodeHtml(value) {
  const entities = {amp:"&",lt:"<",gt:">",quot:'"',apos:"'",nbsp:" ",mdash:"—",ndash:"–",hellip:"…",middot:"·",rarr:"→",larr:"←",bull:"•"};
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (full,key) => {
    if(key.startsWith("#")) {
      const hex=key[1].toLowerCase()==="x";
      const cp=Number.parseInt(key.slice(hex?2:1),hex?16:10);
      return Number.isInteger(cp)&&cp>=0&&cp<=0x10ffff?String.fromCodePoint(cp):full;
    }
    return Object.prototype.hasOwnProperty.call(entities,key.toLowerCase())?entities[key.toLowerCase()]:full;
  });
}
function actualDocsDocument(html) {
  const mainText = html.match(/<main\b[^>]*>[\s\S]*?<\/main>/i)?.[0];
  assert.ok(mainText, "Realny portal musi zawierać główną treść <main>");
  const tokens = mainText.match(/<!--[\s\S]*?-->|<\/?[A-Za-z][^>]*>|[^<]+/g) || [];
  const voidTags = new Set(["BR","HR","IMG","INPUT","META","LINK","WBR","SOURCE","AREA"]);
  const stack=[];
  let main=null;
  for(const token of tokens) {
    if(token.startsWith("<!--")) continue;
    if(token.startsWith("</")) {
      const name=token.match(/^<\/([A-Za-z][\w-]*)/)?.[1]?.toUpperCase();
      while(stack.length) if(stack.pop().tagName===name) break;
      continue;
    }
    if(token.startsWith("<")) {
      const name=token.match(/^<([A-Za-z][\w:-]*)/)?.[1];
      if(!name) continue;
      const attrs={};
      const body=token.slice(1+name.length).replace(/\/?>(?:\s*)$/,'');
      const attr=/([^\s=/>]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;
      for(const m of body.matchAll(attr)) attrs[m[1]]=decodeHtml(m[2]??m[3]??m[4]??"");
      const elem=new Element(name,attrs);
      if(stack.length)stack[stack.length-1].appendChild(elem);
      else if(!main)main=elem;
      if(!token.endsWith("/>")&&!voidTags.has(elem.tagName))stack.push(elem);
      continue;
    }
    if(stack.length)stack[stack.length-1].appendChild(new TextNode(decodeHtml(token)));
  }
  assert.equal(main?.tagName,"MAIN");
  assert.equal(stack.length,0,"Niepoprawnie zagnieżdżone tagi w <main> portalu");
  const body=el("body",{},main),root=el("html",{},body);
  return {
    body, root,
    getElementById(id) { const scan=(n)=>n.id===id?n:(n.children||[]).map(scan).find(Boolean);return scan(root)||null; },
    querySelectorAll(selector) {return root.querySelectorAll(selector);},
    querySelector(selector) {return root.querySelector(selector);},
    createElement(name) {return el(name,{});}
  };
}
function realPortal() {
  const fs=require("node:fs"),path=require("node:path");
  const htmlPath=path.join(__dirname,"..","apps","web","docs","index.html");
  const html=fs.readFileSync(htmlPath,"utf8");
  assert.ok(html.length>50000,"Oczekiwano rzeczywistego HTML Docs, a nie testowego stubu");
  return actualDocsDocument(html);
}

test("COPY-12: rzeczywisty HTML Docs — 23 sekcje, 6 kroków pipeline i pełne statusy kart", () => {
  const doc=realPortal();
  assert.equal(api.sectionsInPage(doc).length,23);
  const pipeline=api.exportMarkdown(doc,source,"pipeline");
  assert.match(pipeline,/- \*\*01 · Team Graph\*\* — validated/);
  assert.match(pipeline,/- \*\*06 · Receipt\*\* — sealed/);
  assert.doesNotMatch(pipeline,/01\*\*Team Graph\*\*validated/);
  const layers=api.exportMarkdown(doc,source,"layers");
  assert.match(layers,/\| Warstwa \| Przeznaczenie \| Dostęp \|/);
  assert.match(layers,/\| School \| Academy \| Public \|/);
  assert.match(layers,/\| Dev \| Builder \/ Core \| DEV login \|/);
  assert.match(layers,/\| Bank \| Regulated \| Gated \|/);
  assert.match(layers,/\| Army \| Regulated \| Gated \|/);
  assert.doesNotMatch(layers,/BankRegulatedGated/);
});

test("COPY-13: rzeczywisty HTML Docs — curl/TOKEN/RUN to bash, ProofReceipt to json", () => {
  const doc=realPortal();
  const mission=api.exportMarkdown(doc,source,"first-mission");
  assert.match(mission,/```bash\nTOKEN=\$\(curl/);
  assert.match(mission,/```bash\ncurl -s localhost:3000\/teams/);
  assert.match(mission,/```bash\nRUN=\$\(curl/);
  const receipt=api.exportMarkdown(doc,source,"receipt");
  assert.match(receipt,/```json\n\s*\{/);
  assert.match(receipt,/"proof_id": "proof_/);
  const llm=api.exportMarkdown(doc,source,"llm-gateway");
  assert.match(llm,/```bash\nOSA_EXECUTION_MODE=provider/);
  const mesh=api.exportMarkdown(doc,source,"model-mesh");
  assert.match(mesh,/```bash\nOSA_EXECUTION_MODE=provider/);
});

test("COPY-14: rzeczywisty HTML Docs — karty startu, 87 rekordów API i zakres sekcji", () => {
  const doc=realPortal();
  const start=api.exportMarkdown(doc,source,"start");
  assert.match(start,/#### \[Quickstart\]\(https:\/\/osa-proof-three\.vercel\.app\/docs#quickstart\)/);
  assert.match(start,/Status: 5 minutes/);
  const table=doc.getElementById("api").querySelector("table");
  assert.ok(table,"Realny portal musi zawierać tabelę HTTP API");
  assert.equal(table.querySelectorAll("tr").length,88,"87 tras + nagłówek");
  const apiMd=api.exportMarkdown(doc,source,"api");
  assert.match(apiMd,/\| GET \| `\/build\/status` \| `public` \|/);
  assert.doesNotMatch(apiMd,/Team Graph\*\* — validated/);
  const whole=api.exportMarkdown(doc,source);
  assert.match(whole,/## How a run is proven/);
  assert.match(whole,/\| Bank \| Regulated \| Gated \|/);
  assert.match(whole,/```json\n\s*\{/);
  assert.match(whole,/\| Method \| Path \| Auth \| Returns \|/);
});

test("COPY-15: regresja rzeczywistych kafli .stage/.layer z portalu OSA Framework", () => {
  const stage=(id,title,state)=>el("div",{class:"stage",role:"listitem"},el("span",{class:"label n"},id),el("b",{},title),el("span",{},state));
  const layer=(title,purpose,gate)=>el("div",{class:"layer"},el("b",{},title),el("span",{},purpose),el("span",{class:"st"},el("span",{class:"dot"}),gate));
  const pipeline=el("section",{id:"pipeline"},el("h2",{},"How a run is proven"),el("div",{class:"pipe",role:"list"},stage("01","Team Graph","validated"),stage("06","Receipt","sealed")));
  const layers=el("section",{id:"layers"},el("h2",{},"Layers"),el("div",{class:"layers"},layer("School","Academy","Public"),layer("Bank","Regulated","Gated")));
  const docRoot=el("html",{},el("body",{},el("main",{},pipeline,layers)));
  const doc={querySelectorAll:(q)=>docRoot.querySelectorAll(q),querySelector:(q)=>docRoot.querySelector(q)};
  assert.match(api.exportMarkdown(doc,source,"pipeline"),/- \*\*01 · Team Graph\*\* — validated/);
  assert.match(api.exportMarkdown(doc,source,"layers"),/\| Bank \| Regulated \| Gated \|/);
});

test("COPY-16: etykieta POST jest komendą bash, GET receipt jest json", () => {
  const code=(label,body)=>el("div",{class:"code"},el("div",{class:"bar"},el("span",{class:"file"},label),el("button",{class:"copy"},"Copy")),el("pre",{},body));
  const mission=el("section",{id:"first-mission"},el("h2",{},"Your first mission"),code("POST /teams",'curl -s localhost:3000/teams -d \'{"team_id":"team_dev"}\''));
  const receipt=el("section",{id:"receipt"},el("h2",{},"Proof receipt"),code("GET /runs/:id/proof",'{\n  "verdict": "VERIFIED"\n}'));
  const root=el("html",{},el("body",{},el("main",{},mission,receipt)));
  const doc={querySelectorAll:q=>root.querySelectorAll(q),querySelector:q=>root.querySelector(q)};
  assert.match(api.exportMarkdown(doc,source,"first-mission"),/```bash\ncurl -s/);
  assert.match(api.exportMarkdown(doc,source,"receipt"),/```json\n\{/);
});

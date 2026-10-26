"use strict";
const assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {spawn}=require('node:child_process'),{chromium}=require('playwright');
const out=path.resolve('artifacts/chat-delivery');fs.mkdirSync(out,{recursive:true});
const base=process.env.OSA_DELIVERY_E2E_URL||'http://127.0.0.1:3198';
const child=process.env.OSA_DELIVERY_E2E_URL?undefined:spawn(process.execPath,['scripts/chat-delivery-e2e-server.cjs'],{stdio:'ignore'});
(async()=>{
  for(let i=0;i<60;i++){try{if((await fetch(base)).ok)break;}catch{}if(i===59)throw Error('SERVER_NOT_READY');await new Promise(r=>setTimeout(r,250));}
  const browser=await chromium.launch({headless:true,...(process.env.OSA_CHROMIUM_EXECUTABLE?{executablePath:process.env.OSA_CHROMIUM_EXECUTABLE}:{}),args:['--no-sandbox']});
  try{for(const [name,width,height] of [['android',390,844],['desktop',1440,1000]]){
    const page=await browser.newPage({viewport:{width,height}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.goto(base);await page.locator('section[aria-label="Uruchamianie"]').getByRole('button',{name:'Czat floty agentów',exact:true}).click();
    await page.getByRole('button',{name:'Utwórz artefakt',exact:true}).click();
    await page.getByTestId('osa-composer').fill('Zbuduj po polsku mały licznik z przyciskiem Dodaj i widocznym wynikiem. Bez sieci i bibliotek.');
    await page.getByTestId('osa-send').click();
    await page.getByRole('region',{name:'Przebieg agentów na żywo'}).waitFor();
    const result=page.getByTestId('osa-delivery-result');await result.waitFor({timeout:90000});
    await result.getByText('ARTEFAKT GOTOWY · integralność zweryfikowana',{exact:true}).waitFor();
    const files={};for(const label of ['Pobierz artefakt','Pobierz bundle','Pobierz evidence','Pobierz trace','Pobierz ProofReceipt','Pobierz replay offline']){
      const pending=page.waitForEvent('download');await result.getByRole('button',{name:label,exact:true}).click();const dl=await pending;const file=path.join(out,name+'-'+dl.suggestedFilename());await dl.saveAs(file);files[label]=file;
    }
    const bundle=JSON.parse(fs.readFileSync(files['Pobierz bundle'],'utf8'));
    const bytes=fs.readFileSync(files['Pobierz artefakt']);assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),bundle.artifact.sha256);
    assert.equal(bundle.run.verdict,'VERIFIED');assert.equal(JSON.parse(fs.readFileSync(files['Pobierz ProofReceipt'],'utf8')).proof_id,bundle.run.proof.proof_id);
    assert.deepEqual(JSON.parse(fs.readFileSync(files['Pobierz evidence'],'utf8')),bundle.run.evidence);
    assert.equal(fs.readFileSync(files['Pobierz trace'],'utf8').trim().split('\n').length,bundle.record.timeline.length);
    await result.getByRole('button',{name:'Podgląd artefaktu',exact:true}).click();
    const frame=page.frameLocator('iframe[title="Odizolowany artefakt z czatu"]');await frame.getByRole('button',{name:'Dodaj',exact:true}).click();await frame.locator('#value').filter({hasText:'1'}).waitFor();
    assert.equal(await frame.locator('body').evaluate(()=>{try{return !!parent.document.body;}catch{return false;}}),false);
    assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1));
    await page.screenshot({path:path.join(out,name+'-artifact.png'),fullPage:true});
    await result.getByRole('button',{name:'Replay wykonania',exact:true}).click();await page.getByRole('slider',{name:'Pozycja odtwarzania'}).waitFor();
    await page.screenshot({path:path.join(out,name+'-replay.png'),fullPage:true});
    const offline=await browser.newPage();await offline.goto('file://'+files['Pobierz replay offline']);await offline.getByText(/Integralność pakietu: PASS/).waitFor();await offline.close();
    await page.reload();await page.locator('section[aria-label="Uruchamianie"]').getByRole('button',{name:'Czat floty agentów',exact:true}).click();await page.getByTestId('osa-delivery-result').getByText('ARTEFAKT GOTOWY · integralność zweryfikowana',{exact:true}).waitFor();
    assert.deepEqual(errors,[]);console.log(JSON.stringify({name,result:'PASS',execution_id:bundle.execution_id,downloads:6,agent_starts:bundle.run.events.filter(e=>e.type==='AGENT_STARTED').length,provider:process.env.OSA_DELIVERY_E2E_URL?'LIVE_SERVER':'CONTROLLED_TEST_GENERATOR',offline_replay:true,artifact_interaction:true}));await page.close();
  }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;}).finally(()=>child?.kill('SIGTERM'));

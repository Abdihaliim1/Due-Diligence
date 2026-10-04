const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const {JSDOM}=require('jsdom');
const {IDBFactory}=require('fake-indexeddb');
const {webcrypto}=require('node:crypto');
const core=require('../dd-core');
const backup=require('../dd-backup');
async function until(check){ const end=Date.now()+5000; while(Date.now()<end){if(await check())return;await new Promise(r=>setTimeout(r,10));}throw new Error('Timed out'); }
async function setup(){
  const dom=new JSDOM(fs.readFileSync('index.html','utf8'),{url:'https://synthetic-test.invalid/',runScripts:'outside-only'}),w=dom.window;
  w.indexedDB=new IDBFactory();w.structuredClone=structuredClone;w.DDCore=core;w.DDBackup=backup;
  w.TextEncoder=TextEncoder;w.TextDecoder=TextDecoder;Object.defineProperty(w,'crypto',{value:webcrypto});
  const errors=[];w.alert=msg=>errors.push(msg);w.console.error=(...x)=>errors.push(x.join(' '));
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');this.dispatchEvent(new w.Event('close'));};
  w.eval(fs.readFileSync('app.js','utf8'));
  await until(()=>w.document.querySelector('#healthVer').textContent==='2');
  const db=await new Promise((res,rej)=>{const r=w.indexedDB.open('asal_dd_db',2);r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const all=store=>new Promise((res,rej)=>{const r=db.transaction(store).objectStore(store).getAll();r.onsuccess=()=>res(r.result);r.onerror=()=>rej(r.error);});
  const $=selector=>w.document.querySelector(selector);
  const change=(selector,value)=>{const e=$(selector);if(e.type==='checkbox')e.checked=value;else e.value=value;e.dispatchEvent(new w.Event('input',{bubbles:true}));e.dispatchEvent(new w.Event('change',{bubbles:true}));};
  return {dom,w,db,all,$,change,errors,close:async()=>{await new Promise(r=>setTimeout(r,50));db.close();dom.window.close();}};
}
test('actual app saves DDQ-only and checkbox-only changes and flushes close',async()=>{
  const t=await setup();try{
    t.$('#btnNew').click();t.change('#f_name','Synthetic Autosave');t.change('#f_phone','555-0100');t.change('#f_filing','Single');t.$('#btnSave').click();
    await until(()=>t.$('[data-open]') && !t.$('#modal').classList.contains('show'));
    t.$('[data-open]').click();await until(()=>t.$('#modal').classList.contains('show'));
    t.change('#credit_eitc',true);t.change('#d_int_income','W-2 received from synthetic employer');t.change('#doc_photo_id',true);t.change('#form_3','Yes');
    await until(async()=>{const c=(await t.all('clients'))[0];return c.credits_claimed.eitc && c.documents.identity.photo_id && c.ddq.form8867?.['3']==='Yes';});
    assert.equal((await t.all('clients'))[0].ddq.interview.how_income_received,'W-2 received from synthetic employer');
    t.change('#form_information_source','Synthetic client by phone');t.$('#btnClose').click();
    await until(()=>!t.$('#modal').classList.contains('show'));
    assert.equal((await t.all('clients'))[0].ddq.form8867.information_source,'Synthetic client by phone');assert.deepEqual(t.errors,[]);
  }finally{await t.close();}
});
test('conditional sections, document counts, and draft print use current answers',async()=>{
  const t=await setup();try{
    t.$('#btnNew').click();assert.equal(t.$('#ddq_aotc_section').style.display,'none');assert.equal(t.$('#doc_birth_cert').closest('.doc-category').style.display,'none');
    t.change('#i_self','Yes');assert.equal(t.$('#doc_w2_forms').closest('.doc-item').style.display,'none');assert.equal(t.$('#requiredCount').textContent,'1');
    t.change('#f_filing','Head of Household');assert.equal(t.$('#ddq_hoh_section').style.display,'');assert.equal(t.$('#hoh_docs_section').style.display,'');
    t.change('#credit_odc',true);assert.equal(t.$('#ddq_ctc_section').style.display,'');
    t.change('#f_name','Synthetic Unsaved Preview');t.$('[data-mtab="print"]').click();
    assert.match(t.$('#packetPreview').textContent,/Synthetic Unsaved Preview/);assert.match(t.$('#packetPreview').textContent,/DRAFT — REVIEW REQUIRED/);assert.doesNotMatch(t.$('#packetPreview').textContent,/Form 8867 Compliant/);assert.match(t.$('#packetPreview').textContent,/latest applicable date/);assert.deepEqual(t.errors,[]);
  }finally{await t.close();}
});
test('legacy backup preview does not mutate data; explicit restore is atomic and keeps conflicts',async()=>{
  const t=await setup();try{
    const p={meta:{app:'asal-dd',version:2},settings:{officeHeader:'Synthetic backup header'},clients:[{id:'c_restore',name:'Synthetic Restore',filing_status:'Single',income:{},ddq:{docs:'Legacy notes'},dependents:[]}],files:[]};
    const input=t.$('#importFile');Object.defineProperty(input,'files',{value:[{size:500,text:async()=>JSON.stringify(p)}],configurable:true});input.dispatchEvent(new t.w.Event('change'));
    await until(()=>t.$('#restoreDialog').hasAttribute('open'));assert.equal((await t.all('clients')).length,0);assert.match(t.$('#restoreSummary').textContent,/1 clients/);
    t.$('#confirmRestore').click();await until(async()=>(await t.all('clients')).length===1);await until(()=>!t.$('#restoreDialog').hasAttribute('open'));
    input.dispatchEvent(new t.w.Event('change'));await until(()=>t.$('#restoreDialog').hasAttribute('open'));assert.match(t.$('#restoreSummary').textContent,/1 existing clients will be kept/);
    t.$('#confirmRestore').click();await until(()=>!t.$('#restoreDialog').hasAttribute('open'));assert.equal((await t.all('clients')).length,1);assert.equal((await t.all('clients'))[0].ddq.docs,'Legacy notes');assert.deepEqual(t.errors,[]);
  }finally{await t.close();}
});

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const core = require('../dd-core');
const backup = require('../dd-backup');
const client = () => ({id:'c_test',name:'Synthetic Test',phone:'555-0100',filing_status:'Single',tax_year:2025,income:{self_employed:'No'},dependents:[],credits_claimed:{eitc:true},ddq:{docs:'Synthetic W-2 reviewed',eitc_qualifying_child:'No',preparer_certification_date:'2026-10-04',form8867:{benefits_reviewed:'Yes',prior_disallowance:'No',information_source:'Test client, in-person',interview_date:'2026-10-04',ssn_review:'Yes'}}});
function completeClient(){ const c=client(); for(const q of core.applicableQuestions(c)) c.ddq.form8867[q.id]=q.id==='4'?'No':'Yes'; c.ddq.form8867['8']='N/A';c.ddq.form8867['9b']='N/A';c.ddq.form8867['9c']='N/A';return c; }
const payload = () => ({meta:{app:'asal-dd',version:2,exportedAt:1},settings:{officeHeader:'Test Office'},clients:[client()],files:[{id:'f_test',clientId:'c_test',name:'synthetic.txt',type:'text/plain',size:8,blobBase64:Buffer.from('evidence').toString('base64'),createdAt:1}]});
test('only applicable document categories and suggestions are used',()=>{
  const c=client();assert.equal(core.categoryApplies(c,'dependents'),false);assert.equal(core.categoryApplies(c,'hoh'),false);
  c.filing_status='Head of Household';assert.equal(core.categoryApplies(c,'hoh'),true);
  c.income.self_employed='Yes';assert.equal(core.documentApplies(c,'income','w2_forms'),false);assert.equal(core.documentSuggested(c,'self_emp_records'),true);
  c.income.w2_employer='Test employer';assert.equal(core.documentApplies(c,'income','w2_forms'),true);assert.equal(core.documentSuggested(c,'w2_forms'),true);
});
test('legacy affirmations never auto-complete the new official checklist',()=>{
  const c=client();c.ddq.knowledge_requirement_met='Yes';c.ddq.preparer_satisfied_requirements='Yes';assert(core.reviewIssues(c).some(x=>x.includes('line 3')));
  assert.match(core.questions.find(q=>q.id==='3').text,/knowledge/);assert.match(core.questions.find(q=>q.id==='5').text,/retention/);
});
test('complete checklist passes; incomplete and unresolved answers stay in draft',()=>{
  const c=completeClient();assert.deepEqual(core.reviewIssues(c),[]);
  c.ddq.form8867['4']='Yes';assert(core.reviewIssues(c).some(x=>x.includes('resolution')));
  c.ddq.form8867['4a']='Yes';c.ddq.form8867['4b']='Yes';c.ddq.form8867.inquiry_notes='Question, taxpayer response, date.';c.ddq.form8867.resolution_notes='Reviewed and resolved.';
  assert.deepEqual(core.reviewIssues(c),[]);c.ddq.form8867['15']='No';assert(core.reviewIssues(c).some(x=>x.includes('line 15')));
});
test('N/A cannot bypass positive answers and recertification exceptions need notes',()=>{
  const c=completeClient();c.ddq.form8867['3']='N/A';assert(core.reviewIssues(c).some(x=>x.includes('N/A')));
  c.ddq.form8867['3']='Yes';c.ddq.form8867.prior_disallowance='Yes';c.ddq.form8867['7a']='N/A';assert(core.reviewIssues(c).some(x=>x.includes('Explain why line 7a')));
});
test('age calculation uses date components, not local-time parsing',()=>{
  assert.equal(core.ageAtYearEnd('2001-01-01'),24);assert.equal(core.ageAtYearEnd('1960-12-31'),65);assert.equal(core.ageAtYearEnd('2009-12-31'),16);assert.equal(core.ageAtYearEnd('2025-02-30'),null);
});
test('encrypted full backups round-trip every byte, reject wrong passwords and tampering',async()=>{
  const p=payload();p.clients[0].name='Synthetic عربي Soomaali';const e=await backup.encrypt(p,'synthetic-test-password');
  assert(!JSON.stringify(e).includes('Synthetic'));assert.deepEqual(await backup.decrypt(e,'synthetic-test-password'),p);
  await assert.rejects(backup.decrypt(e,'incorrect-password'));
  const changed={...e,ciphertext:(e.ciphertext[0]==='A'?'B':'A')+e.ciphertext.slice(1)};await assert.rejects(backup.decrypt(changed,'synthetic-test-password'));
});
test('restore preserves existing clients; copied clients keep attachment links',()=>{
  const p=payload(),before=structuredClone(p);
  const kept=backup.planRestore(p,p.clients,p.files,'keep');assert.equal(kept.clients.length,0);assert.equal(kept.files.length,0);assert.equal(kept.skipped,1);
  const copied=backup.planRestore(p,p.clients,p.files,'copies');assert.notEqual(copied.clients[0].id,p.clients[0].id);assert.equal(copied.files[0].clientId,copied.clients[0].id);assert.notEqual(copied.files[0].id,p.files[0].id);assert.deepEqual(p,before);
});
test('legacy fixture remains readable and malformed backups fail before import',()=>{
  const legacy=JSON.parse(fs.readFileSync('mock-data-backup.json','utf8'));assert.doesNotThrow(()=>backup.validate(legacy));
  const p=payload();p.files[0].size=999;assert.throws(()=>backup.validate(p),/size/);
  const unsafe=JSON.parse('{"meta":{"app":"asal-dd","version":2},"clients":[],"files":[],"__proto__":{"polluted":true}}');assert.throws(()=>backup.validate(unsafe),/Unsafe/);
  const duplicate=payload();duplicate.clients.push(structuredClone(duplicate.clients[0]));assert.throws(()=>backup.validate(duplicate),/duplicate/);
});

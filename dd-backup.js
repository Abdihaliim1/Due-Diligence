/* Portable, authenticated backups. Passwords are never stored. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.DDBackup = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function() {
  'use strict';
  const FORMAT = 'asal-dd-encrypted', ITERATIONS = 600000;
  const idOK = v => typeof v === 'string' && /^[A-Za-z0-9_.:-]{1,128}$/.test(v);
  const object = v => !!v && typeof v === 'object' && !Array.isArray(v);
  function safeKeys(value, depth=0) {
    if (depth > 40) throw new Error('Backup nesting is too deep.');
    if (!value || typeof value !== 'object') return;
    for (const [key,v] of Object.entries(value)) {
      if (['__proto__','prototype','constructor'].includes(key)) throw new Error('Unsafe property in backup.');
      safeKeys(v,depth+1);
    }
  }
  function validate(data) {
    safeKeys(data);
    if (!object(data) || data.meta?.app !== 'asal-dd' || ![1,2].includes(data.meta.version) || !Array.isArray(data.clients) || !Array.isArray(data.files)) throw new Error('Not a supported ASAL backup.');
    if (data.clients.length > 50000 || data.files.length > 100000) throw new Error('Backup has too many records.');
    const clientIds = new Set(), fileIds = new Set();
    for (const c of data.clients) {
      if (!object(c) || !idOK(c.id) || clientIds.has(c.id)) throw new Error('Invalid or duplicate client ID.');
      clientIds.add(c.id);
      for (const key of ['name','phone','email','ssn_last4','ssn_valid_for_employment','filing_status','dob','address','notes']) {
        if (c[key] !== undefined && typeof c[key] !== 'string') throw new Error('Invalid client field: ' + key);
      }
      for (const key of ['ddq','income','documents','credits_claimed']) {
        if (c[key] !== undefined && !object(c[key])) throw new Error('Invalid client section: ' + key);
      }
      if (c.dependents !== undefined && (!Array.isArray(c.dependents) || c.dependents.some(d => !object(d)))) throw new Error('Invalid dependent records.');
      if (c.history !== undefined && !Array.isArray(c.history)) throw new Error('Invalid change history.');
      for (const key of ['docs','preparer_notes','preparer_certification_date']) {
        if (c.ddq?.[key] !== undefined && typeof c.ddq[key] !== 'string') throw new Error('Invalid interview text.');
      }
      if (c.ddq?.form8867 !== undefined && (!object(c.ddq.form8867) || Object.values(c.ddq.form8867).some(v=>typeof v !== 'string'))) throw new Error('Invalid Form 8867 answers.');
      if (c.ddq?.interview !== undefined && (!object(c.ddq.interview) || Object.values(c.ddq.interview).some(v=>typeof v !== 'string'))) throw new Error('Invalid interview answers.');
      if (c.history?.some(h=>!object(h) || !Array.isArray(h.fields) || h.fields.some(v=>typeof v !== 'string'))) throw new Error('Invalid change history entry.');
      if (c.documents && Object.values(c.documents).some(v=>!object(v) || Object.values(v).some(x=>![true,false,'Yes','No',''].includes(x)))) throw new Error('Invalid document verification data.');
    }
    for (const f of data.files) {
      if (!object(f) || !idOK(f.id) || fileIds.has(f.id) || !clientIds.has(f.clientId)) throw new Error('Invalid, duplicate, or unlinked attachment.');
      fileIds.add(f.id);
      if (typeof f.name !== 'string' || typeof f.blobBase64 !== 'string' || (!/^[A-Za-z0-9+/]*={0,2}$/.test(f.blobBase64) || f.blobBase64.length % 4 !== 0)) throw new Error('Invalid attachment data.');
      if (f.type !== undefined && typeof f.type !== 'string') throw new Error('Invalid attachment type.');
      const bytes = f.blobBase64.length * 3 / 4 - (f.blobBase64.endsWith('==') ? 2 : f.blobBase64.endsWith('=') ? 1 : 0);
      if (f.size !== undefined && f.size !== bytes) throw new Error('Attachment size does not match: ' + f.name);
    }
    if (data.settings?.officeHeader !== undefined && typeof data.settings.officeHeader !== 'string') throw new Error('Invalid office header.');
    return data;
  }
  function toB64(bytes) {
    let binary = '';
    for (let i=0;i<bytes.length;i+=32768) binary += String.fromCharCode(...bytes.subarray(i,i+32768));
    return btoa(binary);
  }
  function fromB64(str) {
    return Uint8Array.from(atob(str), x => x.charCodeAt(0));
  }
  async function keyFor(password, salt, usage) {
    if (!globalThis.crypto?.subtle) throw new Error('Encrypted backups require HTTPS or localhost in a modern browser.');
    const material = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveKey']);
    return crypto.subtle.deriveKey({name:'PBKDF2',salt,iterations:ITERATIONS,hash:'SHA-256'}, material, {name:'AES-GCM',length:256}, false, [usage]);
  }
  async function encrypt(data, password) {
    validate(data);
    if (typeof password !== 'string' || password.length < 12) throw new Error('Use a backup password of at least 12 characters.');
    const salt = crypto.getRandomValues(new Uint8Array(16)), iv = crypto.getRandomValues(new Uint8Array(12));
    const key = await keyFor(password,salt,'encrypt');
    const bytes = await crypto.subtle.encrypt({name:'AES-GCM',iv}, key, new TextEncoder().encode(JSON.stringify(data)));
    return {format:FORMAT, version:1, kdf:'PBKDF2-SHA-256', iterations:ITERATIONS, cipher:'AES-256-GCM', salt:toB64(salt), iv:toB64(iv), ciphertext:toB64(new Uint8Array(bytes))};
  }
  async function decrypt(envelope, password) {
    if (envelope.format !== FORMAT || envelope.version !== 1 || envelope.iterations !== ITERATIONS || envelope.cipher !== 'AES-256-GCM' || envelope.kdf !== 'PBKDF2-SHA-256') throw new Error('Unsupported encrypted backup format.');
    try {
      const salt = fromB64(envelope.salt), iv = fromB64(envelope.iv);
      if (salt.length !== 16 || iv.length !== 12) throw new Error('Invalid encryption parameters.');
      const key = await keyFor(password,salt,'decrypt');
      const bytes = await crypto.subtle.decrypt({name:'AES-GCM',iv}, key, fromB64(envelope.ciphertext));
      return validate(JSON.parse(new TextDecoder().decode(bytes)));
    } catch(e) {
      throw new Error('Could not open this backup. Check the password and that the file is complete and unchanged.');
    }
  }
  function planRestore(data, existingClients, existingFiles, mode='keep') {
    validate(data);
    if (!['keep','copies'].includes(mode)) throw new Error('Choose a restore mode.');
    const clientIds = new Set(existingClients.map(c=>c.id)), fileIds = new Set(existingFiles.map(f=>f.id));
    const mapping = new Map(), clients = [], files = [];
    let skipped = 0, copied = 0;
    for (const original of data.clients) {
      const c = structuredClone(original);
      if (clientIds.has(c.id)) {
        if (mode === 'keep') { skipped++; continue; }
        const previousId = c.id;
        do { c.id = 'c_restored_' + crypto.randomUUID(); } while (clientIds.has(c.id));
        c.restoredFromId = previousId;
        c.name = (c.name || 'Unnamed') + ' (restored copy)';
        copied++;
      }
      clientIds.add(c.id); mapping.set(original.id,c.id); clients.push(c);
    }
    for (const original of data.files) {
      if (!mapping.has(original.clientId)) continue;
      const f = {...original,clientId:mapping.get(original.clientId)};
      if (fileIds.has(f.id)) {
        do { f.id = 'f_restored_' + crypto.randomUUID(); } while (fileIds.has(f.id));
      }
      fileIds.add(f.id); files.push(f);
    }
    return {clients,files,skipped,copied};
  }
  return {FORMAT, validate, encrypt, decrypt, planRestore};
});

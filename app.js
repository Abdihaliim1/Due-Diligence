/**
 * ASAL Solutions LTD — Due Diligence App (Offline-first)
 * Local DB: IndexedDB (clients + files)
 * No server required.
 */
(() => {
  const DB_NAME = "asal_dd_db";
  const DB_VER = 1;
  const STORE_CLIENTS = "clients";
  const STORE_FILES = "files";
  const SETTINGS_KEY = "asal_dd_settings_v1";

  const $ = (sel, el=document) => el.querySelector(sel);
  const $$ = (sel, el=document) => Array.from(el.querySelectorAll(sel));
  const fmtDate = (ts) => {
    if(!ts) return "";
    const d = new Date(ts);
    return d.toISOString().slice(0,10);
  };
  const fmtWhen = (ts) => {
    if(!ts) return "";
    const d = new Date(ts);
    return d.toLocaleString();
  };
  const uid = () => "c_" + Date.now() + "_" + Math.random().toString(16).slice(2,8);
  const fid = () => "f_" + Date.now() + "_" + Math.random().toString(16).slice(2,8);

  const toast = (msg) => {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toast._tm);
    toast._tm = setTimeout(()=>t.classList.remove("show"), 2600);
  };

  // ---------- IndexedDB ----------
  function openDB(){
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = () => {
        const db = req.result;
        if(!db.objectStoreNames.contains(STORE_CLIENTS)){
          const s = db.createObjectStore(STORE_CLIENTS, { keyPath: "id" });
          s.createIndex("updatedAt", "updatedAt", { unique:false });
          s.createIndex("name", "name", { unique:false });
        }
        if(!db.objectStoreNames.contains(STORE_FILES)){
          const f = db.createObjectStore(STORE_FILES, { keyPath: "id" });
          f.createIndex("clientId", "clientId", { unique:false });
          f.createIndex("createdAt", "createdAt", { unique:false });
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
  }

  function tx(db, store, mode="readonly"){
    return db.transaction(store, mode).objectStore(store);
  }

  function idbGetAll(db, store){
    return new Promise((resolve, reject) => {
      const req = tx(db, store).getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }
  function idbPut(db, store, value){
    return new Promise((resolve, reject) => {
      const req = tx(db, store, "readwrite").put(value);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
  function idbDelete(db, store, key){
    return new Promise((resolve, reject) => {
      const req = tx(db, store, "readwrite").delete(key);
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }
  function idbClear(db, store){
    return new Promise((resolve, reject) => {
      const req = tx(db, store, "readwrite").clear();
      req.onsuccess = () => resolve(true);
      req.onerror = () => reject(req.error);
    });
  }

  async function idbGetFilesByClient(db, clientId){
    return new Promise((resolve, reject) => {
      const store = tx(db, STORE_FILES);
      const idx = store.index("clientId");
      const req = idx.getAll(clientId);
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
  }

  // ---------- App State ----------
  const state = {
    db: null,
    clients: [],
    files: [],
    activeTab: "dashboard",
    search: "",
    quickFilter: "all",
    sortBy: "updatedAt_desc",
    modalOpen: false,
    activeClientId: null,
    activeClient: null,
    activeFiles: [],
    activeClientSnapshot: null,
    activeClientIsNew: false,
    autosaveTimer: null,
    autosaveDirty: false,
    lastSavedAt: null,
    officeHeader: defaultOfficeHeader(),
    packetHTML: ""
  };

  function defaultOfficeHeader(){
    return [
      "ASAL Solutions LTD",
      "3185 Morse Rd Ste 15, Columbus, Ohio 43231",
      "Preparer: Abdihaliim Ali",
      "Phone: 615-638-2490   Email: 1@asal.llc"
    ].join("\n");
  }

  function loadSettings(){
    try{
      const raw = localStorage.getItem(SETTINGS_KEY);
      if(!raw) return;
      const s = JSON.parse(raw);
      if(s.officeHeader) state.officeHeader = s.officeHeader;
    }catch(e){}
  }
  function saveSettings(){
    localStorage.setItem(SETTINGS_KEY, JSON.stringify({
      officeHeader: state.officeHeader
    }));
  }

  // ---------- UI Tabs ----------
  function setTab(name){
    state.activeTab = name;
    $$("#tabs .tab").forEach(t => t.classList.toggle("active", t.dataset.tab === name));
    ["dashboard","clients","backup","settings"].forEach(t => {
      const el = $("#tab-" + t);
      if(el) el.style.display = (t === name) ? "" : "none";
    });
    render();
  }

  // ---------- Client Model ----------
  function makeEmptyClient(){
    return {
      id: uid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "draft", // draft | ready | archived
      name: "",
      phone: "",
      email: "",
      ssn_last4: "",
      dob: "",
      filing_status: "",
      address: "",
      moved_12mo: "",
      id_type: "",
      id_exp: "",
      notes: "",
      dependents: [],
      income: {
        w2_employer: "",
        w2_address: "",
        self_employed: "",
        business_type: "",
        income_notes: "",
        expense_notes: ""
      },
      ddq: {
        child_lived_half_year: "",
        anyone_else_claim: "",
        pays_household_costs: "",
        missing_ids: "",
        docs: "",
        preparer_notes: ""
      }
    };
  }

  function computeFlags(c){
    const flags = [];
    const ddq = c.ddq || {};
    const deps = c.dependents || [];

    const unsure = [ddq.child_lived_half_year, ddq.anyone_else_claim, ddq.pays_household_costs, ddq.missing_ids]
      .some(v => (v||"").toLowerCase() === "not sure");

    const missingCore =
      !c.name || !c.filing_status || (!c.phone && !c.email);

    const depIssues = deps.some(d => {
      const ml = parseInt(d.months_lived || "0", 10);
      return (!d.name || !d.relationship || !d.dob || isNaN(ml) || ml < 7);
    });

    const missingDocs = !ddq.docs || ddq.docs.trim().length < 6;

    if(missingCore) flags.push({type:"bad", text:"Missing core profile fields (name/filing/contact)"});
    if(unsure) flags.push({type:"warn", text:"Some due diligence answers are 'Not sure' — document verification needed"});
    if(depIssues) flags.push({type:"warn", text:"Dependent details incomplete or residency < 7 months"});
    if(missingDocs) flags.push({type:"warn", text:"Documents checklist is empty or too short"});
    if(ddq.anyone_else_claim === "Yes") flags.push({type:"warn", text:"Someone else may claim a child — confirm tie-breaker rules"});
    if(ddq.missing_ids === "Yes") flags.push({type:"bad", text:"Missing dependent SSN/ITIN — high risk / cannot finalize until resolved"});
    if((c.income?.self_employed||"") === "Yes" && !(c.income?.income_notes||"").trim()) flags.push({type:"warn", text:"Self-employed noted but income notes are blank"});
    if((c.income?.self_employed||"") === "Yes" && !(c.income?.expense_notes||"").trim()) flags.push({type:"warn", text:"Self-employed noted but expense notes are blank"});
    return flags;
  }

  function computeDocNeed(c){
    const ddq = c.ddq || {};
    const has = (ddq.docs||"").trim().length >= 6;
    return !has;
  }

  function isReadyToPrint(c){
    const flags = computeFlags(c);
    const hardBad = flags.some(f => f.type === "bad");
    if(hardBad) return false;
    if(!c.name || !c.filing_status) return false;
    // if dependents exist, require at least one
    if((c.dependents||[]).length === 0 && !(c.income?.w2_employer||"") && (c.income?.self_employed||"") !== "Yes") return false;
    return true;
  }

  // ---------- Rendering ----------
  async function render(){
    $("#year").textContent = new Date().getFullYear();

    // dashboard KPIs + recent
    const clients = filterClients(state.clients, $("#globalSearch")?.value || state.search, $("#quickFilter")?.value || state.quickFilter);
    $("#kpiClients").textContent = state.clients.length;
    $("#kpiDrafts").textContent = state.clients.filter(c => c.status === "draft").length;
    $("#kpiNeedsDocs").textContent = state.clients.filter(c => computeDocNeed(c)).length;

    // files count
    const files = await idbGetAll(state.db, STORE_FILES);
    $("#kpiFiles").textContent = files.length;

    // recent list
    const recent = [...state.clients].sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0)).slice(0,6);
    $("#recentList").innerHTML = recent.length ? recent.map(c => `
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin:6px 0">
        <div>
          <b>${escapeHtml(c.name || "(Unnamed)")}</b>
          <div class="small">${escapeHtml(c.filing_status || "—")} • Updated ${escapeHtml(fmtWhen(c.updatedAt))}</div>
        </div>
        <button class="btn" data-open="${c.id}">Open</button>
      </div>
    `).join("") : "<span class='muted'>No clients yet. Click <b>New Client</b>.</span>";

    $$("#recentList [data-open]").forEach(btn=>{
      btn.onclick = () => openClient(btn.dataset.open);
    });

    // clients table
    renderClientTable();

    // backup health
    $("#healthClients").textContent = state.clients.length;
    $("#healthFiles").textContent = files.length;
    $("#healthVer").textContent = DB_VER;

    // settings
    $("#officeHeader").value = state.officeHeader;
  }

  function escapeHtml(s){
    return String(s||"")
      .replaceAll("&","&amp;")
      .replaceAll("<","&lt;")
      .replaceAll(">","&gt;")
      .replaceAll('"',"&quot;")
      .replaceAll("'","&#039;");
  }

  function filterClients(all, search, qfilter){
    let list = [...all];
    const q = (search||"").trim().toLowerCase();
    if(q){
      list = list.filter(c => {
        const deps = (c.dependents||[]).map(d=>`${d.name||""} ${d.relationship||""} ${d.school_name||""}`).join(" ");
        const blob = `${c.name||""} ${c.phone||""} ${c.email||""} ${c.filing_status||""} ${c.notes||""} ${deps} ${c.ddq?.preparer_notes||""} ${c.ddq?.docs||""}`.toLowerCase();
        return blob.includes(q);
      });
    }
    if(qfilter === "needs_docs") list = list.filter(c => computeDocNeed(c));
    if(qfilter === "ready_print") list = list.filter(c => isReadyToPrint(c));
    if(qfilter === "has_dependents") list = list.filter(c => (c.dependents||[]).length > 0);
    if(qfilter === "self_employed") list = list.filter(c => (c.income?.self_employed||"") === "Yes");
    return list;
  }

  function sortClients(list, sortBy){
    const [field, dir] = sortBy.split("_");
    const mult = dir === "asc" ? 1 : -1;
    return [...list].sort((a,b)=>{
      if(field === "updatedAt" || field === "createdAt"){
        return ((a[field]||0) - (b[field]||0)) * mult;
      }
      if(field === "name"){
        return (String(a.name||"").localeCompare(String(b.name||""))) * mult;
      }
      return 0;
    });
  }

  function renderClientTable(){
    const search = $("#clientSearch").value || "";
    const sortBy = $("#sortBy").value || state.sortBy;
    const list = sortClients(filterClients(state.clients, search, "all"), sortBy);
    const tbody = $("#clientTbody");
    tbody.innerHTML = list.map(c => {
      const deps = (c.dependents||[]).length;
      const needsDocs = computeDocNeed(c);
      const flags = computeFlags(c);
      const badgeDocs = needsDocs ? `<span class="badge warn">Needs docs</span>` : `<span class="badge ok">Docs OK</span>`;
      const badgeReady = isReadyToPrint(c) ? `<span class="badge ok">Ready</span>` : `<span class="badge warn">Draft</span>`;
      const flagBad = flags.filter(f=>f.type==="bad").length;
      const flagWarn = flags.filter(f=>f.type==="warn").length;
      const flagTxt = (flagBad||flagWarn) ? `${flagBad?`<span class="badge bad">${flagBad} critical</span>`:""} ${flagWarn?`<span class="badge warn">${flagWarn} warnings</span>`:""}` : `<span class="badge ok">No flags</span>`;
      return `
        <tr>
          <td>
            <b>${escapeHtml(c.name || "(Unnamed)")}</b>
            <div class="small">${escapeHtml(c.phone || "")} ${c.email ? "• " + escapeHtml(c.email) : ""}</div>
          </td>
          <td>${escapeHtml(c.filing_status || "—")}<div class="small">${badgeReady}</div></td>
          <td><span class="badge">${deps}</span></td>
          <td>${badgeDocs}</td>
          <td>${flagTxt}</td>
          <td>${escapeHtml(fmtWhen(c.updatedAt))}</td>
          <td style="white-space:nowrap">
            <button class="btn" data-open="${c.id}">Open</button>
            <button class="btn danger" data-del="${c.id}">Delete</button>
          </td>
        </tr>
      `;
    }).join("") || `<tr><td colspan="7" class="muted">No clients yet.</td></tr>`;

    $$("#clientTbody [data-open]").forEach(btn => btn.onclick = () => openClient(btn.dataset.open));
    $$("#clientTbody [data-del]").forEach(btn => btn.onclick = () => deleteClient(btn.dataset.del));
  }

  // ---------- Modal ----------
  function showModal(show){
    state.modalOpen = show;
    $("#modal").classList.toggle("show", show);
    if(!show){
      clearTimeout(state.autosaveTimer);
      state.autosaveTimer = null;
      state.autosaveDirty = false;
      updateSaveIndicators();
    }
  }

  function updateModalMeta(c){
    $("#modalTitle").textContent = c.name ? `Client: ${c.name}` : "New Client";
    $("#modalSub").textContent = `Created ${fmtWhen(c.createdAt)} • Updated ${fmtWhen(c.updatedAt)}`;
  }

  function updateSaveIndicators(){
    const statusEl = $("#autosaveStatus");
    const lastSavedEl = $("#lastSavedAt");
    if(statusEl){
      statusEl.textContent = state.autosaveDirty ? "Unsaved changes" : "Idle";
    }
    if(lastSavedEl){
      if(!state.modalOpen){
        lastSavedEl.textContent = "—";
      }else if(state.lastSavedAt){
        lastSavedEl.textContent = fmtWhen(state.lastSavedAt);
      }else{
        lastSavedEl.textContent = "Not saved yet";
      }
    }
  }

  function markDirty(){
    state.autosaveDirty = true;
    const statusEl = $("#autosaveStatus");
    if(statusEl) statusEl.textContent = "Unsaved changes";
  }

  function getNestedValue(obj, path){
    return path.split(".").reduce((acc, key)=> (acc && acc[key] !== undefined ? acc[key] : ""), obj) ?? "";
  }

  function computeChangedFields(prev, next){
    const fields = [
      { path:"name", label:"Client name" },
      { path:"phone", label:"Phone" },
      { path:"email", label:"Email" },
      { path:"ssn_last4", label:"SSN/ITIN" },
      { path:"dob", label:"DOB" },
      { path:"filing_status", label:"Filing status" },
      { path:"address", label:"Address" },
      { path:"moved_12mo", label:"Moved in last 12 months" },
      { path:"id_type", label:"Photo ID type" },
      { path:"id_exp", label:"Photo ID expiration" },
      { path:"notes", label:"Internal notes" },
      { path:"income.w2_employer", label:"W-2 employer" },
      { path:"income.w2_address", label:"W-2 employer address" },
      { path:"income.self_employed", label:"Self-employed" },
      { path:"income.business_type", label:"Business type" },
      { path:"income.income_notes", label:"Income notes" },
      { path:"income.expense_notes", label:"Expense notes" },
      { path:"ddq.child_lived_half_year", label:"DDQ: child lived half year" },
      { path:"ddq.anyone_else_claim", label:"DDQ: anyone else claim" },
      { path:"ddq.pays_household_costs", label:"DDQ: pays household costs" },
      { path:"ddq.missing_ids", label:"DDQ: missing dependent IDs" },
      { path:"ddq.docs", label:"DDQ: documents" },
      { path:"ddq.preparer_notes", label:"DDQ: preparer notes" }
    ];
    const changed = [];
    for(const f of fields){
      const a = String(getNestedValue(prev || {}, f.path) || "");
      const b = String(getNestedValue(next || {}, f.path) || "");
      if(a !== b) changed.push(f.label);
    }
    const prevDeps = JSON.stringify((prev && prev.dependents) || []);
    const nextDeps = JSON.stringify((next && next.dependents) || []);
    if(prevDeps !== nextDeps) changed.push("Dependents");
    return changed;
  }

  function computeChecklistItems(c){
    const deps = c.dependents || [];
    const depsOk = deps.length === 0 || deps.every(d => {
      const ml = parseInt(d.months_lived || "0", 10);
      return d.name && d.relationship && d.dob && !isNaN(ml) && ml >= 7;
    });
    const docsOk = (c.ddq?.docs || "").trim().length >= 6;
    const idExpOk = !c.id_type || !!c.id_exp;
    return [
      { label:"Client name", ok: !!c.name },
      { label:"Filing status", ok: !!c.filing_status },
      { label:"Contact (phone or email)", ok: !!(c.phone || c.email) },
      { label:"Date of birth", ok: !!c.dob },
      { label:"Address", ok: !!c.address },
      { label:"Photo ID type", ok: !!c.id_type },
      { label:"Photo ID expiration (if ID entered)", ok: idExpOk },
      { label:"Documents noted", ok: docsOk },
      { label:"Dependents complete (if any)", ok: depsOk }
    ];
  }

  function renderChecklist(){
    const box = $("#requiredChecklist");
    if(!box || !state.activeClient) return;
    const draft = structuredClone(state.activeClient);
    readModalIntoClient(draft);
    const items = computeChecklistItems(draft);
    box.innerHTML = items.map(item => `
      <div class="checkitem">
        <span class="badge ${item.ok ? "ok" : "warn"}">${item.ok ? "OK" : "Missing"}</span>
        <span>${escapeHtml(item.label)}</span>
      </div>
    `).join("");
  }

  function renderHistory(){
    const box = $("#changeHistory");
    if(!box || !state.activeClient) return;
    const hist = Array.isArray(state.activeClient.history) ? state.activeClient.history : [];
    if(!hist.length){
      box.innerHTML = "<div class='muted small'>No changes logged yet.</div>";
      return;
    }
    const items = [...hist].sort((a,b)=> (b.at||0)-(a.at||0)).slice(0, 12);
    box.innerHTML = items.map(h => `
      <div class="historyEntry">
        <span class="badge">${escapeHtml(h.source || "Save")}</span>
        <span class="fields">${escapeHtml((h.fields || []).join(", "))}</span>
        <span class="small">${escapeHtml(fmtWhen(h.at))}</span>
      </div>
    `).join("");
  }

  function scheduleAutosave(){
    if(!state.modalOpen || !state.activeClientId) return;
    clearTimeout(state.autosaveTimer);
    state.autosaveTimer = setTimeout(async ()=>{
      if(!state.modalOpen || !state.activeClientId) return;
      const statusEl = $("#autosaveStatus");
      if(statusEl) statusEl.textContent = "Saving...";
      const didSave = await persistActiveClient({ source:"Auto-save", closeAfterSave:false, showToast:false });
      if(statusEl) statusEl.textContent = didSave ? "Saved" : "Idle";
    }, 900);
  }

  function handleModalInput(e){
    if(!state.modalOpen || !state.activeClient) return;
    const t = e.target;
    if(!(t && (t.matches("input, select, textarea")))) return;
    markDirty();
    renderChecklist();
    scheduleAutosave();
  }

  function upsertClientCache(client){
    const idx = state.clients.findIndex(c => c.id === client.id);
    if(idx >= 0) state.clients[idx] = structuredClone(client);
    else state.clients.unshift(structuredClone(client));
  }

  async function persistActiveClient({ source="Manual save", closeAfterSave=true, showToast=true } = {}){
    if(!state.activeClient) return;
    const draft = structuredClone(state.activeClient);
    readModalIntoClient(draft);
    const isInitial = !state.activeClientSnapshot || state.activeClientIsNew;
    const changedFields = isInitial ? ["Initial save"] : computeChangedFields(state.activeClientSnapshot, draft);
    const shouldSave = isInitial || changedFields.length > 0 || source === "Manual save";
    if(!shouldSave){
      updateSaveIndicators();
      return false;
    }
    if(changedFields.length){
      draft.history = Array.isArray(draft.history) ? draft.history.slice() : [];
      draft.history.push({ at: Date.now(), fields: changedFields, source });
      if(draft.history.length > 50) draft.history = draft.history.slice(-50);
    }
    await idbPut(state.db, STORE_CLIENTS, draft);
    state.activeClient = draft;
    state.activeClientSnapshot = structuredClone(draft);
    state.activeClientIsNew = false;
    state.lastSavedAt = draft.updatedAt;
    state.autosaveDirty = false;
    updateSaveIndicators();
    updateModalMeta(draft);
    renderChecklist();
    renderHistory();
    if(showToast) toast("Saved.");

    if(closeAfterSave){
      showModal(false);
      state.activeClient = null;
      state.activeClientId = null;
      state.activeFiles = [];
      state.clients = await idbGetAll(state.db, STORE_CLIENTS);
      render();
    }else{
      upsertClientCache(draft);
    }
    return true;
  }

  function setModalTab(name){
    $$("#modalTabs .tab").forEach(t => t.classList.toggle("active", t.dataset.mtab === name));
    ["profile","dependents","income","ddq","files","print"].forEach(t=>{
      const el = $("#mtab-" + t);
      if(el) el.style.display = (t === name) ? "" : "none";
    });
    if(name === "ddq") renderFlags();
    if(name === "files") renderFiles();
    if(name === "dependents") renderDeps();
    if(name === "print") renderPacketPreview();
  }

  function bindModalTabs(){
    $$("#modalTabs .tab").forEach(tab=>{
      tab.addEventListener("click", ()=> setModalTab(tab.dataset.mtab));
    });
  }

  function fillModal(c){
    updateModalMeta(c);

    $("#f_name").value = c.name || "";
    $("#f_phone").value = c.phone || "";
    $("#f_email").value = c.email || "";
    $("#f_ssn").value = c.ssn_last4 || "";
    $("#f_dob").value = c.dob || "";
    $("#f_filing").value = c.filing_status || "";
    $("#f_address").value = c.address || "";
    $("#f_moved").value = c.moved_12mo || "";
    $("#f_idtype").value = c.id_type || "";
    $("#f_idexp").value = c.id_exp || "";
    $("#f_notes").value = c.notes || "";

    $("#i_w2employer").value = c.income?.w2_employer || "";
    $("#i_w2addr").value = c.income?.w2_address || "";
    $("#i_self").value = c.income?.self_employed || "";
    $("#i_bus").value = c.income?.business_type || "";
    $("#i_income_notes").value = c.income?.income_notes || "";
    $("#i_exp_notes").value = c.income?.expense_notes || "";

    $("#d_child_half").value = c.ddq?.child_lived_half_year || "";
    $("#d_else_claim").value = c.ddq?.anyone_else_claim || "";
    $("#d_house_costs").value = c.ddq?.pays_household_costs || "";
    $("#d_missing_ids").value = c.ddq?.missing_ids || "";
    $("#d_docs").value = c.ddq?.docs || "";
    $("#d_notes").value = c.ddq?.preparer_notes || "";

    $("#packetStatus").textContent = "Not generated";
    $("#packetPreview").innerHTML = "Generate a packet to preview here.";
    renderChecklist();
    renderHistory();
    updateSaveIndicators();
  }

  function readModalIntoClient(c){
    c.name = $("#f_name").value.trim();
    c.phone = $("#f_phone").value.trim();
    c.email = $("#f_email").value.trim();
    c.ssn_last4 = $("#f_ssn").value.trim();
    c.dob = $("#f_dob").value;
    c.filing_status = $("#f_filing").value;
    c.address = $("#f_address").value.trim();
    c.moved_12mo = $("#f_moved").value;
    c.id_type = $("#f_idtype").value;
    c.id_exp = $("#f_idexp").value;
    c.notes = $("#f_notes").value.trim();

    c.income = c.income || {};
    c.income.w2_employer = $("#i_w2employer").value.trim();
    c.income.w2_address = $("#i_w2addr").value.trim();
    c.income.self_employed = $("#i_self").value;
    c.income.business_type = $("#i_bus").value.trim();
    c.income.income_notes = $("#i_income_notes").value.trim();
    c.income.expense_notes = $("#i_exp_notes").value.trim();

    c.ddq = c.ddq || {};
    c.ddq.child_lived_half_year = $("#d_child_half").value;
    c.ddq.anyone_else_claim = $("#d_else_claim").value;
    c.ddq.pays_household_costs = $("#d_house_costs").value;
    c.ddq.missing_ids = $("#d_missing_ids").value;
    c.ddq.docs = $("#d_docs").value.trim();
    c.ddq.preparer_notes = $("#d_notes").value.trim();

    c.updatedAt = Date.now();
    c.status = isReadyToPrint(c) ? "ready" : "draft";
  }

  async function openClient(id){
    const c = state.clients.find(x => x.id === id);
    if(!c) return;
    state.activeClientId = id;
    state.activeClient = structuredClone(c);
    state.activeClientSnapshot = structuredClone(c);
    state.activeClientIsNew = false;
    state.lastSavedAt = c.updatedAt || null;
    state.autosaveDirty = false;
    state.activeFiles = await idbGetFilesByClient(state.db, id);
    fillModal(state.activeClient);
    setModalTab("profile");
    showModal(true);
  }

  async function saveClient(){
    await persistActiveClient({ source:"Manual save", closeAfterSave:true, showToast:true });
  }

  async function deleteClient(id){
    if(!confirm("Delete this client and all attached files?")) return;

    // delete files for client
    const files = await idbGetFilesByClient(state.db, id);
    for(const f of files){
      await idbDelete(state.db, STORE_FILES, f.id);
    }
    await idbDelete(state.db, STORE_CLIENTS, id);

    state.clients = await idbGetAll(state.db, STORE_CLIENTS);
    toast("Deleted.");
    render();
  }

  // ---------- Dependents ----------
  function renderDeps(){
    const c = state.activeClient;
    const box = $("#deps");
    if(!c) return;
    const deps = c.dependents || [];
    $("#depCount").textContent = deps.length;

    box.innerHTML = deps.map((d, idx) => `
      <div class="dep" data-idx="${idx}">
        <div class="depTop">
          <div>
            <div class="title">${escapeHtml(d.name || `Dependent #${idx+1}`)}</div>
            <div class="small">Residency + school info supports eligibility documentation.</div>
          </div>
          <div class="miniActions">
            <button class="btn" data-dup="${idx}">Duplicate</button>
            <button class="btn danger" data-del="${idx}">Remove</button>
          </div>
        </div>
        <div class="row">
          <div><label>Full name</label><input data-k="name" value="${escapeAttr(d.name||"")}" placeholder="Child full name"/></div>
          <div><label>DOB</label><input data-k="dob" type="date" value="${escapeAttr(d.dob||"")}"/></div>
          <div><label>SSN/ITIN (last 4)</label><input data-k="ssn_last4" value="${escapeAttr(d.ssn_last4||"")}" placeholder="1234"/></div>
          <div><label>Relationship</label><input data-k="relationship" value="${escapeAttr(d.relationship||"")}" placeholder="Son, Daughter, Niece..."/></div>
          <div><label>Months lived w/ taxpayer (0–12)</label><input data-k="months_lived" value="${escapeAttr(d.months_lived||"")}" placeholder="e.g., 12"/></div>
          <div><label>Other parent/guardian (name + phone)</label><input data-k="other_parent" value="${escapeAttr(d.other_parent||"")}" placeholder="If applicable"/></div>
        </div>
        <div class="row" style="margin-top:8px">
          <div><label>School/daycare name</label><input data-k="school_name" value="${escapeAttr(d.school_name||"")}" placeholder="School name"/></div>
          <div><label>School address/phone</label><input data-k="school_address" value="${escapeAttr(d.school_address||"")}" placeholder="Address + phone"/></div>
        </div>
        <div style="margin-top:8px">
          <label>Notes (custody/support/special situations)</label>
          <textarea data-k="notes" placeholder="Anything unusual or important…">${escapeHtml(d.notes||"")}</textarea>
        </div>
      </div>
    `).join("") || `<div class="small muted">No dependents yet. Click “Add dependent”.</div>`;

    // bind inputs
    $$("#deps .dep").forEach(depEl=>{
      const idx = parseInt(depEl.dataset.idx, 10);
      depEl.addEventListener("input", (e)=>{
        const t = e.target;
        const k = t.getAttribute("data-k");
        if(!k) return;
        state.activeClient.dependents[idx][k] = t.value;
        // update flags live
        renderFlags();
        renderChecklist();
        markDirty();
        scheduleAutosave();
      });
    });

    $$("#deps [data-del]").forEach(btn=>{
      btn.onclick = () => {
        const i = parseInt(btn.dataset.del, 10);
        state.activeClient.dependents.splice(i,1);
        renderDeps();
        renderFlags();
        renderChecklist();
        markDirty();
        scheduleAutosave();
      };
    });
    $$("#deps [data-dup]").forEach(btn=>{
      btn.onclick = () => {
        const i = parseInt(btn.dataset.dup, 10);
        const copy = structuredClone(state.activeClient.dependents[i]);
        state.activeClient.dependents.splice(i+1,0,copy);
        renderDeps();
        renderFlags();
        renderChecklist();
        markDirty();
        scheduleAutosave();
      };
    });
  }

  function addDependent(){
    if(!state.activeClient) return;
    state.activeClient.dependents = state.activeClient.dependents || [];
    state.activeClient.dependents.push({
      name:"", dob:"", ssn_last4:"", relationship:"",
      months_lived:"", school_name:"", school_address:"",
      other_parent:"", notes:""
    });
    renderDeps();
    renderFlags();
    renderChecklist();
    markDirty();
    scheduleAutosave();
  }

  // ---------- Files ----------
  async function addFiles(fileList){
    if(!state.activeClientId) return;
    const files = Array.from(fileList || []);
    for(const f of files){
      const rec = {
        id: fid(),
        clientId: state.activeClientId,
        name: f.name,
        type: f.type || "application/octet-stream",
        size: f.size,
        createdAt: Date.now(),
        blob: f // store blob directly
      };
      await idbPut(state.db, STORE_FILES, rec);
    }
    state.activeFiles = await idbGetFilesByClient(state.db, state.activeClientId);
    toast("Files saved locally.");
    renderFiles();
  }

  function humanSize(bytes){
    const u = ["B","KB","MB","GB"];
    let n = bytes || 0;
    let i = 0;
    while(n >= 1024 && i < u.length-1){ n/=1024; i++; }
    return `${n.toFixed(i===0?0:1)} ${u[i]}`;
  }

  function renderFiles(){
    const list = $("#fileList");
    if(!list) return;
    if(!state.activeClientId){
      list.innerHTML = "<div class='muted small'>No client selected.</div>";
      return;
    }
    const files = state.activeFiles || [];
    list.innerHTML = files.length ? files.map(f => `
      <div class="fileitem">
        <div class="meta">
          <div>
            <b>${escapeHtml(f.name)}</b>
            <div class="small">${escapeHtml(f.type)} • ${escapeHtml(humanSize(f.size))} • ${escapeHtml(fmtWhen(f.createdAt))}</div>
          </div>
        </div>
        <div class="acts">
          <button class="btn" data-dl="${f.id}">Open</button>
          <button class="btn danger" data-rm="${f.id}">Remove</button>
        </div>
      </div>
    `).join("") : "<div class='muted small'>No files uploaded yet.</div>";

    $$("#fileList [data-rm]").forEach(btn=>{
      btn.onclick = async () => {
        const id = btn.dataset.rm;
        await idbDelete(state.db, STORE_FILES, id);
        state.activeFiles = await idbGetFilesByClient(state.db, state.activeClientId);
        toast("Removed.");
        renderFiles();
      };
    });

    $$("#fileList [data-dl]").forEach(btn=>{
      btn.onclick = async () => {
        const id = btn.dataset.dl;
        const rec = state.activeFiles.find(x => x.id === id);
        if(!rec) return;
        const url = URL.createObjectURL(rec.blob);
        window.open(url, "_blank");
        // Let the browser keep it; revoke later.
        setTimeout(()=>URL.revokeObjectURL(url), 15_000);
      };
    });
  }

  // ---------- Flags ----------
  function renderFlags(){
    const box = $("#flagBox");
    if(!box || !state.activeClient) return;
    // pull fresh ddq values before computing
    const tmp = state.activeClient;
    tmp.ddq = tmp.ddq || {};
    tmp.ddq.child_lived_half_year = $("#d_child_half").value;
    tmp.ddq.anyone_else_claim = $("#d_else_claim").value;
    tmp.ddq.pays_household_costs = $("#d_house_costs").value;
    tmp.ddq.missing_ids = $("#d_missing_ids").value;
    tmp.ddq.docs = $("#d_docs").value;
    tmp.ddq.preparer_notes = $("#d_notes").value;

    tmp.name = $("#f_name").value;
    tmp.filing_status = $("#f_filing").value;
    tmp.phone = $("#f_phone").value;
    tmp.email = $("#f_email").value;

    tmp.income = tmp.income || {};
    tmp.income.self_employed = $("#i_self").value;
    tmp.income.income_notes = $("#i_income_notes").value;
    tmp.income.expense_notes = $("#i_exp_notes").value;

    const flags = computeFlags(tmp);
    if(!flags.length){
      box.innerHTML = `<span class="badge ok">No flags</span>`;
      return;
    }
    box.innerHTML = flags.map(f => `<div style="margin:6px 0"><span class="badge ${f.type}">${escapeHtml(f.type.toUpperCase())}</span> <span>${escapeHtml(f.text)}</span></div>`).join("");
  }

  // ---------- Print Packet ----------
  function buildPacketHTML(c, files){
    const headerLines = (state.officeHeader || defaultOfficeHeader()).split("\n").map(s=>s.trim()).filter(Boolean);
    const header = headerLines.map(l=>`<div>${escapeHtml(l)}</div>`).join("");

    const deps = c.dependents || [];
    const depRows = deps.map((d,i)=>`
      <tr>
        <td style="padding:4px">${i+1}</td>
        <td style="padding:4px">${escapeHtml(d.name||"")}</td>
        <td style="padding:4px">${escapeHtml(d.dob||"")}</td>
        <td style="padding:4px">${escapeHtml(d.ssn_last4||"")}</td>
        <td style="padding:4px">${escapeHtml(d.relationship||"")}</td>
        <td style="padding:4px">${escapeHtml(d.months_lived||"")}</td>
        <td style="padding:4px">${escapeHtml(d.school_name||"")}</td>
        <td style="padding:4px">${escapeHtml(d.school_address||"")}</td>
      </tr>
    `).join("");

    const flags = computeFlags(c);

    const fileRows = (files||[]).map(f=>`
      <tr>
        <td style="padding:4px">${escapeHtml(f.name)}</td>
        <td style="padding:4px">${escapeHtml(f.type)}</td>
        <td style="padding:4px">${escapeHtml(humanSize(f.size))}</td>
        <td style="padding:4px">${escapeHtml(fmtWhen(f.createdAt))}</td>
      </tr>
    `).join("");

    const today = new Date().toISOString().slice(0,10);

    return `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; color:#000">
        <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start">
          <div>
            <div style="font-weight:900;font-size:16px;margin-bottom:6px">Tax Due Diligence Packet</div>
            <div style="font-size:12px;line-height:1.35">${header}</div>
          </div>
          <div style="text-align:right;font-size:12px">
            <div><b>Date:</b> ${escapeHtml(today)}</div>
            <div><b>Client ID:</b> ${escapeHtml(c.id)}</div>
          </div>
        </div>

        <hr style="margin:12px 0"/>

        <div style="font-weight:900;margin-bottom:6px">Client Summary</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr><td style="border:1px solid #ddd;padding:4px;width:28%"><b>Client</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.name||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Phone / Email</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml((c.phone||"") + (c.email?(" • "+c.email):""))}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>DOB</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.dob||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>SSN/ITIN (Last 4)</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ssn_last4||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Filing status</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.filing_status||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Address</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.address||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Photo ID</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml((c.id_type||"") + (c.id_exp?(" (exp "+c.id_exp+")"):""))}</td></tr>
        </table>

        <div style="height:12px"></div>

        <div style="font-weight:900;margin-bottom:6px">Dependents / Children</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <tr style="background:#f5f5f5">
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">#</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">Name</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">DOB</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">ID (Last 4)</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">Relationship</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">Months w/ Taxpayer</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">School/Daycare</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">School Address/Phone</th>
          </tr>
          ${depRows || `<tr><td colspan="8" style="border:1px solid #ddd;padding:4px">No dependents entered.</td></tr>`}
        </table>

        <div style="height:12px"></div>

        <div style="font-weight:900;margin-bottom:6px">Income + Work Notes</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr><td style="border:1px solid #ddd;padding:4px;width:28%"><b>W-2 Employer</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.w2_employer||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Employer Address</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.w2_address||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Self-Employed?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.self_employed||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Business Type</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.business_type||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Income Notes</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.income_notes||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Expense Notes</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.expense_notes||"")}</td></tr>
        </table>

        <div style="height:12px"></div>

        <div style="font-weight:900;margin-bottom:6px">Due Diligence Q/A + Verification</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr><td style="border:1px solid #ddd;padding:4px;width:50%"><b>Child lived with taxpayer more than half the year?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.child_lived_half_year||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Could anyone else claim any child?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.anyone_else_claim||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Taxpayer pays more than half household costs?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.pays_household_costs||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Any missing dependent IDs?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.missing_ids||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Documents reviewed/requested</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.docs||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Preparer verification notes</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.preparer_notes||"")}</td></tr>
        </table>

        <div style="height:12px"></div>

        <div style="font-weight:900;margin-bottom:6px">Auto Flags</div>
        <div style="font-size:12px">
          ${flags.length ? flags.map(f=>`• <b>${escapeHtml(f.type.toUpperCase())}</b> — ${escapeHtml(f.text)}<br/>`).join("") : "No flags generated."}
        </div>

        <div style="height:12px"></div>

        <div style="font-weight:900;margin-bottom:6px">Attached Files (Local)</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr style="background:#f5f5f5">
            <th style="border:1px solid #ddd;padding:4px">File</th>
            <th style="border:1px solid #ddd;padding:4px">Type</th>
            <th style="border:1px solid #ddd;padding:4px">Size</th>
            <th style="border:1px solid #ddd;padding:4px">Added</th>
          </tr>
          ${fileRows || `<tr><td colspan="4" style="border:1px solid #ddd;padding:4px">No files attached.</td></tr>`}
        </table>

        <div style="height:14px"></div>

        <div style="font-weight:900;margin-bottom:6px">Client Attestation</div>
        <div style="font-size:12px;line-height:1.45">
          I certify that the information I provided is true and complete to the best of my knowledge. I understand that eligibility for credits depends on accurate residency, relationship, and support information.
        </div>

        <div style="display:grid;grid-template-columns:1fr 1fr;gap:14px;margin-top:14px">
          <div style="border:1px solid #ddd;padding:10px;border-radius:10px">
            <div style="height:34px;border-bottom:1px solid #bbb;margin-bottom:6px"></div>
            <div style="font-size:12px;color:#333">Client signature</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;font-size:12px">
              <div><div style="color:#666;margin-bottom:4px">Date</div><div style="border:1px solid #bbb;padding:8px">${escapeHtml(today)}</div></div>
              <div><div style="color:#666;margin-bottom:4px">Printed name</div><div style="border:1px solid #bbb;padding:8px">${escapeHtml(c.name||"")}</div></div>
            </div>
          </div>

          <div style="border:1px solid #ddd;padding:10px;border-radius:10px">
            <div style="height:34px;border-bottom:1px solid #bbb;margin-bottom:6px"></div>
            <div style="font-size:12px;color:#333">Preparer signature</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px;margin-top:10px;font-size:12px">
              <div><div style="color:#666;margin-bottom:4px">Date</div><div style="border:1px solid #bbb;padding:8px">${escapeHtml(today)}</div></div>
              <div><div style="color:#666;margin-bottom:4px">Preparer name</div><div style="border:1px solid #bbb;padding:8px">Abdihaliim Ali</div></div>
            </div>
          </div>
        </div>
      </div>
    `;
  }

  async function renderPacketPreview(){
    if(!state.activeClient) return;
    const c = state.activeClient;
    const files = state.activeFiles || [];
    const html = buildPacketHTML(c, files);
    state.packetHTML = html;
    $("#packetPreview").innerHTML = `
      <div class="pill"><span>Preview:</span> <b>${escapeHtml(c.name || "(Unnamed)")}</b></div>
      <div class="divider"></div>
      <div style="background:#fff;border-radius:12px;padding:12px;overflow:auto">
        ${html}
      </div>
    `;
    $("#packetStatus").textContent = "Generated";
  }

  async function printClientFromModal(){
    if(!state.activeClient){
      toast("No client selected.");
      return;
    }
    // Save any unsaved changes first
    readModalIntoClient(state.activeClient);
    const c = state.activeClient;
    const files = state.activeFiles || [];
    const html = buildPacketHTML(c, files);

    const w = window.open("", "_blank");
    w.document.open();
    w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Print Packet - ${escapeHtml(c.name || "Client")}</title></head><body>${html}<script>window.onload=()=>{window.print();};</script></body></html>`);
    w.document.close();
  }

  function escapeAttr(s){
    return escapeHtml(s).replaceAll("\n"," ");
  }

  // ---------- Mock Data Generator ----------
  const mockFirstNames = [
    "James", "Mary", "John", "Patricia", "Robert", "Jennifer", "Michael", "Linda",
    "William", "Elizabeth", "David", "Barbara", "Richard", "Susan", "Joseph", "Jessica",
    "Thomas", "Sarah", "Christopher", "Karen"
  ];
  const mockLastNames = [
    "Smith", "Johnson", "Williams", "Brown", "Jones", "Garcia", "Miller", "Davis",
    "Rodriguez", "Martinez", "Hernandez", "Lopez", "Wilson", "Anderson", "Thomas", "Taylor",
    "Moore", "Jackson", "Martin", "Lee"
  ];
  const mockStreets = [
    "123 Main St", "456 Oak Ave", "789 Elm Dr", "321 Pine Rd", "654 Maple Ln",
    "987 Cedar Way", "147 Birch St", "258 Spruce Ave", "369 Willow Dr", "741 Ash Rd"
  ];
  const mockCities = [
    "Columbus", "Cleveland", "Cincinnati", "Toledo", "Akron", "Dayton", "Parma", "Canton"
  ];
  const mockEmployers = [
    "Walmart Distribution Center", "Amazon Fulfillment", "Nationwide Insurance", "Ohio State University",
    "Honda Manufacturing", "Kroger", "Target", "Home Depot", "Lowe's", "FedEx Ground",
    "UPS", "McDonald's", "Starbucks", "CVS Pharmacy", "Walgreens", "Meijer",
    "Giant Eagle", "Kohl's", "Macy's", "Best Buy"
  ];
  const mockFilingStatuses = [
    "Single", "Head of Household", "Married Filing Jointly", "Married Filing Separately", "Qualifying Surviving Spouse"
  ];
  const mockDependentNames = [
    "Emma", "Noah", "Olivia", "Liam", "Ava", "Mason", "Sophia", "Jacob",
    "Isabella", "Ethan", "Mia", "Michael", "Charlotte", "Daniel", "Amelia", "Matthew"
  ];
  const mockRelationships = ["Son", "Daughter", "Niece", "Nephew", "Grandson", "Granddaughter"];
  const mockSchools = [
    "Columbus Elementary", "Lincoln Middle School", "Washington High", "Roosevelt Elementary",
    "Jefferson Middle", "Franklin High", "Madison Elementary", "Adams Middle"
  ];

  function mockRandomItem(arr) {
    return arr[Math.floor(Math.random() * arr.length)];
  }
  function mockRandomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }
  function mockRandomDate(start, end) {
    const date = new Date(start.getTime() + Math.random() * (end.getTime() - start.getTime()));
    return date.toISOString().slice(0, 10);
  }
  function mockRandomPhone() {
    return `(614) ${mockRandomInt(200, 999)}-${mockRandomInt(1000, 9999)}`;
  }
  function mockRandomEmail(first, last) {
    const domains = ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com", "aol.com"];
    return `${first.toLowerCase()}.${last.toLowerCase()}@${mockRandomItem(domains)}`;
  }
  function mockRandomSSN() {
    return mockRandomInt(1000, 9999).toString();
  }

  function generateMockDependent(index) {
    const name = mockRandomItem(mockDependentNames);
    const dob = mockRandomDate(new Date(2010, 0, 1), new Date(2020, 11, 31));
    return {
      name: `${name} ${mockRandomItem(mockLastNames)}`,
      dob: dob,
      ssn_last4: mockRandomSSN(),
      relationship: mockRandomItem(mockRelationships),
      months_lived: mockRandomInt(7, 12).toString(),
      school_name: mockRandomItem(mockSchools),
      school_address: `${mockRandomInt(100, 999)} School St, ${mockRandomItem(mockCities)}, OH ${mockRandomInt(43000, 45000)}`,
      other_parent: Math.random() > 0.5 ? `Other Parent, ${mockRandomPhone()}` : "",
      notes: Math.random() > 0.7 ? "Custody agreement on file. Shared custody arrangement." : ""
    };
  }

  function generateMockClient(index) {
    const firstName = mockFirstNames[index % mockFirstNames.length];
    const lastName = mockLastNames[index % mockLastNames.length];
    const name = `${firstName} ${lastName}`;
    const baseTime = Date.now() - (mockRandomInt(0, 90) * 24 * 60 * 60 * 1000);
    
    const hasDependents = index % 3 !== 0;
    const numDependents = hasDependents ? mockRandomInt(1, 3) : 0;
    const dependents = [];
    for (let i = 0; i < numDependents; i++) {
      dependents.push(generateMockDependent(i));
    }

    const filingStatus = mockRandomItem(mockFilingStatuses);
    const isSelfEmployed = index % 4 === 0;
    const city = mockRandomItem(mockCities);
    const street = mockRandomItem(mockStreets);
    
    const client = {
      id: uid(),
      createdAt: baseTime,
      updatedAt: baseTime + mockRandomInt(0, 7) * 24 * 60 * 60 * 1000,
      status: "ready",
      name: name,
      phone: mockRandomPhone(),
      email: mockRandomEmail(firstName, lastName),
      ssn_last4: mockRandomSSN(),
      dob: mockRandomDate(new Date(1970, 0, 1), new Date(1995, 11, 31)),
      filing_status: filingStatus,
      address: `${street}, ${city}, OH ${mockRandomInt(43000, 45000)}`,
      moved_12mo: index % 5 === 0 ? "Yes" : "No",
      id_type: mockRandomItem(["Driver's License", "State ID", "Passport"]),
      id_exp: mockRandomDate(new Date(2025, 0, 1), new Date(2028, 11, 31)),
      notes: `Client ${index + 1}. ${index % 3 === 0 ? "Returning client from previous year." : "New client for tax season."} ${index % 4 === 0 ? "Has prior-year audit history - all documents verified." : ""}`,
      dependents: dependents,
      income: {
        w2_employer: isSelfEmployed ? "" : mockRandomItem(mockEmployers),
        w2_address: isSelfEmployed ? "" : `${mockRandomItem(mockStreets)}, ${city}, OH ${mockRandomInt(43000, 45000)}`,
        self_employed: isSelfEmployed ? "Yes" : "No",
        business_type: isSelfEmployed ? mockRandomItem(["Rideshare (Uber/Lyft)", "Cleaning services", "Trucking", "Sales", "Consulting", "Construction"]) : "",
        income_notes: isSelfEmployed 
          ? `Self-employed ${mockRandomItem(["full-time", "part-time"])}. Average weekly income: $${mockRandomInt(400, 1200)}. Works ${mockRandomInt(20, 50)} hours per week.`
          : `W-2 employee. Annual income approximately $${mockRandomInt(25000, 75000)}. Works ${mockRandomInt(30, 40)} hours per week.`,
        expense_notes: isSelfEmployed
          ? `Mileage: ${mockRandomInt(5000, 25000)} miles. Phone: $${mockRandomInt(50, 150)}/month. Supplies: $${mockRandomInt(200, 1000)}/year.`
          : "Standard W-2 employment, no business expenses."
      },
      ddq: {
        child_lived_half_year: hasDependents ? "Yes" : "N/A",
        anyone_else_claim: hasDependents ? (index % 7 === 0 ? "Yes" : "No") : "N/A",
        pays_household_costs: "Yes",
        missing_ids: index % 10 === 0 ? "Yes" : "No",
        docs: `Photo ID (${mockRandomItem(["Driver's License", "State ID", "Passport"])}) verified. ${hasDependents ? "Birth certificates for all dependents. School enrollment letters. Medical records. " : ""}${isSelfEmployed ? "1099 forms. Business expense receipts. " : "W-2 forms. "}Lease agreement. Utility bills (electric, water). Bank statements.`,
        preparer_notes: `All documents reviewed and verified on ${new Date(baseTime).toLocaleDateString()}. ${hasDependents ? "Dependent residency confirmed through school records and medical documents. " : ""}${isSelfEmployed ? "Self-employment income verified through bank deposits and 1099 forms. " : "W-2 income verified. "}Client attestation signed. All required due diligence questions answered.`
      }
    };

    return client;
  }

  async function generateMockData() {
    try {
      const clients = [];
      for (let i = 0; i < 20; i++) {
        clients.push(generateMockClient(i));
      }

      for (const client of clients) {
        await idbPut(state.db, STORE_CLIENTS, client);
      }

      state.clients = await idbGetAll(state.db, STORE_CLIENTS);
      toast(`Generated ${clients.length} mock clients!`);
      render();
      return { success: true, count: clients.length };
    } catch (error) {
      toast(`Error: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  // Expose to window for console access
  window.generateMockData = generateMockData;

  // ---------- Backup ----------
  async function exportBackup(includeFiles=true){
    const clients = await idbGetAll(state.db, STORE_CLIENTS);
    const files = includeFiles ? await idbGetAll(state.db, STORE_FILES) : [];
    // Convert blobs to base64 for export (big, but portable).
    const fileOut = [];
    for(const f of files){
      const b64 = await blobToBase64(f.blob);
      fileOut.push({
        id: f.id,
        clientId: f.clientId,
        name: f.name,
        type: f.type,
        size: f.size,
        createdAt: f.createdAt,
        blobBase64: b64
      });
    }
    const payload = {
      meta: { app:"asal-dd", version: DB_VER, exportedAt: Date.now() },
      settings: { officeHeader: state.officeHeader },
      clients,
      files: fileOut
    };
    downloadJSON(payload, includeFiles ? "asal-dd-backup-full" : "asal-dd-backup-lite");
  }

  function downloadJSON(obj, name){
    const blob = new Blob([JSON.stringify(obj, null, 2)], {type:"application/json"});
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${name}-${new Date().toISOString().slice(0,10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }

  async function importBackupFile(file){
    const text = await file.text();
    const data = JSON.parse(text);

    if(!data || !data.meta || !Array.isArray(data.clients)){
      alert("Invalid backup file.");
      return;
    }

    // restore settings
    if(data.settings?.officeHeader){
      state.officeHeader = data.settings.officeHeader;
      saveSettings();
      $("#officeHeader").value = state.officeHeader;
    }

    // restore clients
    for(const c of data.clients){
      await idbPut(state.db, STORE_CLIENTS, c);
    }

    // restore files
    if(Array.isArray(data.files)){
      for(const f of data.files){
        if(!f.blobBase64) continue;
        const blob = base64ToBlob(f.blobBase64, f.type || "application/octet-stream");
        await idbPut(state.db, STORE_FILES, {
          id: f.id,
          clientId: f.clientId,
          name: f.name,
          type: f.type,
          size: f.size,
          createdAt: f.createdAt,
          blob
        });
      }
    }

    state.clients = await idbGetAll(state.db, STORE_CLIENTS);
    toast("Backup imported.");
    render();
  }

  function blobToBase64(blob){
    return new Promise((resolve, reject)=>{
      const r = new FileReader();
      r.onload = () => {
        const res = String(r.result||"");
        // data:...;base64,XXXX
        const idx = res.indexOf(",");
        resolve(idx >= 0 ? res.slice(idx+1) : res);
      };
      r.onerror = () => reject(r.error);
      r.readAsDataURL(blob);
    });
  }
  function base64ToBlob(b64, mime){
    const bin = atob(b64);
    const len = bin.length;
    const arr = new Uint8Array(len);
    for(let i=0;i<len;i++) arr[i] = bin.charCodeAt(i);
    return new Blob([arr], {type:mime});
  }

  // ---------- Bind UI ----------
  async function init(){
    loadSettings();
    state.db = await openDB();
    $("#dbStatus").textContent = "Ready";
    state.clients = await idbGetAll(state.db, STORE_CLIENTS);

    // Tabs
    $$("#tabs .tab").forEach(tab => tab.addEventListener("click", ()=> setTab(tab.dataset.tab)));

    // Top actions
    $("#btnNew").addEventListener("click", () => {
      state.activeClient = makeEmptyClient();
      state.activeClientId = state.activeClient.id;
      state.activeClientSnapshot = null;
      state.activeClientIsNew = true;
      state.lastSavedAt = null;
      state.autosaveDirty = false;
      state.activeFiles = [];
      fillModal(state.activeClient);
      setModalTab("profile");
      showModal(true);
    });
    $("#btnSave").addEventListener("click", saveClient);
    $("#btnClose").addEventListener("click", ()=> showModal(false));
    $("#modal").addEventListener("click", (e)=>{ if(e.target.id === "modal") showModal(false); });

    $("#btnQuickBackup").addEventListener("click", async ()=> {
      await exportBackup(true);
      toast("Backup exported.");
    });

    $("#btnWipe").addEventListener("click", async ()=> {
      if(!confirm("This will delete ALL local clients and files in this browser. Continue?")) return;
      await idbClear(state.db, STORE_CLIENTS);
      await idbClear(state.db, STORE_FILES);
      state.clients = [];
      toast("Local data wiped.");
      render();
    });

    // Dashboard filters
    $("#globalSearch").addEventListener("input", ()=> render());
    $("#quickFilter").addEventListener("change", ()=> render());

    // Clients page
    $("#clientSearch").addEventListener("input", ()=> renderClientTable());
    $("#sortBy").addEventListener("change", ()=> renderClientTable());

    // Settings
    $("#officeHeader").addEventListener("input", (e)=> {
      state.officeHeader = e.target.value;
      saveSettings();
    });
    $("#btnResetSettings").addEventListener("click", ()=> {
      state.officeHeader = defaultOfficeHeader();
      $("#officeHeader").value = state.officeHeader;
      saveSettings();
      toast("Settings reset.");
    });
    $("#btnGenerateMockData").addEventListener("click", async ()=> {
      if(!confirm("Generate 20 mock clients with all fields filled? This will add them to your database.")) return;
      await generateMockData();
    });

    // Modal tabs
    bindModalTabs();

    // Modal actions
    $("#btnAddDep").addEventListener("click", addDependent);
    $("#fileInput").addEventListener("change", (e)=> addFiles(e.target.files));
    $("#btnBuildPacket").addEventListener("click", renderPacketPreview);
    $("#btnPrintFromModal").addEventListener("click", printClientFromModal);
    const modalPanel = $("#modal .panel");
    modalPanel.addEventListener("input", handleModalInput);
    modalPanel.addEventListener("change", handleModalInput);

    // Backup page
    $("#btnExport").addEventListener("click", ()=> exportBackup(true));
    $("#btnExportLite").addEventListener("click", ()=> exportBackup(false));
    const importInput = $("#importFile");
    $("#btnImport").addEventListener("click", ()=> importInput.click());
    importInput.addEventListener("change", async (e)=> {
      const f = e.target.files?.[0];
      if(!f) return;
      await importBackupFile(f);
      importInput.value = "";
    });

    // Keyboard shortcuts
    window.addEventListener("keydown", (e)=>{
      if(e.key === "Escape" && state.modalOpen){ showModal(false); }
      if(e.key.toLowerCase() === "n" && !state.modalOpen){ $("#btnNew").click(); }
      if(e.key === "/" && !state.modalOpen){
        e.preventDefault();
        if(state.activeTab === "clients") $("#clientSearch").focus();
        else $("#globalSearch").focus();
      }
    });

    render();
    setTab("dashboard");
  }

  init().catch(err => {
    console.error(err);
    $("#dbStatus").textContent = "DB error";
    alert("Failed to initialize local database. Try a modern browser (Chrome/Edge).");
  });
})();

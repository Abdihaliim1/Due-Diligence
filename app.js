/**
 * ASAL Solutions LTD — Due Diligence App (Offline-first)
 * Local DB: IndexedDB (clients + files)
 * No server required.
 *
 * Updated for IRS 2025 Tax Year Requirements
 * Form 8867 Paid Preparer's Due Diligence Checklist Compliance
 * Covers: EITC, CTC/ACTC/ODC, AOTC, HOH Filing Status
 */
(() => {
  const DB_NAME = "asal_dd_db";
  const DB_VER = 2; // Updated for 2025 schema
  const STORE_CLIENTS = "clients";
  const STORE_FILES = "files";
  const SETTINGS_KEY = "asal_dd_settings_v2";

  // ========== IRS 2025 TAX YEAR CONSTANTS ==========
  const IRS_2025 = {
    TAX_YEAR: 2025,

    // EITC Income Limits (Tax Year 2025)
    EITC: {
      MAX_CREDIT: {
        0: 649,      // No qualifying children
        1: 4328,     // 1 qualifying child
        2: 7152,     // 2 qualifying children
        3: 8046      // 3+ qualifying children
      },
      INCOME_LIMITS_SINGLE: {
        0: 19104,
        1: 50434,
        2: 57310,
        3: 61555
      },
      INCOME_LIMITS_MFJ: {
        0: 26214,
        1: 57554,
        2: 64430,
        3: 68675
      },
      INVESTMENT_INCOME_LIMIT: 11950,
      MIN_AGE_NO_CHILDREN: 25,
      MAX_AGE_NO_CHILDREN: 65
    },

    // Child Tax Credit (Tax Year 2025)
    CTC: {
      MAX_CREDIT_PER_CHILD: 2200,
      ACTC_MAX_REFUNDABLE: 1700,
      ACTC_MIN_EARNED_INCOME: 2500,
      ACTC_PHASE_IN_RATE: 0.15,
      INCOME_THRESHOLD_SINGLE: 200000,
      INCOME_THRESHOLD_MFJ: 400000,
      PHASE_OUT_RATE: 50,  // $50 per $1000 over threshold
      MAX_CHILD_AGE: 16,   // Under 17 at end of year
      ODC_MAX_CREDIT: 500  // Credit for Other Dependents
    },

    // American Opportunity Tax Credit (Tax Year 2025)
    AOTC: {
      MAX_CREDIT: 2500,
      REFUNDABLE_PORTION: 0.40,  // 40% refundable up to $1000
      MAX_REFUNDABLE: 1000,
      INCOME_LIMIT_SINGLE: 90000,
      INCOME_LIMIT_MFJ: 180000,
      PHASE_OUT_START_SINGLE: 80000,
      PHASE_OUT_START_MFJ: 160000,
      MAX_YEARS: 4
    },

    // Head of Household Requirements
    HOH: {
      HOUSEHOLD_COST_THRESHOLD: 0.50  // Must pay more than 50%
    },

    // Due Diligence Penalty (Per Credit/Status)
    PENALTY_PER_FAILURE: 635,

    // Document Retention Period (Years)
    RETENTION_YEARS: 3
  };

  // Required Documents Checklist with Categories
  const REQUIRED_DOCUMENTS = {
    identity: [
      { id: "photo_id", label: "Valid Photo ID (Driver's License/State ID/Passport)", required: true },
      { id: "ssn_card", label: "Social Security Card", required: true },
      { id: "itin_letter", label: "ITIN Letter (if applicable)", required: false }
    ],
    residency: [
      { id: "lease_deed", label: "Lease Agreement or Property Deed", required: true },
      { id: "utility_bill", label: "Utility Bills (electric, gas, water)", required: true },
      { id: "bank_statement", label: "Bank Statement with Current Address", required: false },
      { id: "mail_correspondence", label: "Official Mail/Government Correspondence", required: false }
    ],
    income: [
      { id: "w2_forms", label: "W-2 Forms (all employers)", required: true },
      { id: "1099_forms", label: "1099 Forms (NEC, MISC, K, G)", required: false },
      { id: "self_emp_records", label: "Self-Employment Income Records", required: false },
      { id: "bank_deposits", label: "Bank Statements (income verification)", required: false }
    ],
    dependents: [
      { id: "birth_cert", label: "Birth Certificate", required: true },
      { id: "dep_ssn_card", label: "Dependent's Social Security Card", required: true },
      { id: "school_records", label: "School Enrollment Letter/Records", required: true },
      { id: "medical_records", label: "Medical Records with Address", required: false },
      { id: "childcare_records", label: "Childcare Provider Statement", required: false },
      { id: "custody_docs", label: "Custody Agreement/Court Order", required: false },
      { id: "form_8332", label: "Form 8332 (Release of Claim)", required: false }
    ],
    education: [
      { id: "form_1098t", label: "Form 1098-T (Tuition Statement)", required: false },
      { id: "tuition_receipts", label: "Tuition Payment Receipts", required: false },
      { id: "enrollment_letter", label: "Enrollment Verification Letter", required: false }
    ],
    hoh: [
      { id: "household_expenses", label: "Household Expense Documentation", required: false },
      { id: "qualifying_person_docs", label: "Qualifying Person Residency Proof", required: false }
    ]
  };

  const INTERVIEW_CHECKLIST = [
    { key:"relation", selector:"#d_int_chk_relation", label:"Relationship to children", applies: client => (client?.dependents?.length || 0) > 0 },
    { key:"school", selector:"#d_int_chk_school", label:"Children's school/daycare", applies: client => (client?.dependents?.length || 0) > 0 },
    { key:"childcare", selector:"#d_int_chk_childcare", label:"Childcare provider", applies: client => (client?.dependents?.length || 0) > 0 },
    { key:"custody", selector:"#d_int_chk_custody", label:"Custody situation", applies: client => (client?.dependents?.length || 0) > 0 },
    { key:"otherParent", selector:"#d_int_chk_other_parent", label:"Other parent claim details", applies: client => (client?.dependents?.length || 0) > 0 },
    { key:"income", selector:"#d_int_chk_income", label:"Income receipt method", applies: () => true },
    { key:"business", selector:"#d_int_chk_business", label:"Business description", applies: client => (client?.income?.self_employed === "Yes") },
    { key:"tracking", selector:"#d_int_chk_tracking", label:"Income & expense tracking", applies: client => (client?.income?.self_employed === "Yes") },
    { key:"eduName", selector:"#d_int_chk_edu_name", label:"Education institution", applies: client => Boolean(client?.credits_claimed?.aotc) },
    { key:"eduProgram", selector:"#d_int_chk_edu_program", label:"Program of study", applies: client => Boolean(client?.credits_claimed?.aotc) }
  ];

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

  // ---------- Client Model (IRS 2025 Compliant) ----------
  function makeEmptyClient(){
    return {
      id: uid(),
      createdAt: Date.now(),
      updatedAt: Date.now(),
      status: "draft", // draft | ready | archived
      tax_year: IRS_2025.TAX_YEAR,

      // Basic Profile
      name: "",
      phone: "",
      email: "",
      ssn_last4: "",
      ssn_valid_for_employment: "", // Yes/No - Required for credits
      dob: "",
      filing_status: "",
      address: "",
      moved_12mo: "",
      prior_address: "", // If moved, previous address
      id_type: "",
      id_exp: "",
      citizenship_status: "", // US Citizen, Resident Alien, Non-Resident Alien
      notes: "",

      // Credits Being Claimed
      credits_claimed: {
        eitc: false,
        ctc: false,
        actc: false,
        odc: false,
        aotc: false,
        hoh: false
      },

      // Dependents
      dependents: [],

      // Income (Expanded for 2025)
      income: {
        w2_employer: "",
        w2_address: "",
        w2_wages: "",
        self_employed: "",
        business_type: "",
        business_ein: "",
        gross_receipts: "",
        business_expenses: "",
        net_self_employment: "",
        other_income: "",
        investment_income: "", // Important for EITC limit
        total_earned_income: "",
        agi_estimate: "",
        income_notes: "",
        expense_notes: "",
        prior_year_earned_income: "", // For prior year election
        use_prior_year_income: "" // Yes/No
      },

      // Document Checklist (with verification ticks)
      documents: {
        identity: {},
        residency: {},
        income: {},
        dependents: {},
        education: {},
        hoh: {}
      },

      // Form 8867 Due Diligence Questions (IRS 2025)
      ddq: {
        // Part I - Due Diligence Requirements (All Credits)
        completed_worksheets: "",           // Line 2
        info_appears_incorrect: "",         // Line 3
        made_reasonable_inquiries: "",      // Line 4
        documented_inquiries: "",           // Line 5
        advised_irs_may_request_docs: "",   // Line 6
        form_8862_required: "",             // Line 7
        form_8862_attached: "",             // Line 7 follow-up

        // Part II - EITC Questions
        eitc_eligible: "",
        eitc_qualifying_child: "",          // Line 9a
        eitc_tiebreaker_applies: "",        // Line 9c
        eitc_age_requirement_met: "",       // For no qualifying children
        eitc_residency_verified: "",
        eitc_relationship_verified: "",

        // Part III - CTC/ACTC/ODC Questions
        ctc_qualifying_child: "",
        ctc_child_age_verified: "",         // Under 17
        ctc_ssn_valid: "",                  // Valid for employment SSN
        ctc_citizenship_verified: "",
        ctc_residency_verified: "",
        ctc_support_test_met: "",
        form_8332_applies: "",              // Line 12
        form_8332_attached: "",

        // Part IV - AOTC Questions
        aotc_eligible_student: "",          // Line 13
        aotc_first_4_years: "",
        aotc_enrollment_status: "",         // At least half-time
        aotc_felony_drug: "",               // No felony drug conviction
        aotc_expenses_verified: "",
        aotc_form_1098t_received: "",

        // Part V - HOH Questions
        hoh_unmarried_verified: "",         // Line 14
        hoh_qualifying_person: "",
        hoh_paid_over_half: "",             // More than 50% household costs
        hoh_qualifying_person_lived: "",    // More than half year

        // Self-Employment Verification
        schedule_c_required: "",            // Line 8
        self_emp_income_verified: "",
        self_emp_expenses_verified: "",
        self_emp_records_adequate: "",

        // Knowledge-Based Interview Questions
        interview: {
          how_children_related: "",
          where_children_attend_school: "",
          who_provides_childcare: "",
          child_custody_situation: "",
          other_parent_claiming: "",
          how_income_received: "",
          business_description: "",
          typical_work_week: "",
          how_expenses_tracked: "",
          education_institution_name: "",
          education_program_type: "",
          education_payment_method: ""
        },

        // Legacy fields (for backward compatibility)
        child_lived_half_year: "",
        anyone_else_claim: "",
        pays_household_costs: "",
        missing_ids: "",
        docs: "",
        preparer_notes: "",

        // Preparer Certification
        preparer_satisfied_requirements: "",
        preparer_certification_date: "",
        knowledge_requirement_met: ""
      }
    };
  }

  function computeFlags(c){
    const flags = [];
    const ddq = c.ddq || {};
    const deps = c.dependents || [];
    const credits = c.credits_claimed || {};
    const income = c.income || {};
    const docs = c.documents || {};

    // ========== CRITICAL FLAGS (Blocks Print) ==========

    // Missing core profile fields
    const missingCore = !c.name || !c.filing_status || (!c.phone && !c.email);
    if(missingCore) flags.push({type:"bad", text:"Missing core profile fields (name/filing status/contact)"});

    // Missing SSN validation for employment
    if(!c.ssn_valid_for_employment || c.ssn_valid_for_employment === "No") {
      if(credits.eitc || credits.ctc || credits.actc) {
        flags.push({type:"bad", text:"SSN must be valid for employment to claim EITC/CTC/ACTC"});
      }
    }

    // Missing dependent SSN/ITIN
    if(ddq.missing_ids === "Yes") {
      flags.push({type:"bad", text:"Missing dependent SSN/ITIN — high risk / cannot finalize until resolved"});
    }

    // Dependent SSN not valid for employment (CTC requirement)
    if(credits.ctc || credits.actc) {
      const depsWithInvalidSSN = deps.filter(d => d.ssn_valid_for_employment !== "Yes");
      if(depsWithInvalidSSN.length > 0) {
        flags.push({type:"bad", text:`${depsWithInvalidSSN.length} dependent(s) need valid-for-employment SSN for CTC/ACTC`});
      }
    }

    // Form 8862 required but not attached
    if(ddq.form_8862_required === "Yes" && ddq.form_8862_attached !== "Yes") {
      flags.push({type:"bad", text:"Form 8862 required (prior denial) but not attached"});
    }

    // HOH but filing status doesn't match
    if(credits.hoh && c.filing_status !== "Head of Household") {
      flags.push({type:"bad", text:"HOH credit claimed but filing status is not Head of Household"});
    }

    // ========== WARNING FLAGS (Review Required) ==========

    // "Not sure" answers need follow-up
    const legacyUnsure = [ddq.child_lived_half_year, ddq.anyone_else_claim, ddq.pays_household_costs, ddq.missing_ids]
      .some(v => (v||"").toLowerCase() === "not sure");
    if(legacyUnsure) {
      flags.push({type:"warn", text:"Some due diligence answers are 'Not sure' — additional verification needed"});
    }

    // Dependent issues (incomplete info or residency < 7 months)
    const depIssues = deps.some(d => {
      const ml = parseInt(d.months_lived || "0", 10);
      return (!d.name || !d.relationship || !d.dob || isNaN(ml) || ml < 7);
    });
    if(depIssues) {
      flags.push({type:"warn", text:"Dependent details incomplete or residency < 7 months (Form 8867 Line 9)"});
    }

    // CTC age verification - child must be under 17
    if(credits.ctc || credits.actc) {
      const overAgeChildren = deps.filter(d => {
        if(!d.dob) return false;
        const age = calculateAge(d.dob);
        return age > IRS_2025.CTC.MAX_CHILD_AGE;
      });
      if(overAgeChildren.length > 0) {
        flags.push({type:"warn", text:`${overAgeChildren.length} dependent(s) age 17+ — not eligible for CTC (may qualify for ODC)`});
      }
    }

    // Tiebreaker rules apply
    if(ddq.anyone_else_claim === "Yes" || ddq.eitc_tiebreaker_applies === "Yes") {
      flags.push({type:"warn", text:"Tiebreaker rules may apply — document why this taxpayer has priority claim"});
    }

    // Investment income exceeds EITC limit
    if(credits.eitc) {
      const investmentIncome = parseFloat(income.investment_income || "0");
      if(investmentIncome > IRS_2025.EITC.INVESTMENT_INCOME_LIMIT) {
        flags.push({type:"bad", text:`Investment income $${investmentIncome.toLocaleString()} exceeds EITC limit of $${IRS_2025.EITC.INVESTMENT_INCOME_LIMIT.toLocaleString()}`});
      }
    }

    // Self-employment verification
    if((income.self_employed||"") === "Yes") {
      if(!(income.income_notes||"").trim()) {
        flags.push({type:"warn", text:"Self-employed: income verification notes are blank (Form 8867 Line 8)"});
      }
      if(!(income.expense_notes||"").trim()) {
        flags.push({type:"warn", text:"Self-employed: expense verification notes are blank"});
      }
      if(ddq.schedule_c_required === "Yes" && ddq.self_emp_records_adequate !== "Yes") {
        flags.push({type:"warn", text:"Schedule C required but records adequacy not confirmed"});
      }
    }

    // AOTC verification
    if(credits.aotc) {
      if(ddq.aotc_form_1098t_received !== "Yes") {
        flags.push({type:"warn", text:"AOTC claimed but Form 1098-T not confirmed (Form 8867 Line 13)"});
      }
      if(ddq.aotc_first_4_years !== "Yes") {
        flags.push({type:"warn", text:"AOTC: verify student has not claimed credit for 4 prior years"});
      }
      if(ddq.aotc_felony_drug === "Yes") {
        flags.push({type:"bad", text:"AOTC disqualified: felony drug conviction at end of tax year"});
      }
    }

    // HOH verification
    if(credits.hoh || c.filing_status === "Head of Household") {
      if(ddq.hoh_paid_over_half !== "Yes") {
        flags.push({type:"warn", text:"HOH: must pay more than half of household costs (Form 8867 Line 14)"});
      }
      if(ddq.hoh_qualifying_person_lived !== "Yes") {
        flags.push({type:"warn", text:"HOH: qualifying person must live with taxpayer more than half the year"});
      }
    }

    // Document checklist verification
    const docCount = countVerifiedDocuments(docs, c);
    if(docCount < 3) {
      flags.push({type:"warn", text:`Only ${docCount} documents verified — minimum documentation may be insufficient`});
    }

    // Legacy documents field check
    const missingLegacyDocs = !ddq.docs || ddq.docs.trim().length < 6;
    if(missingLegacyDocs && docCount === 0) {
      flags.push({type:"warn", text:"Documents checklist is empty — use document verification section"});
    }

    // Knowledge requirement verification
    if(ddq.knowledge_requirement_met !== "Yes") {
      flags.push({type:"warn", text:"Knowledge requirement not confirmed — complete interview questions"});
    }

    // Preparer certification
    if(ddq.preparer_satisfied_requirements !== "Yes") {
      flags.push({type:"warn", text:"Preparer has not certified due diligence requirements met"});
    }

    // Info appears incorrect/inconsistent
    if(ddq.info_appears_incorrect === "Yes") {
      flags.push({type:"bad", text:"Information appears incorrect or inconsistent — do not file until resolved"});
    }

    const interviewStats = getInterviewCheckStats(c);
    if(interviewStats.ticked < interviewStats.total){
      const snippet = interviewStats.missing.slice(0,3).join(", ");
      const more = interviewStats.missing.length > 3 ? ` +${interviewStats.missing.length - 3} more` : "";
      flags.push({
        type:"warn",
        text:`Interview ticks incomplete: ${snippet || `${interviewStats.total - interviewStats.ticked} questions`}${more}`
      });
    }

    return flags;
  }

  // Helper function to calculate age from DOB
  function calculateAge(dob) {
    if(!dob) return 0;
    const birthDate = new Date(dob);
    const today = new Date();
    const endOfYear = new Date(IRS_2025.TAX_YEAR, 11, 31); // Dec 31 of tax year
    let age = endOfYear.getFullYear() - birthDate.getFullYear();
    const monthDiff = endOfYear.getMonth() - birthDate.getMonth();
    if(monthDiff < 0 || (monthDiff === 0 && endOfYear.getDate() < birthDate.getDate())) {
      age--;
    }
    return age;
  }

  // Helper function to count verified documents
  function countVerifiedDocuments(docs, client){
    if(!docs) return 0;
    let count = 0;
    for(const [category, values] of Object.entries(docs)){
      if(!isCategoryApplicable(client, category)) continue;
      if(typeof values === "object"){
        for(const verified of Object.values(values)){
          if(verified === true || verified === "Yes") count++;
        }
      }
    }
    return count;
  }

  function isCategoryApplicable(client, category){
    if(category === "dependents"){
      return (client?.dependents?.length || 0) > 0;
    }
    if(category === "education"){
      return Boolean(client?.credits_claimed?.aotc);
    }
    if(category === "hoh"){
      return Boolean(client?.credits_claimed?.hoh) || client?.filing_status === "Head of Household";
    }
    return true;
  }

  function summarizeDocuments(client){
    const docs = client?.documents || {};
    let total = 0;
    let verified = 0;
    const missingRequired = [];
    for(const [category, items] of Object.entries(REQUIRED_DOCUMENTS)){
      if(!isCategoryApplicable(client, category)) continue;
      const catDocs = docs[category] || {};
      for(const item of items){
        total++;
        if(catDocs[item.id]) verified++;
        else if(item.required){
          missingRequired.push(`${prettyCategoryName(category)} • ${item.label}`);
        }
      }
    }
    return { total, verified, missingRequired };
  }

  function aggregateDocStats(clients){
    if(!clients.length) return { percent: 0, missingClients: 0 };
    let total = 0;
    let verified = 0;
    let missingClients = 0;
    for(const client of clients){
      const summary = summarizeDocuments(client);
      total += summary.total;
      verified += summary.verified;
      if(summary.missingRequired.length) missingClients++;
    }
    const percent = total ? Math.round((verified / total) * 100) : 0;
    return { percent, missingClients };
  }

  function prettyCategoryName(value){
    return String(value)
      .split(/[_\s]+/)
      .map(part => part.charAt(0).toUpperCase() + part.slice(1))
      .join(" ");
  }

  function getInterviewCheckStats(client){
    const checks = client?.ddq?.interviewChecks || {};
    const applicable = INTERVIEW_CHECKLIST.filter(item => (item.applies?.(client || {}) ?? true));
    const total = applicable.length;
    const ticked = applicable.filter(item => !!checks[item.key]).length;
    const missing = applicable.filter(item => !checks[item.key]).map(item => item.label);
    return { total, ticked, missing };
  }

  function aggregateInterviewStats(clients){
    if(!clients.length) return { percent: 0, missingClients: 0 };
    let total = 0;
    let ticked = 0;
    let missingClients = 0;
    for(const client of clients){
      const stats = getInterviewCheckStats(client);
      total += stats.total;
      ticked += stats.ticked;
      if(stats.ticked < stats.total) missingClients++;
    }
    const percent = total ? Math.round((ticked / total) * 100) : 0;
    return { percent, missingClients };
  }

  function computeDocNeed(c){
    const ddq = c.ddq || {};
    const has = (ddq.docs||"").trim().length >= 6;
    return !has;
  }

  function isReadyToPrint(c){
    const flags = computeFlags(c);
    const interviewStats = getInterviewCheckStats(c);
    const interviewMissingSnippet = interviewStats.missing.length
      ? `Missing: ${interviewStats.missing.slice(0,3).join(", ")}${interviewStats.missing.length > 3 ? ` +${interviewStats.missing.length - 3} more` : ""}`
      : "All questions ticked";
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
    const totalClients = state.clients.length;
    const drafts = state.clients.filter(c => c.status === "draft").length;
    const needsDocs = state.clients.filter(c => computeDocNeed(c)).length;
    const readyClients = state.clients.filter(c => isReadyToPrint(c)).length;

    // Credits counts
    const eitcCount = state.clients.filter(c => c.credits_claimed?.eitc).length;
    const ctcCount = state.clients.filter(c => c.credits_claimed?.ctc || c.credits_claimed?.actc).length;
    const aotcCount = state.clients.filter(c => c.credits_claimed?.aotc).length;
    const hohCount = state.clients.filter(c => c.credits_claimed?.hoh).length;
    const totalCredits = eitcCount + ctcCount + aotcCount + hohCount;

    // Update KPI cards
    $("#kpiClients").textContent = totalClients;
    $("#kpiDrafts").textContent = drafts;
    $("#kpiNeedsDocs").textContent = needsDocs;

    // Ready clients
    const kpiReady = $("#kpiReady");
    if(kpiReady) kpiReady.textContent = readyClients;
    const kpiReadyBar = $("#kpiReadyBar");
    if(kpiReadyBar && totalClients > 0) {
      kpiReadyBar.style.width = Math.round((readyClients / totalClients) * 100) + "%";
    }

    // Credits KPI
    const kpiCredits = $("#kpiCredits");
    if(kpiCredits) kpiCredits.textContent = totalCredits;

    // files count
    const files = await idbGetAll(state.db, STORE_FILES);
    $("#kpiFiles").textContent = files.length;

    // Credits breakdown
    const maxCredits = Math.max(eitcCount, ctcCount, aotcCount, hohCount, 1);

    const creditEitc = $("#creditEitc");
    if(creditEitc) creditEitc.textContent = eitcCount;
    const creditEitcBar = $("#creditEitcBar");
    if(creditEitcBar) creditEitcBar.style.width = Math.round((eitcCount / maxCredits) * 100) + "%";

    const creditCtc = $("#creditCtc");
    if(creditCtc) creditCtc.textContent = ctcCount;
    const creditCtcBar = $("#creditCtcBar");
    if(creditCtcBar) creditCtcBar.style.width = Math.round((ctcCount / maxCredits) * 100) + "%";

    const creditAotc = $("#creditAotc");
    if(creditAotc) creditAotc.textContent = aotcCount;
    const creditAotcBar = $("#creditAotcBar");
    if(creditAotcBar) creditAotcBar.style.width = Math.round((aotcCount / maxCredits) * 100) + "%";

    const creditHoh = $("#creditHoh");
    if(creditHoh) creditHoh.textContent = hohCount;
    const creditHohBar = $("#creditHohBar");
    if(creditHohBar) creditHohBar.style.width = Math.round((hohCount / maxCredits) * 100) + "%";

    // recent list with modern card style
    const recent = [...state.clients].sort((a,b)=> (b.updatedAt||0)-(a.updatedAt||0)).slice(0,5);
    $("#recentList").innerHTML = recent.length ? recent.map(c => {
      const initials = getInitials(c.name || "?");
      const flags = computeFlags(c);
      const flagCount = flags.length;
      const statusBadge = isReadyToPrint(c)
        ? '<span class="badge ok">Ready</span>'
        : '<span class="badge warn">Draft</span>';
      const creditBadges = [];
      if(c.credits_claimed?.eitc) creditBadges.push('<span class="irs-badge eitc">EITC</span>');
      if(c.credits_claimed?.ctc || c.credits_claimed?.actc) creditBadges.push('<span class="irs-badge ctc">CTC</span>');
      if(c.credits_claimed?.aotc) creditBadges.push('<span class="irs-badge aotc">AOTC</span>');
      if(c.credits_claimed?.hoh) creditBadges.push('<span class="irs-badge hoh">HOH</span>');

      return `
        <div class="recent-client" data-open="${c.id}">
          <div class="client-info">
            <div class="client-avatar">${escapeHtml(initials)}</div>
            <div class="client-details">
              <h4>${escapeHtml(c.name || "(Unnamed)")}</h4>
              <div class="client-meta">
                ${escapeHtml(c.filing_status || "—")} • ${(c.dependents||[]).length} dependents
                ${creditBadges.length ? '<br>' + creditBadges.join(' ') : ''}
              </div>
            </div>
          </div>
          <div class="client-status">
            ${statusBadge}
            ${flagCount > 0 ? `<span class="badge bad">${flagCount} flags</span>` : ''}
          </div>
        </div>
      `;
    }).join("") : `
      <div class="empty-state">
        <div class="empty-icon">👥</div>
        <h4>No clients yet</h4>
        <p>Click "New Client" to get started</p>
      </div>
    `;

    $$("#recentList [data-open]").forEach(el=>{
      el.onclick = () => openClient(el.dataset.open);
      el.style.cursor = "pointer";
    });

    // Dashboard alerts
    renderDashboardAlerts();

    // clients table
    renderClientTable();

    // backup health
    $("#healthClients").textContent = state.clients.length;
    $("#healthFiles").textContent = files.length;
    $("#healthVer").textContent = DB_VER;

    // settings
    $("#officeHeader").value = state.officeHeader;
    updateDashboardDiligencePanel(state.clients);
  }

  function updateDashboardDiligencePanel(clients){
    const docStats = aggregateDocStats(clients);
    const interviewStats = aggregateInterviewStats(clients);
    const docValue = $("#docCoverageValue");
    if(docValue) docValue.textContent = `${docStats.percent}% verified`;
    const docBar = $("#docCoverageBar");
    if(docBar) docBar.style.width = `${docStats.percent}%`;
    const docMissing = $("#docMissingClients");
    if(docMissing){
      docMissing.textContent = clients.length
        ? docStats.missingClients ? `${docStats.missingClients} client(s) missing required docs` : "Required docs verified for all clients"
        : "No clients yet";
    }
    const interviewValue = $("#interviewCoverageValue");
    if(interviewValue) interviewValue.textContent = `${interviewStats.percent}% complete`;
    const interviewBar = $("#interviewCoverageBar");
    if(interviewBar) interviewBar.style.width = `${interviewStats.percent}%`;
    const interviewMissing = $("#interviewMissingClients");
    if(interviewMissing){
      interviewMissing.textContent = clients.length
        ? interviewStats.missingClients ? `${interviewStats.missingClients} client(s) need interview ticks` : "Interview checks recorded for everyone"
        : "No clients yet";
    }
  }

  function getInitials(name){
    if(!name) return "?";
    const parts = name.trim().split(/\s+/);
    if(parts.length >= 2){
      return (parts[0][0] + parts[parts.length-1][0]).toUpperCase();
    }
    return name.slice(0,2).toUpperCase();
  }

  function renderDashboardAlerts(){
    const alertsContainer = $("#dashboardAlerts");
    const alertsList = $("#alertsList");
    if(!alertsContainer || !alertsList) return;

    const alerts = [];

    // Check for clients needing immediate attention
    const flaggedClients = state.clients.filter(c => {
      const flags = computeFlags(c);
      return flags.filter(f => f.type === "bad").length > 0;
    });

    if(flaggedClients.length > 0){
      alerts.push({
        type: "danger",
        icon: "⚠️",
        title: `${flaggedClients.length} client(s) with critical flags`,
        message: "These clients have issues that must be resolved before filing."
      });
    }

    // Check for missing documents
    const missingDocsClients = state.clients.filter(c => computeDocNeed(c));
    if(missingDocsClients.length > 0){
      alerts.push({
        type: "warning",
        icon: "📄",
        title: `${missingDocsClients.length} client(s) need documents`,
        message: "Required documents are missing for due diligence compliance."
      });
    }

    // Check for clients without credits selected
    const noCredits = state.clients.filter(c => {
      const cc = c.credits_claimed || {};
      return !cc.eitc && !cc.ctc && !cc.actc && !cc.odc && !cc.aotc && !cc.hoh;
    });
    if(noCredits.length > 0 && state.clients.length > 0){
      alerts.push({
        type: "info",
        icon: "💡",
        title: `${noCredits.length} client(s) have no credits selected`,
        message: "Review these clients to determine eligible tax credits."
      });
    }

    if(alerts.length > 0){
      alertsContainer.style.display = "";
      alertsList.innerHTML = alerts.map(a => `
        <div class="alert-item alert-${a.type}">
          <div class="alert-icon">${a.icon}</div>
          <div class="alert-content">
            <h4>${escapeHtml(a.title)}</h4>
            <p>${escapeHtml(a.message)}</p>
          </div>
        </div>
      `).join("");
    } else {
      alertsContainer.style.display = "none";
    }
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

    // Basic Profile
    $("#f_name").value = c.name || "";
    $("#f_phone").value = c.phone || "";
    $("#f_email").value = c.email || "";
    $("#f_ssn").value = c.ssn_last4 || "";
    if($("#f_ssn_valid")) $("#f_ssn_valid").value = c.ssn_valid_for_employment || "";
    $("#f_dob").value = c.dob || "";
    if($("#f_citizenship")) $("#f_citizenship").value = c.citizenship_status || "";
    $("#f_filing").value = c.filing_status || "";
    $("#f_address").value = c.address || "";
    $("#f_moved").value = c.moved_12mo || "";
    if($("#f_prior_address")) $("#f_prior_address").value = c.prior_address || "";
    $("#f_idtype").value = c.id_type || "";
    $("#f_idexp").value = c.id_exp || "";
    $("#f_notes").value = c.notes || "";

    // Credits Claimed
    const credits = c.credits_claimed || {};
    if($("#credit_eitc")) $("#credit_eitc").checked = !!credits.eitc;
    if($("#credit_ctc")) $("#credit_ctc").checked = !!credits.ctc;
    if($("#credit_actc")) $("#credit_actc").checked = !!credits.actc;
    if($("#credit_odc")) $("#credit_odc").checked = !!credits.odc;
    if($("#credit_aotc")) $("#credit_aotc").checked = !!credits.aotc;
    if($("#credit_hoh")) $("#credit_hoh").checked = !!credits.hoh;

    // Income
    $("#i_w2employer").value = c.income?.w2_employer || "";
    $("#i_w2addr").value = c.income?.w2_address || "";
    $("#i_self").value = c.income?.self_employed || "";
    $("#i_bus").value = c.income?.business_type || "";
    $("#i_income_notes").value = c.income?.income_notes || "";
    $("#i_exp_notes").value = c.income?.expense_notes || "";

    // Legacy DDQ fields
    $("#d_child_half").value = c.ddq?.child_lived_half_year || "";
    $("#d_else_claim").value = c.ddq?.anyone_else_claim || "";
    $("#d_house_costs").value = c.ddq?.pays_household_costs || "";
    $("#d_missing_ids").value = c.ddq?.missing_ids || "";
    $("#d_docs").value = c.ddq?.docs || "";
    $("#d_notes").value = c.ddq?.preparer_notes || "";

    // IRS 2025 Form 8867 DDQ Fields - Part I
    setSelectValue("#d_completed_worksheets", c.ddq?.completed_worksheets);
    setSelectValue("#d_info_incorrect", c.ddq?.info_appears_incorrect);
    setSelectValue("#d_reasonable_inquiries", c.ddq?.made_reasonable_inquiries);
    setSelectValue("#d_documented_inquiries", c.ddq?.documented_inquiries);
    setSelectValue("#d_advised_irs", c.ddq?.advised_irs_may_request_docs);
    setSelectValue("#d_form_8862_required", c.ddq?.form_8862_required);
    setSelectValue("#d_form_8862_attached", c.ddq?.form_8862_attached);
    setSelectValue("#d_schedule_c_required", c.ddq?.schedule_c_required);

    // Part II - EITC
    setSelectValue("#d_eitc_eligible", c.ddq?.eitc_eligible);
    setSelectValue("#d_eitc_qualifying_child", c.ddq?.eitc_qualifying_child);
    setSelectValue("#d_eitc_tiebreaker", c.ddq?.eitc_tiebreaker_applies);
    setSelectValue("#d_eitc_age_met", c.ddq?.eitc_age_requirement_met);
    setSelectValue("#d_eitc_residency", c.ddq?.eitc_residency_verified);
    setSelectValue("#d_eitc_relationship", c.ddq?.eitc_relationship_verified);

    // Part III - CTC/ACTC/ODC
    setSelectValue("#d_ctc_qualifying_child", c.ddq?.ctc_qualifying_child);
    setSelectValue("#d_ctc_age_verified", c.ddq?.ctc_child_age_verified);
    setSelectValue("#d_ctc_ssn_valid", c.ddq?.ctc_ssn_valid);
    setSelectValue("#d_ctc_citizenship", c.ddq?.ctc_citizenship_verified);
    setSelectValue("#d_ctc_residency", c.ddq?.ctc_residency_verified);
    setSelectValue("#d_ctc_support", c.ddq?.ctc_support_test_met);
    setSelectValue("#d_form_8332_applies", c.ddq?.form_8332_applies);
    setSelectValue("#d_form_8332_attached", c.ddq?.form_8332_attached);

    // Part IV - AOTC
    setSelectValue("#d_aotc_eligible", c.ddq?.aotc_eligible_student);
    setSelectValue("#d_aotc_first_4_years", c.ddq?.aotc_first_4_years);
    setSelectValue("#d_aotc_enrollment", c.ddq?.aotc_enrollment_status);
    setSelectValue("#d_aotc_felony", c.ddq?.aotc_felony_drug);
    setSelectValue("#d_aotc_expenses", c.ddq?.aotc_expenses_verified);
    setSelectValue("#d_aotc_1098t", c.ddq?.aotc_form_1098t_received);

    // Part V - HOH
    setSelectValue("#d_hoh_unmarried", c.ddq?.hoh_unmarried_verified);
    setSelectValue("#d_hoh_qualifying_person", c.ddq?.hoh_qualifying_person);
    setSelectValue("#d_hoh_paid_half", c.ddq?.hoh_paid_over_half);
    setSelectValue("#d_hoh_lived", c.ddq?.hoh_qualifying_person_lived);

    // Self-Employment Verification
    setSelectValue("#d_self_emp_income", c.ddq?.self_emp_income_verified);
    setSelectValue("#d_self_emp_expenses", c.ddq?.self_emp_expenses_verified);
    setSelectValue("#d_self_emp_records", c.ddq?.self_emp_records_adequate);

    // Knowledge-Based Interview
    const interview = c.ddq?.interview || {};
    setTextareaValue("#d_int_relation", interview.how_children_related);
    setTextareaValue("#d_int_school", interview.where_children_attend_school);
    setTextareaValue("#d_int_childcare", interview.who_provides_childcare);
    setTextareaValue("#d_int_custody", interview.child_custody_situation);
    setTextareaValue("#d_int_other_parent", interview.other_parent_claiming);
    setTextareaValue("#d_int_income", interview.how_income_received);
    setTextareaValue("#d_int_business", interview.business_description);
    setTextareaValue("#d_int_tracking", interview.how_expenses_tracked);
    setInputValue("#d_int_edu_name", interview.education_institution_name);
    setInputValue("#d_int_edu_program", interview.education_program_type);

    // Preparer Certification
    setSelectValue("#d_preparer_satisfied", c.ddq?.preparer_satisfied_requirements);
    setSelectValue("#d_knowledge_met", c.ddq?.knowledge_requirement_met);
    setInputValue("#d_cert_date", c.ddq?.preparer_certification_date);

    // Document Checklist
    fillDocumentChecklist(c.documents || {});
    fillInterviewChecks(c);

    $("#packetStatus").textContent = "Not generated";
    $("#packetPreview").innerHTML = "Generate a packet to preview here.";
    renderChecklist();
    renderHistory();
    updateSaveIndicators();
    updateDocumentCounts();
    toggleCreditSections();
  }

  // Helper functions for filling form fields
  function setSelectValue(selector, value) {
    const el = $(selector);
    if(el) el.value = value || "";
  }
  function setInputValue(selector, value) {
    const el = $(selector);
    if(el) el.value = value || "";
  }
  function setTextareaValue(selector, value) {
    const el = $(selector);
    if(el) el.value = value || "";
  }

  function fillDocumentChecklist(docs) {
    // Identity documents
    setCheckbox("#doc_photo_id", docs.identity?.photo_id);
    setCheckbox("#doc_ssn_card", docs.identity?.ssn_card);
    setCheckbox("#doc_itin_letter", docs.identity?.itin_letter);

    // Residency documents
    setCheckbox("#doc_lease_deed", docs.residency?.lease_deed);
    setCheckbox("#doc_utility_bill", docs.residency?.utility_bill);
    setCheckbox("#doc_bank_statement", docs.residency?.bank_statement);
    setCheckbox("#doc_mail", docs.residency?.mail_correspondence);

    // Income documents
    setCheckbox("#doc_w2_forms", docs.income?.w2_forms);
    setCheckbox("#doc_1099_forms", docs.income?.["1099_forms"]);
    setCheckbox("#doc_self_emp_records", docs.income?.self_emp_records);
    setCheckbox("#doc_bank_deposits", docs.income?.bank_deposits);

    // Dependent documents
    setCheckbox("#doc_birth_cert", docs.dependents?.birth_cert);
    setCheckbox("#doc_dep_ssn_card", docs.dependents?.dep_ssn_card);
    setCheckbox("#doc_school_records", docs.dependents?.school_records);
    setCheckbox("#doc_medical_records", docs.dependents?.medical_records);
    setCheckbox("#doc_childcare_records", docs.dependents?.childcare_records);
    setCheckbox("#doc_custody_docs", docs.dependents?.custody_docs);
    setCheckbox("#doc_form_8332", docs.dependents?.form_8332);

    // Education documents
    setCheckbox("#doc_form_1098t", docs.education?.form_1098t);
    setCheckbox("#doc_tuition_receipts", docs.education?.tuition_receipts);
    setCheckbox("#doc_enrollment_letter", docs.education?.enrollment_letter);

    // HOH documents
    setCheckbox("#doc_household_expenses", docs.hoh?.household_expenses);
    setCheckbox("#doc_qualifying_person", docs.hoh?.qualifying_person_docs);
  }

  function setCheckbox(selector, value) {
    const el = $(selector);
    if(el) el.checked = !!value;
  }

  function renderDocTickSummary(){
    const box = $("#docTickSummary");
    if(!box) return;
    const docs = readDocumentChecklist();
    const client = state.activeClient || {};
    const rows = Object.entries(REQUIRED_DOCUMENTS).map(([category, items]) => {
      const applicable = isCategoryApplicable(client, category);
      const verified = items.filter(item => docs[category]?.[item.id]).length;
      const countClass = applicable ? "doc-tick-count" : "doc-tick-count muted";
      const countText = applicable ? `${verified}/${items.length} ✓` : "Not required";
      return `
        <div class="doc-tick-row">
          <span class="doc-cat">${prettyCategoryName(category)}</span>
          <span class="${countClass}">${countText}</span>
        </div>
      `;
    }).join("");
    box.innerHTML = rows || "<div class='small muted'>Document ticks will appear here.</div>";
  }

  function fillInterviewChecks(client){
    const checks = client?.ddq?.interviewChecks || {};
    INTERVIEW_CHECKLIST.forEach(check => {
      setCheckbox(check.selector, !!checks[check.key]);
    });
  }

  function updateDocumentCounts() {
    const allChecks = $$(".doc-check");
    const verified = allChecks.filter(c => c.checked).length;
    const required = $$(".doc-item .badge.warn").length;
    const requiredChecked = $$(".doc-item").filter(item => {
      const hasRequired = item.querySelector(".badge.warn");
      const checkbox = item.querySelector(".doc-check");
      return hasRequired && checkbox && checkbox.checked;
    }).length;

    if($("#verifiedCount")) $("#verifiedCount").textContent = verified;
    if($("#requiredCount")) $("#requiredCount").textContent = required;
    if($("#pendingCount")) $("#pendingCount").textContent = required - requiredChecked;

    renderDocTickSummary();
  }

  // Toggle visibility of credit-specific DDQ sections and interview fields
  function toggleCreditSections() {
    const eitc = getCheckboxValue("#credit_eitc");
    const ctc = getCheckboxValue("#credit_ctc");
    const actc = getCheckboxValue("#credit_actc");
    const aotc = getCheckboxValue("#credit_aotc");
    const hoh = getCheckboxValue("#credit_hoh");
    const selfEmp = $("#i_self")?.value === "Yes";

    // Show/hide EITC section (always show for visibility, just highlight)
    const eitcSection = $("#ddq_eitc_section");
    if(eitcSection) eitcSection.style.opacity = eitc ? "1" : "0.5";

    // Show/hide CTC section
    const ctcSection = $("#ddq_ctc_section");
    if(ctcSection) ctcSection.style.opacity = (ctc || actc) ? "1" : "0.5";

    // Show/hide AOTC section
    const aotcSection = $("#ddq_aotc_section");
    if(aotcSection) aotcSection.style.opacity = aotc ? "1" : "0.5";

    // Show/hide HOH section
    const hohSection = $("#ddq_hoh_section");
    if(hohSection) hohSection.style.opacity = hoh ? "1" : "0.5";

    // Show/hide self-employment interview section
    const selfEmpInterview = $("#self_emp_interview");
    if(selfEmpInterview) selfEmpInterview.style.display = selfEmp ? "grid" : "none";

    // Show/hide education interview section
    const eduInterview = $("#education_interview");
    if(eduInterview) eduInterview.style.display = aotc ? "grid" : "none";

    // Show/hide education documents section
    const eduDocsSection = $("#education_docs_section");
    if(eduDocsSection) eduDocsSection.style.display = aotc ? "block" : "none";

    // Show/hide HOH documents section
    const hohDocsSection = $("#hoh_docs_section");
    if(hohDocsSection) hohDocsSection.style.display = hoh ? "block" : "none";
  }

  function readModalIntoClient(c){
    // Basic Profile
    c.name = $("#f_name").value.trim();
    c.phone = $("#f_phone").value.trim();
    c.email = $("#f_email").value.trim();
    c.ssn_last4 = $("#f_ssn").value.trim();
    c.ssn_valid_for_employment = getSelectValue("#f_ssn_valid");
    c.dob = $("#f_dob").value;
    c.citizenship_status = getSelectValue("#f_citizenship");
    c.filing_status = $("#f_filing").value;
    c.address = $("#f_address").value.trim();
    c.moved_12mo = $("#f_moved").value;
    c.prior_address = getInputValue("#f_prior_address");
    c.id_type = $("#f_idtype").value;
    c.id_exp = $("#f_idexp").value;
    c.notes = $("#f_notes").value.trim();

    // Credits Claimed
    c.credits_claimed = c.credits_claimed || {};
    c.credits_claimed.eitc = getCheckboxValue("#credit_eitc");
    c.credits_claimed.ctc = getCheckboxValue("#credit_ctc");
    c.credits_claimed.actc = getCheckboxValue("#credit_actc");
    c.credits_claimed.odc = getCheckboxValue("#credit_odc");
    c.credits_claimed.aotc = getCheckboxValue("#credit_aotc");
    c.credits_claimed.hoh = getCheckboxValue("#credit_hoh");

    // Income
    c.income = c.income || {};
    c.income.w2_employer = $("#i_w2employer").value.trim();
    c.income.w2_address = $("#i_w2addr").value.trim();
    c.income.self_employed = $("#i_self").value;
    c.income.business_type = $("#i_bus").value.trim();
    c.income.income_notes = $("#i_income_notes").value.trim();
    c.income.expense_notes = $("#i_exp_notes").value.trim();

    // DDQ - Initialize
    c.ddq = c.ddq || {};

    // Legacy DDQ fields
    c.ddq.child_lived_half_year = $("#d_child_half").value;
    c.ddq.anyone_else_claim = $("#d_else_claim").value;
    c.ddq.pays_household_costs = $("#d_house_costs").value;
    c.ddq.missing_ids = $("#d_missing_ids").value;
    c.ddq.docs = $("#d_docs").value.trim();
    c.ddq.preparer_notes = $("#d_notes").value.trim();

    // IRS 2025 Form 8867 DDQ Fields - Part I
    c.ddq.completed_worksheets = getSelectValue("#d_completed_worksheets");
    c.ddq.info_appears_incorrect = getSelectValue("#d_info_incorrect");
    c.ddq.made_reasonable_inquiries = getSelectValue("#d_reasonable_inquiries");
    c.ddq.documented_inquiries = getSelectValue("#d_documented_inquiries");
    c.ddq.advised_irs_may_request_docs = getSelectValue("#d_advised_irs");
    c.ddq.form_8862_required = getSelectValue("#d_form_8862_required");
    c.ddq.form_8862_attached = getSelectValue("#d_form_8862_attached");
    c.ddq.schedule_c_required = getSelectValue("#d_schedule_c_required");

    // Part II - EITC
    c.ddq.eitc_eligible = getSelectValue("#d_eitc_eligible");
    c.ddq.eitc_qualifying_child = getSelectValue("#d_eitc_qualifying_child");
    c.ddq.eitc_tiebreaker_applies = getSelectValue("#d_eitc_tiebreaker");
    c.ddq.eitc_age_requirement_met = getSelectValue("#d_eitc_age_met");
    c.ddq.eitc_residency_verified = getSelectValue("#d_eitc_residency");
    c.ddq.eitc_relationship_verified = getSelectValue("#d_eitc_relationship");

    // Part III - CTC/ACTC/ODC
    c.ddq.ctc_qualifying_child = getSelectValue("#d_ctc_qualifying_child");
    c.ddq.ctc_child_age_verified = getSelectValue("#d_ctc_age_verified");
    c.ddq.ctc_ssn_valid = getSelectValue("#d_ctc_ssn_valid");
    c.ddq.ctc_citizenship_verified = getSelectValue("#d_ctc_citizenship");
    c.ddq.ctc_residency_verified = getSelectValue("#d_ctc_residency");
    c.ddq.ctc_support_test_met = getSelectValue("#d_ctc_support");
    c.ddq.form_8332_applies = getSelectValue("#d_form_8332_applies");
    c.ddq.form_8332_attached = getSelectValue("#d_form_8332_attached");

    // Part IV - AOTC
    c.ddq.aotc_eligible_student = getSelectValue("#d_aotc_eligible");
    c.ddq.aotc_first_4_years = getSelectValue("#d_aotc_first_4_years");
    c.ddq.aotc_enrollment_status = getSelectValue("#d_aotc_enrollment");
    c.ddq.aotc_felony_drug = getSelectValue("#d_aotc_felony");
    c.ddq.aotc_expenses_verified = getSelectValue("#d_aotc_expenses");
    c.ddq.aotc_form_1098t_received = getSelectValue("#d_aotc_1098t");

    // Part V - HOH
    c.ddq.hoh_unmarried_verified = getSelectValue("#d_hoh_unmarried");
    c.ddq.hoh_qualifying_person = getSelectValue("#d_hoh_qualifying_person");
    c.ddq.hoh_paid_over_half = getSelectValue("#d_hoh_paid_half");
    c.ddq.hoh_qualifying_person_lived = getSelectValue("#d_hoh_lived");

    // Self-Employment Verification
    c.ddq.self_emp_income_verified = getSelectValue("#d_self_emp_income");
    c.ddq.self_emp_expenses_verified = getSelectValue("#d_self_emp_expenses");
    c.ddq.self_emp_records_adequate = getSelectValue("#d_self_emp_records");

    // Knowledge-Based Interview
    c.ddq.interview = c.ddq.interview || {};
    c.ddq.interview.how_children_related = getTextareaValue("#d_int_relation");
    c.ddq.interview.where_children_attend_school = getTextareaValue("#d_int_school");
    c.ddq.interview.who_provides_childcare = getTextareaValue("#d_int_childcare");
    c.ddq.interview.child_custody_situation = getTextareaValue("#d_int_custody");
    c.ddq.interview.other_parent_claiming = getTextareaValue("#d_int_other_parent");
    c.ddq.interview.how_income_received = getTextareaValue("#d_int_income");
    c.ddq.interview.business_description = getTextareaValue("#d_int_business");
    c.ddq.interview.how_expenses_tracked = getTextareaValue("#d_int_tracking");
    c.ddq.interview.education_institution_name = getInputValue("#d_int_edu_name");
    c.ddq.interview.education_program_type = getInputValue("#d_int_edu_program");

    c.ddq.interviewChecks = c.ddq.interviewChecks || {};
    INTERVIEW_CHECKLIST.forEach(check => {
      c.ddq.interviewChecks[check.key] = getCheckboxValue(check.selector);
    });

    // Preparer Certification
    c.ddq.preparer_satisfied_requirements = getSelectValue("#d_preparer_satisfied");
    c.ddq.knowledge_requirement_met = getSelectValue("#d_knowledge_met");
    c.ddq.preparer_certification_date = getInputValue("#d_cert_date");

    // Document Checklist
    c.documents = readDocumentChecklist();

    c.updatedAt = Date.now();
    c.status = isReadyToPrint(c) ? "ready" : "draft";
  }

  // Helper functions for reading form fields
  function getSelectValue(selector) {
    const el = $(selector);
    return el ? el.value : "";
  }
  function getInputValue(selector) {
    const el = $(selector);
    return el ? el.value.trim() : "";
  }
  function getTextareaValue(selector) {
    const el = $(selector);
    return el ? el.value.trim() : "";
  }
  function getCheckboxValue(selector) {
    const el = $(selector);
    return el ? el.checked : false;
  }

  function readDocumentChecklist() {
    return {
      identity: {
        photo_id: getCheckboxValue("#doc_photo_id"),
        ssn_card: getCheckboxValue("#doc_ssn_card"),
        itin_letter: getCheckboxValue("#doc_itin_letter")
      },
      residency: {
        lease_deed: getCheckboxValue("#doc_lease_deed"),
        utility_bill: getCheckboxValue("#doc_utility_bill"),
        bank_statement: getCheckboxValue("#doc_bank_statement"),
        mail_correspondence: getCheckboxValue("#doc_mail")
      },
      income: {
        w2_forms: getCheckboxValue("#doc_w2_forms"),
        "1099_forms": getCheckboxValue("#doc_1099_forms"),
        self_emp_records: getCheckboxValue("#doc_self_emp_records"),
        bank_deposits: getCheckboxValue("#doc_bank_deposits")
      },
      dependents: {
        birth_cert: getCheckboxValue("#doc_birth_cert"),
        dep_ssn_card: getCheckboxValue("#doc_dep_ssn_card"),
        school_records: getCheckboxValue("#doc_school_records"),
        medical_records: getCheckboxValue("#doc_medical_records"),
        childcare_records: getCheckboxValue("#doc_childcare_records"),
        custody_docs: getCheckboxValue("#doc_custody_docs"),
        form_8332: getCheckboxValue("#doc_form_8332")
      },
      education: {
        form_1098t: getCheckboxValue("#doc_form_1098t"),
        tuition_receipts: getCheckboxValue("#doc_tuition_receipts"),
        enrollment_letter: getCheckboxValue("#doc_enrollment_letter")
      },
      hoh: {
        household_expenses: getCheckboxValue("#doc_household_expenses"),
        qualifying_person_docs: getCheckboxValue("#doc_qualifying_person")
      }
    };
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

  // ---------- Dependents (IRS 2025 Enhanced) ----------
  function renderDeps(){
    const c = state.activeClient;
    const box = $("#deps");
    if(!c) return;
    const deps = c.dependents || [];
    $("#depCount").textContent = deps.length;

    box.innerHTML = deps.map((d, idx) => {
      const age = d.dob ? calculateAge(d.dob) : null;
      const ageDisplay = age !== null ? `Age: ${age}` : "";
      const ctcEligible = age !== null && age <= IRS_2025.CTC.MAX_CHILD_AGE;
      const ageBadge = age !== null ? (ctcEligible
        ? `<span class="badge ok" style="font-size:10px">CTC Eligible (under 17)</span>`
        : `<span class="badge warn" style="font-size:10px">ODC Only (17+)</span>`) : "";

      return `
      <div class="dep" data-idx="${idx}">
        <div class="depTop">
          <div>
            <div class="title">${escapeHtml(d.name || `Dependent #${idx+1}`)} ${ageDisplay ? `<span class="small muted">(${ageDisplay})</span>` : ""}</div>
            <div class="small">Residency + school info supports EITC/CTC eligibility. ${ageBadge}</div>
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
          <div>
            <label>SSN valid for employment? <span class="badge warn" style="font-size:9px">CTC Req</span></label>
            <select data-k="ssn_valid_for_employment">
              <option value="" ${!d.ssn_valid_for_employment ? "selected" : ""}>Select…</option>
              <option value="Yes" ${d.ssn_valid_for_employment === "Yes" ? "selected" : ""}>Yes - Valid for employment</option>
              <option value="No" ${d.ssn_valid_for_employment === "No" ? "selected" : ""}>No - Not valid</option>
              <option value="ITIN" ${d.ssn_valid_for_employment === "ITIN" ? "selected" : ""}>ITIN</option>
            </select>
          </div>
        </div>
        <div class="row" style="margin-top:8px">
          <div>
            <label>Relationship</label>
            <select data-k="relationship">
              <option value="" ${!d.relationship ? "selected" : ""}>Select…</option>
              <option value="Son" ${d.relationship === "Son" ? "selected" : ""}>Son</option>
              <option value="Daughter" ${d.relationship === "Daughter" ? "selected" : ""}>Daughter</option>
              <option value="Stepson" ${d.relationship === "Stepson" ? "selected" : ""}>Stepson</option>
              <option value="Stepdaughter" ${d.relationship === "Stepdaughter" ? "selected" : ""}>Stepdaughter</option>
              <option value="Foster Child" ${d.relationship === "Foster Child" ? "selected" : ""}>Foster Child</option>
              <option value="Brother" ${d.relationship === "Brother" ? "selected" : ""}>Brother</option>
              <option value="Sister" ${d.relationship === "Sister" ? "selected" : ""}>Sister</option>
              <option value="Nephew" ${d.relationship === "Nephew" ? "selected" : ""}>Nephew</option>
              <option value="Niece" ${d.relationship === "Niece" ? "selected" : ""}>Niece</option>
              <option value="Grandson" ${d.relationship === "Grandson" ? "selected" : ""}>Grandson</option>
              <option value="Granddaughter" ${d.relationship === "Granddaughter" ? "selected" : ""}>Granddaughter</option>
              <option value="Other" ${d.relationship === "Other" ? "selected" : ""}>Other (specify in notes)</option>
            </select>
          </div>
          <div><label>Months lived w/ taxpayer (0–12)</label><input data-k="months_lived" type="number" min="0" max="12" value="${escapeAttr(d.months_lived||"")}" placeholder="e.g., 12"/></div>
          <div>
            <label>US Citizen/National/Resident?</label>
            <select data-k="citizenship_status">
              <option value="" ${!d.citizenship_status ? "selected" : ""}>Select…</option>
              <option value="US Citizen" ${d.citizenship_status === "US Citizen" ? "selected" : ""}>US Citizen</option>
              <option value="US National" ${d.citizenship_status === "US National" ? "selected" : ""}>US National</option>
              <option value="Resident Alien" ${d.citizenship_status === "Resident Alien" ? "selected" : ""}>Resident Alien</option>
              <option value="No" ${d.citizenship_status === "No" ? "selected" : ""}>No</option>
            </select>
          </div>
        </div>
        <div class="row" style="margin-top:8px">
          <div><label>School/daycare name</label><input data-k="school_name" value="${escapeAttr(d.school_name||"")}" placeholder="School name"/></div>
          <div><label>School address/phone</label><input data-k="school_address" value="${escapeAttr(d.school_address||"")}" placeholder="Address + phone"/></div>
          <div><label>Other parent/guardian (name + phone)</label><input data-k="other_parent" value="${escapeAttr(d.other_parent||"")}" placeholder="If applicable"/></div>
        </div>
        <div style="margin-top:8px">
          <label>Notes (custody/support/special situations)</label>
          <textarea data-k="notes" placeholder="Custody arrangements, support details, any special circumstances…">${escapeHtml(d.notes||"")}</textarea>
        </div>
      </div>
    `;}).join("") || `<div class="small muted">No dependents yet. Click "Add dependent".</div>`;

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

  // ---------- Print Packet (IRS 2025 Compliant) ----------
  function buildPacketHTML(c, files){
    const headerLines = (state.officeHeader || defaultOfficeHeader()).split("\n").map(s=>s.trim()).filter(Boolean);
    const header = headerLines.map(l=>`<div>${escapeHtml(l)}</div>`).join("");

    const deps = c.dependents || [];
    const depRows = deps.map((d,i)=>{
      const age = d.dob ? calculateAge(d.dob) : null;
      const ctcEligible = age !== null && age <= IRS_2025.CTC.MAX_CHILD_AGE;
      const eligBadge = age !== null ? (ctcEligible ? "CTC" : "ODC") : "";
      return `
      <tr>
        <td style="padding:4px;border:1px solid #ddd">${i+1}</td>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(d.name||"")}</td>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(d.dob||"")} ${age !== null ? `(Age: ${age})` : ""}</td>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(d.ssn_last4||"")} ${d.ssn_valid_for_employment === "Yes" ? "✓" : ""}</td>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(d.relationship||"")}</td>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(d.months_lived||"")}</td>
        <td style="padding:4px;border:1px solid #ddd">${eligBadge}</td>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(d.school_name||"")}</td>
      </tr>
    `;}).join("");

    const flags = computeFlags(c);
    const credits = c.credits_claimed || {};
    const creditsList = [];
    if(credits.eitc) creditsList.push("EITC");
    if(credits.ctc) creditsList.push("CTC");
    if(credits.actc) creditsList.push("ACTC");
    if(credits.odc) creditsList.push("ODC");
    if(credits.aotc) creditsList.push("AOTC");
    if(credits.hoh) creditsList.push("HOH");

    const fileRows = (files||[]).map(f=>`
      <tr>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(f.name)}</td>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(f.type)}</td>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(humanSize(f.size))}</td>
        <td style="padding:4px;border:1px solid #ddd">${escapeHtml(fmtWhen(f.createdAt))}</td>
      </tr>
    `).join("");

    // Document verification summary
    const docs = c.documents || {};
    const docSummary = summarizeDocuments(c);
    const docVerified = docSummary.verified;
    const docTotal = docSummary.total;
    const interviewStats = getInterviewCheckStats(c);
    const interviewMissingSnippet = interviewStats.missing.length
      ? `Missing: ${interviewStats.missing.slice(0,3).join(", ")}${interviewStats.missing.length > 3 ? ` +${interviewStats.missing.length - 3} more` : ""}`
      : "All questions ticked";

    const today = new Date().toISOString().slice(0,10);

    return `
      <div style="font-family:system-ui,-apple-system,Segoe UI,Roboto,Arial; color:#000">
        <!-- Header with IRS 2025 Badge -->
        <div style="display:flex;justify-content:space-between;gap:14px;align-items:flex-start">
          <div>
            <div style="font-weight:900;font-size:16px;margin-bottom:6px">Tax Due Diligence Packet</div>
            <div style="font-size:12px;line-height:1.35">${header}</div>
          </div>
          <div style="text-align:right;font-size:12px">
            <div style="background:#1e40af;color:#fff;padding:6px 10px;border-radius:6px;font-weight:bold;margin-bottom:6px">
              IRS 2025 • Form 8867 Compliant
            </div>
            <div><b>Date:</b> ${escapeHtml(today)}</div>
            <div><b>Client ID:</b> ${escapeHtml(c.id)}</div>
            <div><b>Tax Year:</b> ${IRS_2025.TAX_YEAR}</div>
          </div>
        </div>

        <hr style="margin:12px 0"/>

        <!-- Credits Being Claimed -->
        <div style="background:#f0f9ff;border:1px solid #0ea5e9;border-radius:8px;padding:10px;margin-bottom:12px">
          <div style="font-weight:900;font-size:13px;color:#0369a1;margin-bottom:4px">Credits/Status Being Claimed</div>
          <div style="font-size:12px">${creditsList.length ? creditsList.join(" • ") : "No credits selected"}</div>
        </div>

        <!-- Client Summary -->
        <div style="font-weight:900;margin-bottom:6px">Client Summary</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr><td style="border:1px solid #ddd;padding:4px;width:28%"><b>Client</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.name||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Phone / Email</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml((c.phone||"") + (c.email?(" • "+c.email):""))}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>DOB</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.dob||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>SSN/ITIN (Last 4)</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ssn_last4||"")} ${c.ssn_valid_for_employment === "Yes" ? " (Valid for employment)" : ""}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Citizenship Status</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.citizenship_status||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Filing status</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.filing_status||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Address</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.address||"")}</td></tr>
          ${c.moved_12mo === "Yes" ? `<tr><td style="border:1px solid #ddd;padding:4px"><b>Prior Address</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.prior_address||"(Not provided)")}</td></tr>` : ""}
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Photo ID</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml((c.id_type||"") + (c.id_exp?(" (exp "+c.id_exp+")"):""))}</td></tr>
        </table>

        <div style="height:12px"></div>

        <!-- Dependents -->
        <div style="font-weight:900;margin-bottom:6px">Dependents / Children (IRS 2025 Eligibility)</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <tr style="background:#f5f5f5">
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">#</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">Name</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">DOB / Age</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">SSN (Last 4)</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">Relationship</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">Months</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">Credit</th>
            <th style="border:1px solid #ddd;padding:4px;font-size:10px;font-weight:bold">School</th>
          </tr>
          ${depRows || `<tr><td colspan="8" style="border:1px solid #ddd;padding:4px">No dependents entered.</td></tr>`}
        </table>
        <div style="font-size:9px;color:#666;margin-top:4px">CTC = Child Tax Credit (under 17) • ODC = Other Dependents Credit (17+) • ✓ = SSN valid for employment</div>

        <div style="height:12px"></div>

        <!-- Income -->
        <div style="font-weight:900;margin-bottom:6px">Income + Work Information</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr><td style="border:1px solid #ddd;padding:4px;width:28%"><b>W-2 Employer</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.w2_employer||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Employer Address</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.w2_address||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Self-Employed?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.self_employed||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Business Type</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.business_type||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Income Notes</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.income_notes||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Expense Notes</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.income?.expense_notes||"")}</td></tr>
        </table>

        <div style="height:12px"></div>

        <!-- Form 8867 Due Diligence Checklist -->
        <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:8px;padding:10px;margin-bottom:12px">
          <div style="font-weight:900;font-size:13px;color:#166534;margin-bottom:8px">IRS Form 8867 - Paid Preparer's Due Diligence Checklist</div>
          <table style="width:100%;border-collapse:collapse;font-size:11px">
            <tr><td style="padding:3px;width:50%"><b>Part I:</b> Worksheets completed?</td><td style="padding:3px">${escapeHtml(c.ddq?.completed_worksheets||"")}</td></tr>
            <tr><td style="padding:3px"><b>Line 3:</b> Info appears incorrect?</td><td style="padding:3px">${escapeHtml(c.ddq?.info_appears_incorrect||"")}</td></tr>
            <tr><td style="padding:3px"><b>Line 4:</b> Reasonable inquiries made?</td><td style="padding:3px">${escapeHtml(c.ddq?.made_reasonable_inquiries||"")}</td></tr>
            <tr><td style="padding:3px"><b>Line 5:</b> Inquiries documented?</td><td style="padding:3px">${escapeHtml(c.ddq?.documented_inquiries||"")}</td></tr>
            <tr><td style="padding:3px"><b>Line 6:</b> Advised about IRS doc requests?</td><td style="padding:3px">${escapeHtml(c.ddq?.advised_irs_may_request_docs||"")}</td></tr>
            <tr><td style="padding:3px"><b>Line 7:</b> Form 8862 required?</td><td style="padding:3px">${escapeHtml(c.ddq?.form_8862_required||"")} ${c.ddq?.form_8862_attached === "Yes" ? "(Attached)" : ""}</td></tr>
            <tr><td style="padding:3px"><b>Line 8:</b> Schedule C required?</td><td style="padding:3px">${escapeHtml(c.ddq?.schedule_c_required||"")}</td></tr>
          </table>
        </div>

        <!-- Credit-Specific Due Diligence -->
        ${credits.eitc ? `
        <div style="background:#dcfce7;border:1px solid #22c55e;border-radius:8px;padding:8px;margin-bottom:8px">
          <div style="font-weight:bold;font-size:11px;color:#166534">EITC Due Diligence (Line 9)</div>
          <div style="font-size:10px">Qualifying child: ${escapeHtml(c.ddq?.eitc_qualifying_child||"")} • Tiebreaker: ${escapeHtml(c.ddq?.eitc_tiebreaker_applies||"")} • Residency verified: ${escapeHtml(c.ddq?.eitc_residency_verified||"")}</div>
        </div>
        ` : ""}

        ${(credits.ctc || credits.actc) ? `
        <div style="background:#fef3c7;border:1px solid #f59e0b;border-radius:8px;padding:8px;margin-bottom:8px">
          <div style="font-weight:bold;font-size:11px;color:#92400e">CTC/ACTC Due Diligence (Lines 10-12)</div>
          <div style="font-size:10px">Qualifying child: ${escapeHtml(c.ddq?.ctc_qualifying_child||"")} • Age verified: ${escapeHtml(c.ddq?.ctc_child_age_verified||"")} • SSN valid: ${escapeHtml(c.ddq?.ctc_ssn_valid||"")} • Form 8332: ${escapeHtml(c.ddq?.form_8332_applies||"")}</div>
        </div>
        ` : ""}

        ${credits.aotc ? `
        <div style="background:#fce7f3;border:1px solid #ec4899;border-radius:8px;padding:8px;margin-bottom:8px">
          <div style="font-weight:bold;font-size:11px;color:#9d174d">AOTC Due Diligence (Line 13)</div>
          <div style="font-size:10px">Eligible student: ${escapeHtml(c.ddq?.aotc_eligible_student||"")} • First 4 years: ${escapeHtml(c.ddq?.aotc_first_4_years||"")} • Form 1098-T: ${escapeHtml(c.ddq?.aotc_form_1098t_received||"")}</div>
        </div>
        ` : ""}

        ${(credits.hoh || c.filing_status === "Head of Household") ? `
        <div style="background:#e0e7ff;border:1px solid #6366f1;border-radius:8px;padding:8px;margin-bottom:8px">
          <div style="font-weight:bold;font-size:11px;color:#3730a3">HOH Due Diligence (Line 14)</div>
          <div style="font-size:10px">Unmarried: ${escapeHtml(c.ddq?.hoh_unmarried_verified||"")} • Qualifying person: ${escapeHtml(c.ddq?.hoh_qualifying_person||"")} • Paid >50%: ${escapeHtml(c.ddq?.hoh_paid_over_half||"")}</div>
        </div>
        ` : ""}

        <!-- Knowledge-Based Interview Summary -->
        <div style="font-weight:900;margin-bottom:6px">Knowledge-Based Interview (IRS Pub 4687)</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          ${c.ddq?.interview?.how_children_related ? `<tr><td style="border:1px solid #ddd;padding:3px;width:35%"><b>Relationship to children</b></td><td style="border:1px solid #ddd;padding:3px">${escapeHtml(c.ddq.interview.how_children_related)}</td></tr>` : ""}
          ${c.ddq?.interview?.where_children_attend_school ? `<tr><td style="border:1px solid #ddd;padding:3px"><b>School/daycare</b></td><td style="border:1px solid #ddd;padding:3px">${escapeHtml(c.ddq.interview.where_children_attend_school)}</td></tr>` : ""}
          ${c.ddq?.interview?.who_provides_childcare ? `<tr><td style="border:1px solid #ddd;padding:3px"><b>Childcare provider</b></td><td style="border:1px solid #ddd;padding:3px">${escapeHtml(c.ddq.interview.who_provides_childcare)}</td></tr>` : ""}
          ${c.ddq?.interview?.child_custody_situation ? `<tr><td style="border:1px solid #ddd;padding:3px"><b>Custody situation</b></td><td style="border:1px solid #ddd;padding:3px">${escapeHtml(c.ddq.interview.child_custody_situation)}</td></tr>` : ""}
          ${c.ddq?.interview?.how_income_received ? `<tr><td style="border:1px solid #ddd;padding:3px"><b>Income receipt method</b></td><td style="border:1px solid #ddd;padding:3px">${escapeHtml(c.ddq.interview.how_income_received)}</td></tr>` : ""}
        </table>
        <div style="font-size:11px;margin-top:6px;display:flex;flex-wrap:wrap;justify-content:space-between;gap:12px">
          <span><b>Interview ticks:</b> ${interviewStats.ticked}/${interviewStats.total}</span>
          <span style="color:#d97706">${interviewMissingSnippet}</span>
        </div>

        <div style="height:8px"></div>

        <!-- Legacy DDQ -->
        <div style="font-weight:900;margin-bottom:6px">Due Diligence Verification Summary</div>
        <table style="width:100%;border-collapse:collapse;font-size:11px">
          <tr><td style="border:1px solid #ddd;padding:4px;width:50%"><b>Child lived with taxpayer >6 months?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.child_lived_half_year||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Could anyone else claim any child?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.anyone_else_claim||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Taxpayer pays >50% household costs?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.pays_household_costs||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Any missing dependent IDs?</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.missing_ids||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Documents reviewed/requested</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.docs||"")}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px"><b>Preparer verification notes</b></td><td style="border:1px solid #ddd;padding:4px">${escapeHtml(c.ddq?.preparer_notes||"")}</td></tr>
        </table>

        <div style="height:12px"></div>

        <!-- Auto Flags -->
        <div style="font-weight:900;margin-bottom:6px">Compliance Flags</div>
        <div style="font-size:12px;${flags.some(f=>f.type==="bad") ? "background:#fee2e2;border:1px solid #dc2626;border-radius:6px;padding:8px" : ""}">
          ${flags.length ? flags.map(f=>`• <b style="color:${f.type==="bad"?"#dc2626":"#d97706"}">${escapeHtml(f.type.toUpperCase())}</b> — ${escapeHtml(f.text)}<br/>`).join("") : '<span style="color:#166534">✓ No flags - Ready for filing</span>'}
        </div>

        <div style="height:12px"></div>

        <!-- Document Verification -->
        <div style="font-weight:900;margin-bottom:6px">Document Verification (${docTotal ? `${docVerified}/${docTotal} verified` : `${docVerified} verified`})</div>
        <table style="width:100%;border-collapse:collapse;font-size:10px">
          <tr style="background:#f5f5f5">
            <th style="border:1px solid #ddd;padding:4px">Category</th>
            <th style="border:1px solid #ddd;padding:4px">Documents Verified</th>
          </tr>
          <tr><td style="border:1px solid #ddd;padding:4px">Identity</td><td style="border:1px solid #ddd;padding:4px">${docs.identity?.photo_id ? "✓ Photo ID " : ""}${docs.identity?.ssn_card ? "✓ SSN Card " : ""}${docs.identity?.itin_letter ? "✓ ITIN Letter" : ""}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px">Residency</td><td style="border:1px solid #ddd;padding:4px">${docs.residency?.lease_deed ? "✓ Lease/Deed " : ""}${docs.residency?.utility_bill ? "✓ Utilities " : ""}${docs.residency?.bank_statement ? "✓ Bank Stmt " : ""}${docs.residency?.mail_correspondence ? "✓ Mail" : ""}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px">Income</td><td style="border:1px solid #ddd;padding:4px">${docs.income?.w2_forms ? "✓ W-2 " : ""}${docs.income?.["1099_forms"] ? "✓ 1099 " : ""}${docs.income?.self_emp_records ? "✓ Self-Emp Records " : ""}${docs.income?.bank_deposits ? "✓ Bank Deposits" : ""}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px">Dependents</td><td style="border:1px solid #ddd;padding:4px">${docs.dependents?.birth_cert ? "✓ Birth Cert " : ""}${docs.dependents?.dep_ssn_card ? "✓ Dep SSN " : ""}${docs.dependents?.school_records ? "✓ School Records" : ""}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px">Education</td><td style="border:1px solid #ddd;padding:4px">${docs.education?.form_1098t ? "✓ 1098-T " : ""}${docs.education?.tuition_receipts ? "✓ Tuition Receipts " : ""}${docs.education?.enrollment_letter ? "✓ Enrollment Letter" : ""}</td></tr>
          <tr><td style="border:1px solid #ddd;padding:4px">Head of Household</td><td style="border:1px solid #ddd;padding:4px">${docs.hoh?.household_expenses ? "✓ Household Expenses " : ""}${docs.hoh?.qualifying_person_docs ? "✓ Qualifying Person Docs" : ""}</td></tr>
        </table>

        <div style="height:12px"></div>

        <!-- Attached Files -->
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

        <!-- Preparer Certification -->
        <div style="background:#f0fdf4;border:2px solid #22c55e;border-radius:8px;padding:10px;margin-bottom:12px">
          <div style="font-weight:900;font-size:12px;color:#166534;margin-bottom:6px">Preparer Due Diligence Certification</div>
          <div style="font-size:11px">
            <b>Requirements satisfied:</b> ${escapeHtml(c.ddq?.preparer_satisfied_requirements||"Not confirmed")}<br/>
            <b>Knowledge requirement met:</b> ${escapeHtml(c.ddq?.knowledge_requirement_met||"Not confirmed")}<br/>
            <b>Certification date:</b> ${escapeHtml(c.ddq?.preparer_certification_date||today)}
          </div>
        </div>

        <!-- Client Attestation -->
        <div style="font-weight:900;margin-bottom:6px">Client Attestation</div>
        <div style="font-size:11px;line-height:1.45;border:1px solid #ddd;padding:10px;border-radius:6px">
          I certify that the information I provided is true and complete to the best of my knowledge. I understand that eligibility for credits (EITC, CTC, ACTC, AOTC) and Head of Household filing status depends on accurate residency, relationship, support, and other qualifying information. I have been advised that the IRS may request documentation to verify my eligibility.
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

        <div style="text-align:center;margin-top:14px;font-size:9px;color:#666">
          Document retention: ${IRS_2025.RETENTION_YEARS} years from filing date per IRS regulations • Penalty for non-compliance: $${IRS_2025.PENALTY_PER_FAILURE} per failure
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
  function generateMockInterviewChecks(){
    const checks = {};
    INTERVIEW_CHECKLIST.forEach(item => {
      checks[item.key] = Math.random() < 0.85;
    });
    return checks;
  }

  function generateMockDocumentSet({ hasDependents, claimingAotc, hohClaim }){
    const sampleClient = {
      dependents: hasDependents ? [{}] : [],
      credits_claimed: { aotc: claimingAotc, hoh: hohClaim },
      filing_status: hohClaim ? "Head of Household" : "Single"
    };
    const docs = {};
    for(const [category, items] of Object.entries(REQUIRED_DOCUMENTS)){
      docs[category] = {};
      const applies = isCategoryApplicable(sampleClient, category);
      items.forEach(item => {
        if(!applies){
          docs[category][item.id] = false;
          return;
        }
        const chance = item.required ? 0.95 : 0.6;
        docs[category][item.id] = Math.random() < chance;
      });
    }
    return docs;
  }

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
    const creditsClaimed = {
      eitc: hasDependents && Math.random() > 0.25,
      ctc: hasDependents,
      actc: hasDependents && Math.random() > 0.7,
      odc: !hasDependents && Math.random() > 0.6,
      aotc: index % 5 === 0,
      hoh: filingStatus === "Head of Household"
    };
    const interviewResponses = {
      how_children_related: hasDependents ? `Children are my ${Math.random() > 0.5 ? "son" : "daughter"} and live with me.` : "",
      where_children_attend_school: hasDependents ? `${mockRandomItem(mockSchools)} • ${mockRandomInt(100, 999)} School Rd, ${city}` : "",
      who_provides_childcare: hasDependents ? "Family supports childcare while I work." : "",
      child_custody_situation: hasDependents ? "Full custody with no court issues." : "",
      other_parent_claiming: hasDependents ? "Other parent does not claim this year." : "",
      how_income_received: isSelfEmployed ? "Payment apps plus direct deposit." : "Direct deposit from employer.",
      business_description: isSelfEmployed ? `Provides ${mockRandomItem(["rideshare", "cleaning", "trucking", "sales"])} services locally.` : "",
      how_expenses_tracked: isSelfEmployed ? "Receipts tracked via spreadsheet and bank statements." : "",
      education_institution_name: creditsClaimed.aotc ? "City Community College" : "",
      education_program_type: creditsClaimed.aotc ? "Associate degree - Business Administration" : ""
    };
    
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
      credits_claimed: creditsClaimed,
      documents: generateMockDocumentSet({
        hasDependents,
        claimingAotc: creditsClaimed.aotc,
        hohClaim: creditsClaimed.hoh
      }),
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
        preparer_notes: `All documents reviewed and verified on ${new Date(baseTime).toLocaleDateString()}. ${hasDependents ? "Dependent residency confirmed through school records and medical documents. " : ""}${isSelfEmployed ? "Self-employment income verified through bank deposits and 1099 forms. " : "W-2 income verified. "}Client attestation signed. All required due diligence questions answered.`,
        interview: interviewResponses,
        interviewChecks: generateMockInterviewChecks()
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

    // Filter pills click handlers
    $$(".filter-pill").forEach(pill => {
      pill.addEventListener("click", () => {
        $$(".filter-pill").forEach(p => p.classList.remove("active"));
        pill.classList.add("active");
        const filter = pill.dataset.filter;
        $("#quickFilter").value = filter;
        state.quickFilter = filter;
        render();
      });
    });

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

    // Document checkboxes - bind change events
    $$(".doc-check").forEach(checkbox => {
      checkbox.addEventListener("change", () => {
        updateDocumentCounts();
        markDirty();
        scheduleAutosave();
        renderFlags();
      });
    });

    // Credit checkboxes - bind change events
    $$("#credit_eitc, #credit_ctc, #credit_actc, #credit_odc, #credit_aotc, #credit_hoh").forEach(checkbox => {
      if(checkbox) {
        checkbox.addEventListener("change", () => {
          markDirty();
          scheduleAutosave();
          renderFlags();
          // Show/hide relevant DDQ sections based on credits selected
          toggleCreditSections();
        });
      }
    });

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

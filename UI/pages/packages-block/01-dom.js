/* ============================================================
   PACKAGES-BLOCK SPLIT (BASELINE v1.0)
   Projekt: HR-System (GitHub Pages / localStorage-first)
   Syfte: Stabil bootstrap + visa block från AO-0XX_BLOCKS_V1
   Policy: UI-only, fail-closed, XSS-safe, inga nya storage keys
   ============================================================ */

/* =========================
   FILE: UI/pages/packages-block/01-dom.js
   ========================= */
(function(){
  "use strict";
  window.HRPKG = window.HRPKG || {};
  const D = {};

  function byId(id){ return document.getElementById(id); }
  function setText(el, txt){ if(el) el.textContent = String(txt == null ? "" : txt); }
  function show(el, on){ if(el) el.style.display = on ? "" : "none"; }
  function disable(el, on){ if(el) el.disabled = !!on; }
  function clear(el){ if(el) el.textContent = ""; }

  D.byId = byId;
  D.setText = setText;
  D.show = show;
  D.disable = disable;
  D.clear = clear;

  // Common elements (safe getters)
  D.els = function(){
    return {
      msgBox: byId("msgBox"),
      lockBox: byId("lockBox"),
      introBox: byId("introBox"),
      btnToggleInfo: byId("btnToggleInfo"),

      blockList: byId("blockList"),
      countBlocks: byId("countBlocks"),
      qBlocks: byId("qBlocks"),
      btnShowAllBlocks: byId("btnShowAllBlocks"),
      filterStatus: byId("filterStatus"),
      fHasQ: byId("fHasQ"),
      fHasD: byId("fHasD"),
      fNoKey: byId("fNoKey"),
      fUnverified: byId("fUnverified"),

      statePill: byId("statePill"),
      selPill: byId("selPill"),
      verifyPill: byId("verifyPill"),

      btnVerify: byId("btnVerify"),
      btnPublish: byId("btnPublish"),
      btnPrint: byId("btnPrint"),
      btnSaveEdits: byId("btnSaveEdits"),

      whoPill: byId("whoPill"),
      modePill: byId("modePill"),

      topEditing: byId("topEditing"),
      topEditingText: byId("topEditingText"),

      selDetail: byId("selDetail"),
      selHint: byId("selHint"),
      selDirtyPill: byId("selDirtyPill"),

      // Export area (optional – baseline shows “not implemented”)
      btnToggleExport: byId("btnToggleExport"),
      exportBody: byId("exportBody"),
      trainPreview: byId("trainPreview"),
      trainPreviewDetail: byId("trainPreviewDetail"),
      btnExportTraining: byId("btnExportTraining"),
      btnReloadTrainings: byId("btnReloadTrainings"),
      qTrainModule: byId("qTrainModule"),
      qTrainArea: byId("qTrainArea"),
      qTrainFree: byId("qTrainFree"),
      dlTrainAreas: byId("dlTrainAreas"),
      trainExportHint: byId("trainExportHint"),

      navLogout: byId("navLogout"),
    };
  };

  window.HRPKG.dom = D;
})();


/* =========================
   FILE: UI/pages/packages-block/02-core.js
   ========================= */
(function(){
  "use strict";
  window.HRPKG = window.HRPKG || {};
  const Core = {};

  // Keys (LÅSTA)
  Core.BLOCKS_KEY = "AO-0XX_BLOCKS_V1";
  Core.TRAININGS_KEY = "AO-057_TRAININGS_V1";

  // Fail-closed helper: show lock message and disable critical actions
  Core.lockUI = function(els, reasonLines){
    const dom = window.HRPKG.dom;
    dom.show(els.lockBox, true);
    const box = els.lockBox;
    if(box){
      box.innerHTML = ""; // safe: we will only set text nodes
      const title = document.createElement("div");
      title.style.fontWeight = "950";
      title.textContent = "Låst för säkerhet (fail-closed)";
      box.appendChild(title);

      const ul = document.createElement("ul");
      (reasonLines || []).forEach((s)=>{
        const li = document.createElement("li");
        li.textContent = String(s);
        ul.appendChild(li);
      });
      box.appendChild(ul);
    }

    // Disable all write-ish actions
    dom.disable(els.btnVerify, true);
    dom.disable(els.btnPublish, true);
    dom.disable(els.btnSaveEdits, true);
  };

  Core.setMsg = function(els, text){
    const dom = window.HRPKG.dom;
    dom.setText(els.msgBox, text);
  };

  // Auth + role: rely on HRApp if present; otherwise fail-closed to read-only
  Core.getSession = function(){
    try{
      const HRApp = window.HRApp;
      if(HRApp && typeof HRApp.getSession === "function") return HRApp.getSession();
    }catch(_){}
    return null;
  };

  Core.requireAuth = function(){
    try{
      const HRApp = window.HRApp;
      if(HRApp && typeof HRApp.requireAuth === "function") return HRApp.requireAuth();
    }catch(_){}
    // If no HRApp, we still allow read-only view (demo), but mark as limited.
    return { ok:true, user:null, role:"UNKNOWN" };
  };

  Core.isReadOnlyRole = function(role){
    return role === "SYSTEM_ADMIN";
  };

  Core.safeNow = function(){
    return Date.now();
  };

  // Very defensive string normalization for UI display
  Core.safeStr = function(v){
    const s = (v == null) ? "" : String(v);
    return s;
  };

  window.HRPKG.core = Core;
})();


/* =========================
   FILE: UI/pages/packages-block/03-store.js
   ========================= */
(function(){
  "use strict";
  window.HRPKG = window.HRPKG || {};
  const Store = {};

  function safeParseJson(raw){
    if(raw == null || raw === "") return { ok:true, value:null, corrupt:false };
    try{
      const v = JSON.parse(raw);
      return { ok:true, value:v, corrupt:false };
    }catch(e){
      return { ok:false, value:null, corrupt:true, error:String(e && e.message ? e.message : e) };
    }
  }

  function getLS(key){
    try{ return localStorage.getItem(key); }catch(_){ return null; }
  }
  function setLS(key, val){
    try{ localStorage.setItem(key, val); return true; }catch(_){ return false; }
  }

  // BLOCKS: expected shape wrapper { v, blocks: [] } OR array []
  Store.loadBlocks = function(){
    const core = window.HRPKG.core;
    const raw = getLS(core.BLOCKS_KEY);
    const p = safeParseJson(raw);
    if(p.corrupt) return { ok:false, corrupt:true, blocks:[], raw, error:p.error };

    let blocks = [];
    const v = p.value;
    if(Array.isArray(v)) blocks = v;
    else if(v && typeof v === "object" && Array.isArray(v.blocks)) blocks = v.blocks;
    else if(v == null) blocks = [];
    else blocks = []; // unknown shape -> treat as empty but not corrupt

    return { ok:true, corrupt:false, blocks, raw };
  };

  Store.saveBlocks = function(blocks){
    const core = window.HRPKG.core;
    // Keep existing wrapper format (professional: versioned)
    const payload = { v:"v1", blocks:Array.isArray(blocks) ? blocks : [] };
    const ok = setLS(core.BLOCKS_KEY, JSON.stringify(payload));
    return { ok };
  };

  // TRAININGS: read-only here (used later)
  Store.loadTrainings = function(){
    const core = window.HRPKG.core;
    const raw = getLS(core.TRAININGS_KEY);
    const p = safeParseJson(raw);
    if(p.corrupt) return { ok:false, corrupt:true, trainings:[], raw, error:p.error };

    let trainings = [];
    const v = p.value;
    if(Array.isArray(v)) trainings = v;
    else if(v && typeof v === "object" && Array.isArray(v.trainings)) trainings = v.trainings;
    else if(v == null) trainings = [];
    else trainings = [];

    return { ok:true, corrupt:false, trainings, raw };
  };

  window.HRPKG.store = Store;
})();


/* =========================
   FILE: UI/pages/packages-block/04-contract.js
   (Baseline: minimal validation for UI state + flags)
   ========================= */
(function(){
  "use strict";
  window.HRPKG = window.HRPKG || {};
  const Contract = {};

  // Recognize your locked item contract (document/task/question)
  function kindCounts(items){
    let q=0,d=0,t=0, missingKey=0;
    (items||[]).forEach(it=>{
      if(!it || typeof it !== "object") return;
      if(it.kind === "question"){
        q++;
        const opt = Array.isArray(it.options) ? it.options : [];
        const needs = !!it.requiresAnswer;
        const key = (it.answerKey == null) ? "" : String(it.answerKey);
        const hasKey = key.trim().length > 0;
        if(needs){
          if(opt.length >= 2){
            const match = opt.some(o => String(o) === key);
            if(!match) missingKey++;
          }else{
            if(!hasKey) missingKey++;
          }
        }
      }else if(it.kind === "document"){
        d++;
      }else if(it.kind === "task"){
        t++;
      }
    });
    return { q,d,t, missingKey };
  }

  Contract.kindCounts = kindCounts;

  Contract.isUnverified = function(block){
    const v = block && typeof block === "object" ? block.verifiedAt : 0;
    return !v || Number(v) <= 0;
  };

  // Minimal “problem” detector for list filters
  Contract.blockHasProblem = function(block){
    if(!block || typeof block !== "object") return true;
    const items = Array.isArray(block.items) ? block.items : [];
    if(!block.blockId || String(block.blockId).trim() === "") return true;
    // Empty item text (basic)
    for(const it of items){
      if(it && typeof it === "object"){
        if(it.kind === "document" || it.kind === "task" || it.kind === "question"){
          const tx = (it.text == null) ? "" : String(it.text);
          if(tx.trim() === "") return true;
        }
      }
    }
    const c = kindCounts(items);
    if(c.missingKey > 0) return true;
    return false;
  };

  window.HRPKG.contract = Contract;
})();


/* =========================
   FILE: UI/pages/packages-block/05-render.js
   ========================= */
(function(){
  "use strict";
  window.HRPKG = window.HRPKG || {};
  const Render = {};
  const dom = window.HRPKG.dom;
  const core = window.HRPKG.core;
  const contract = window.HRPKG.contract;

  function pillText(block){
    const items = Array.isArray(block.items) ? block.items : [];
    const c = contract.kindCounts(items);
    const infoOnly = (c.q===0 && c.t===0 && c.d>0);
    // Mirrors your UI idea: "Hittat: X item(s) • ? • doc • task"
    return `Innehåll: ${items.length} delar • ❓ ${c.q} • 📄 ${c.d} • ✅ ${c.t}` + (infoOnly ? " • (info-only)" : "");
  }

  Render.renderBlockList = function(els, state){
    dom.clear(els.blockList);

    const list = state.viewBlocks || [];
    if(list.length === 0){
      const empty = document.createElement("div");
      empty.className = "muted2";
      empty.textContent = state.listIsIdle
        ? "Sök för att visa block. (Inga block hittade ännu.)"
        : "Inga block matchar ditt filter.";
      els.blockList.appendChild(empty);
      dom.setText(els.countBlocks, state.listIsIdle ? "Listan är vilande." : "0 block");
      return;
    }

    dom.setText(els.countBlocks, `${list.length} block`);

    list.forEach((b)=>{
      const row = document.createElement("div");
      row.className = "rowItem" + (state.selectedId === b.blockId ? " active" : "");
      row.tabIndex = 0;

      const top = document.createElement("div");
      top.className = "rowTop";

      const left = document.createElement("div");
      left.style.minWidth = "0";

      const t = document.createElement("div");
      t.className = "rowTitle";
      t.textContent = core.safeStr(b.title || "(utan titel)");

      const s = document.createElement("div");
      s.className = "tiny muted2";
      const mod = core.safeStr(b.module || "—");
      const area = core.safeStr(b.area || "—");
      const step = core.safeStr(b.step || "—");
      s.textContent = `Modul: ${mod}\nOmråde: ${area}\nSteg: ${step}`;

      left.appendChild(t);
      left.appendChild(s);

      const right = document.createElement("div");
      right.className = "tiny";
      const isPub = (b.status === "published");
      const stat = document.createElement("div");
      stat.textContent = isPub ? "Publicerad" : "Utkast";
      stat.style.fontWeight = "900";
      right.appendChild(stat);

      const vp = document.createElement("div");
      vp.className = "verifyPill " + (contract.isUnverified(b) ? "warn" : "ok");
      vp.textContent = contract.isUnverified(b) ? "Ej verifierad" : "Verifierad";
      right.appendChild(vp);

      top.appendChild(left);
      top.appendChild(right);

      const line = document.createElement("div");
      line.className = "qaLine";

      const meta = document.createElement("div");
      meta.className = "tiny muted2";
      meta.textContent = pillText(b);

      const prob = contract.blockHasProblem(b);
      const pPill = document.createElement("span");
      pPill.className = "qaPill " + (prob ? "bad" : "ok");
      pPill.textContent = prob ? "Problem" : "OK";

      line.appendChild(meta);
      line.appendChild(pPill);

      row.appendChild(top);
      row.appendChild(line);

      row.addEventListener("click", ()=> state.onSelect && state.onSelect(b.blockId));
      row.addEventListener("keydown", (e)=>{
        if(e.key === "Enter" || e.key === " "){
          e.preventDefault();
          state.onSelect && state.onSelect(b.blockId);
        }
      });

      els.blockList.appendChild(row);
    });
  };

  Render.renderSelected = function(els, state){
    dom.clear(els.selDetail);

    const b = state.selectedBlock;
    if(!b){
      dom.setText(els.selPill, "Val: —");
      dom.show(els.topEditing, false);
      dom.setText(els.selHint, "Välj ett block i vänsterlistan för att se innehåll.");
      dom.disable(els.btnPrint, true);
      dom.disable(els.btnVerify, true);
      dom.disable(els.btnPublish, true);
      dom.disable(els.btnSaveEdits, true);
      return;
    }

    dom.setText(els.selPill, `Val: ${core.safeStr(b.blockId)}`);
    dom.show(els.topEditing, true);
    dom.setText(els.topEditingText, core.safeStr(b.title || b.blockId));

    // Enable view actions; writes depend on mode
    dom.disable(els.btnPrint, false);
    dom.disable(els.btnVerify, state.readOnly);
    dom.disable(els.btnPublish, state.readOnly);
    dom.disable(els.btnSaveEdits, state.readOnly);

    const header = document.createElement("div");
    header.className = "previewCard";
    const ht = document.createElement("div");
    ht.className = "previewTitle";
    ht.textContent = core.safeStr(b.title || "(utan titel)");
    header.appendChild(ht);

    const hm = document.createElement("div");
    hm.className = "tiny muted2";
    hm.textContent = `blockId: ${core.safeStr(b.blockId)} • status: ${core.safeStr(b.status || "draft")}`;
    header.appendChild(hm);

    const meta = document.createElement("div");
    meta.className = "tiny muted2";
    meta.textContent = `Modul: ${core.safeStr(b.module || "—")} • Område: ${core.safeStr(b.area || "—")} • Steg: ${core.safeStr(b.step || "—")}`;
    header.appendChild(meta);

    const div = document.createElement("div");
    div.className = "divider";
    header.appendChild(div);

    const items = Array.isArray(b.items) ? b.items : [];
    const c = contract.kindCounts(items);
    const sums = document.createElement("div");
    sums.className = "tiny muted2";
    sums.textContent = `Innehåll: ${items.length} delar • ❓ ${c.q} • 📄 ${c.d} • ✅ ${c.t} • Saknar facit: ${c.missingKey}`;
    header.appendChild(sums);

    els.selDetail.appendChild(header);

    // Render each item (view-only baseline)
    items.forEach((it, idx)=>{
      const card = document.createElement("div");
      card.className = "itemCard";

      const top = document.createElement("div");
      top.className = "itemRowTop";

      const left = document.createElement("div");
      left.className = "tiny";
      left.style.fontWeight = "950";
      left.textContent = `Item ${idx+1} • ${core.safeStr(it && it.kind ? it.kind : "okänd")}`;

      top.appendChild(left);
      card.appendChild(top);

      const tx = document.createElement("div");
      tx.className = "previewText";
      tx.textContent = core.safeStr(it && it.text ? it.text : "");
      card.appendChild(tx);

      // For question: show options + answerKey
      if(it && it.kind === "question"){
        const opt = Array.isArray(it.options) ? it.options : [];
        if(opt.length){
          const o = document.createElement("div");
          o.className = "tiny muted2";
          o.textContent = `Alternativ: ${opt.map(x=>String(x)).join(" | ")}`;
          card.appendChild(o);
        }
        const a = document.createElement("div");
        a.className = "tiny muted2";
        a.textContent = `Facit (answerKey): ${core.safeStr(it.answerKey || "—")} • answerType: ${core.safeStr(it.answerType || "—")}`;
        card.appendChild(a);
      }

      els.selDetail.appendChild(card);
    });
  };

  Render.renderTopPills = function(els, state){
    // Minimal status pill: counts across all blocks
    let total = state.blocks.length;
    let problems = 0;
    let unverified = 0;
    state.blocks.forEach(b=>{
      if(contract.blockHasProblem(b)) problems++;
      if(contract.isUnverified(b)) unverified++;
    });
    dom.setText(els.statePill, `Status: ${total} block • Problem: ${problems} • Ej verifierade: ${unverified}`);

    if(state.userLabel){
      dom.show(els.whoPill, true);
      dom.setText(els.whoPill, `Inloggad: ${state.userLabel}`);
    }
    dom.show(els.modePill, true);
    dom.setText(els.modePill, state.readOnly ? "Läge: Read-only" : "Läge: Redigera");
  };

  window.HRPKG.render = Render;
})();


/* =========================
   FILE: UI/pages/packages-block/06-page.js
   (Bootstrap + minimal filtering + selection)
   ========================= */
(function(){
  "use strict";
  window.HRPKG = window.HRPKG || {};
  const dom = window.HRPKG.dom;
  const core = window.HRPKG.core;
  const store = window.HRPKG.store;
  const render = window.HRPKG.render;
  const contract = window.HRPKG.contract;

  function normalizeBlock(b){
    if(!b || typeof b !== "object") return null;
    const nb = {
      blockId: (b.blockId != null ? String(b.blockId) : ""),
      title: (b.title != null ? String(b.title) : ""),
      module: (b.module != null ? String(b.module) : ""),
      area: (b.area != null ? String(b.area) : ""),
      step: (b.step != null ? String(b.step) : ""),
      status: (b.status === "published" ? "published" : "draft"),
      createdAt: Number(b.createdAt || 0) || 0,
      updatedAt: Number(b.updatedAt || 0) || 0,
      verifiedAt: Number(b.verifiedAt || 0) || 0,
      verifiedBy: (b.verifiedBy != null ? String(b.verifiedBy) : ""),
      items: Array.isArray(b.items) ? b.items : []
    };
    return nb;
  }

  function applyFilters(state, els){
    const q = (els.qBlocks && els.qBlocks.value ? String(els.qBlocks.value).trim().toLowerCase() : "");
    const status = (els.filterStatus && els.filterStatus.value) ? String(els.filterStatus.value) : "all";
    const hasQ = !!(els.fHasQ && els.fHasQ.checked);
    const hasD = !!(els.fHasD && els.fHasD.checked);
    const noKey = !!(els.fNoKey && els.fNoKey.checked);
    const unverified = !!(els.fUnverified && els.fUnverified.checked);

    // “Search-first” behaviour: idle until search or "Visa alla"
    state.listIsIdle = (!state.forceShowAll && q.length === 0);

    if(state.listIsIdle){
      state.viewBlocks = [];
      return;
    }

    let list = state.blocks.slice();

    if(status !== "all"){
      list = list.filter(b => (b.status || "draft") === status);
    }

    if(q.length){
      list = list.filter(b=>{
        const hay = `${b.title} ${b.module} ${b.area} ${b.step} ${b.blockId}`.toLowerCase();
        return hay.includes(q);
      });
    }

    if(hasQ || hasD || noKey){
      list = list.filter(b=>{
        const c = contract.kindCounts(b.items || []);
        if(hasQ && c.q === 0) return false;
        if(hasD && c.d === 0) return false;
        if(noKey && c.missingKey === 0) return false;
        return true;
      });
    }

    if(unverified){
      list = list.filter(b=> contract.isUnverified(b));
    }

    state.viewBlocks = list;
  }

  function findBlock(state, id){
    return state.blocks.find(b => b.blockId === id) || null;
  }

  function onSelect(state, els, blockId){
    state.selectedId = blockId;
    state.selectedBlock = findBlock(state, blockId);
    render.renderBlockList(els, state);
    render.renderSelected(els, state);
    render.renderTopPills(els, state);
    core.setMsg(els, state.selectedBlock ? "Block valt." : "Välj ett block.");
  }

  function attach(els, state){
    if(els.btnToggleInfo){
      els.btnToggleInfo.addEventListener("click", ()=>{
        const on = (els.introBox && els.introBox.style.display === "none") || (els.introBox && els.introBox.style.display === "");
        dom.show(els.introBox, !on ? true : false);
        if(els.btnToggleInfo) els.btnToggleInfo.textContent = (!on) ? "Dölj info" : "Visa info";
      });
    }

    if(els.btnShowAllBlocks){
      els.btnShowAllBlocks.addEventListener("click", ()=>{
        state.forceShowAll = !state.forceShowAll;
        els.btnShowAllBlocks.setAttribute("aria-pressed", String(state.forceShowAll));
        els.btnShowAllBlocks.textContent = state.forceShowAll ? "Sökläge" : "Visa alla";
        applyFilters(state, els);
        render.renderBlockList(els, state);
        render.renderTopPills(els, state);
      });
    }

    const reFilter = ()=>{
      applyFilters(state, els);
      render.renderBlockList(els, state);
      render.renderTopPills(els, state);
    };

    ["input","change"].forEach(evt=>{
      if(els.qBlocks) els.qBlocks.addEventListener(evt, reFilter);
      if(els.filterStatus) els.filterStatus.addEventListener(evt, reFilter);
      if(els.fHasQ) els.fHasQ.addEventListener(evt, reFilter);
      if(els.fHasD) els.fHasD.addEventListener(evt, reFilter);
      if(els.fNoKey) els.fNoKey.addEventListener(evt, reFilter);
      if(els.fUnverified) els.fUnverified.addEventListener(evt, reFilter);
    });

    // Print baseline: simple print of selected (browser print)
    if(els.btnPrint){
      els.btnPrint.addEventListener("click", ()=>{
        if(!state.selectedBlock) return;
        window.print();
      });
    }

    // Logout baseline
    if(els.navLogout){
      els.navLogout.addEventListener("click", (e)=>{
        e.preventDefault();
        try{
          if(window.HRApp && typeof window.HRApp.logout === "function") window.HRApp.logout();
        }catch(_){}
        // best-effort fallback
        try{ sessionStorage.clear(); }catch(_){}
        core.setMsg(els, "Utloggad.");
        location.href = "./home.html";
      });
    }

    // Verify/Publish/Save not implemented in baseline (we keep disabled if readOnly).
    // Next AO will wire these using strict contract.
  }

  function bootstrap(){
    const els = dom.els();
    core.setMsg(els, "Startar kontrollrummet…");

    // Require auth if HRApp exists (but don't hard-crash if not)
    const auth = core.requireAuth();
    const session = core.getSession();
    const role = (session && session.role) ? String(session.role) : (auth && auth.role ? String(auth.role) : "UNKNOWN");
    const empNo = (session && session.empNo) ? String(session.empNo) : "";
    const readOnly = core.isReadOnlyRole(role);

    // Load blocks (fail-closed if corrupt)
    const lb = store.loadBlocks();
    if(lb.corrupt){
      core.lockUI(els, [
        `Key ${core.BLOCKS_KEY} är korrupt JSON.`,
        "Åtgärd: rensa/återställ nyckeln eller återställ från backup/commit.",
        lb.error ? `Fel: ${lb.error}` : "Fel: JSON parse"
      ]);
      core.setMsg(els, "Kan inte starta: korrupt block-bank.");
      return;
    }

    const blocks = (lb.blocks || []).map(normalizeBlock).filter(Boolean);

    const state = {
      role,
      empNo,
      userLabel: empNo ? `${empNo} (${role})` : role,
      readOnly,
      blocks,
      viewBlocks: [],
      selectedId: "",
      selectedBlock: null,
      listIsIdle: true,
      forceShowAll: false,
      onSelect: null
    };

    state.onSelect = (id)=> onSelect(state, els, id);

    // If read-only: disable write actions
    dom.show(els.whoPill, true);
    dom.show(els.modePill, true);
    dom.disable(els.btnVerify, readOnly);
    dom.disable(els.btnPublish, readOnly);
    dom.disable(els.btnSaveEdits, readOnly);

    // First render
    applyFilters(state, els);
    render.renderBlockList(els, state);
    render.renderSelected(els, state);
    render.renderTopPills(els, state);

    // Minimal export area message (so it doesn't look broken)
    if(els.trainPreview){
      els.trainPreview.textContent = "Export-läget kopplas in i nästa AO (baseline: visar block-bank).";
    }
    if(els.btnToggleExport && els.exportBody){
      els.btnToggleExport.addEventListener("click", ()=>{
        const open = els.exportBody.style.display !== "none";
        els.exportBody.style.display = open ? "none" : "";
        els.btnToggleExport.textContent = open ? "Visa" : "Dölj";
      });
    }

    attach(els, state);
    core.setMsg(els, blocks.length ? "Klart. Sök eller tryck “Visa alla” för att se block." : "Klart. Inga block sparade ännu.");
  }

  // Crash-guard: show message instead of silent death
  window.addEventListener("error", function(ev){
    try{
      const els = (window.HRPKG && window.HRPKG.dom) ? window.HRPKG.dom.els() : null;
      if(els && els.msgBox){
        els.msgBox.textContent = "JS-fel: " + String(ev && ev.message ? ev.message : ev);
      }
    }catch(_){}
  });
  window.addEventListener("unhandledrejection", function(ev){
    try{
      const els = (window.HRPKG && window.HRPKG.dom) ? window.HRPKG.dom.els() : null;
      if(els && els.msgBox){
        els.msgBox.textContent = "JS-fel (promise): " + String(ev && ev.reason ? ev.reason : ev);
      }
    }catch(_){}
  });

  // Boot now
  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", bootstrap);
  }else{
    bootstrap();
  }

  window.HRPKG.page = { bootstrap };
})();


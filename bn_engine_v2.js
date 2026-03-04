// BN Engine v2 — Risks -> Themes -> Business Needs -> (Causes/Pains/Questions)
// Data source: bn_catalog.json (generated from "Копия Подход.xlsx")
// Storage: embedded into saved payload JSON under key "business_needs_sessions".

(function(){
  const WEBAPP_URL = (window.GS_WEBAPP_URL || '').trim();
  const VERSION = (window.BUILD_INFO && window.BUILD_INFO.version) ? window.BUILD_INFO.version : '';

  // Hardening: show JS errors as "data processing" not "Apps Script"
  window.addEventListener('error', (ev)=>{
    try{
      console.error('BN page error:', ev.error || ev.message || ev);
      if(typeof setStatus==='function'){
        setStatus('Ошибка обработки данных (см. Console).', 'err');
      }
    }catch(_e){}
  });
  window.addEventListener('unhandledrejection', (ev)=>{
    try{
      console.error('BN unhandledrejection:', ev.reason || ev);
      if(typeof setStatus==='function'){
        setStatus('Ошибка обработки данных (см. Console).', 'err');
      }
    }catch(_e){}
  });


  const THEME_ZONE_MAP = {
    'Видимость и охват': 'Серые зоны (охват / архитектура)',
    'CMDB и классификация': 'Серые зоны (охват / архитектура)',
    'Сетевое окружение и топология': 'Серые зоны (охват / архитектура)',
    'Эксплуатация и стабильность': 'Операционная неэффективность / ручной труд',
    'Изменения и DevOps': 'Операционная неэффективность / ручной труд',
    'SAM и оптимизация ПО': 'Лицензионный риск',
    'Комплаенс, аудит и импортозамещение': 'Лицензионный риск',
    'Стратегия, финансы и управляемость': 'Управляемость / отсутствие истории'
  };

  const UI = {
    companyLabel: () => document.getElementById('bnCompanyLabel'),
    themeList: () => document.getElementById('themeList'),
    needsList: () => document.getElementById('needsList'),
    needPanel: () => document.getElementById('needPanel'),
    summaryPanel: () => document.getElementById('bnSummary'),
    saveBtn: () => document.getElementById('bnSaveBtn'),
    status: () => document.getElementById('bnStatus'),
    fltTriggers: () => document.getElementById('bnFltTriggers'),
    fltCritical: () => document.getElementById('bnFltCritical'),
    fltMain: () => document.getElementById('bnFltMain')
  };

function themeHasTrigger_(theme){
  const r = (THEME_ABM && THEME_ABM[theme] && Array.isArray(THEME_ABM[theme].reasons)) ? THEME_ABM[theme].reasons : [];
  return r.some(x=>String(x||'').includes('Триггер'));
}
function themeHasCritical_(theme){
  const r = (THEME_ABM && THEME_ABM[theme] && Array.isArray(THEME_ABM[theme].reasons)) ? THEME_ABM[theme].reasons : [];
  return r.some(x=>String(x||'').includes('Critical'));
}
function bnIsMain_(bnId){
  try{
    const p = getSessionStore();
    const s = p?.business_needs_sessions?.[bnId];
    return !!(s && s.is_main);
  }catch(_){ return false; }
}


  let BN_CATALOG = null;
  let ACTIVE_COMPANY = '';
  let ACTIVE_ROW = null; // latest row object from Sheets (parsed)
  let HEATMAP = null;    // zone risks 0..1
  let THEME_RISKS = {};  // theme -> 0..1
  let THEME_ABM = {};    // theme -> ABM object {abm01, tier, reasons...}
  let ACTIVE_THEME = '';
  let ACTIVE_BN_ID = '';

  function esc(s){
    return String(s ?? '')
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'",'&#039;');
  }

  async function jsonp(url, timeoutMs = 45000, retries = 2) {
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await new Promise((resolve, reject) => {
        const cbName = 'cb_' + Math.random().toString(36).slice(2);
        let script = null;
        const t = setTimeout(() => {
          cleanup();
          reject(new Error('JSONP timeout'));
        }, timeoutMs);

        function cleanup() {
          clearTimeout(t);
          try { delete window[cbName]; } catch (e) { window[cbName] = undefined; }
          if (script && script.parentNode) script.parentNode.removeChild(script);
        }

        window[cbName] = (data) => { cleanup(); resolve(data); };

        const sep = url.includes('?') ? '&' : '?';
        script = document.createElement('script');
        script.src = url + sep + 'callback=' + encodeURIComponent(cbName) + '&_ts=' + Date.now();
        script.onerror = () => { cleanup(); reject(new Error('JSONP network error')); };
        document.head.appendChild(script);
      });

      return res;
    } catch (e) {
      if (attempt === retries) throw e;
      await new Promise(r => setTimeout(r, 400 * (attempt + 1)));
    }
  }
}

  function setStatus(msg, kind){
    const el = UI.status();
    if(!el) return;
    el.textContent = msg || '';
    el.className = 'bnStatus ' + (kind||'');
  }

  function parseTSVRowToObject(rowArr, keys){
    const obj = {};
    for(let i=0;i<keys.length;i++) obj[keys[i]] = rowArr[i] ?? '';
    return obj;
  }

  function tryParsePayload(rowObj){
    const raw = rowObj.payload;
    if(!raw) return {};
    try{ return JSON.parse(raw); }catch(e){ return {}; }
  }

  function normKey(s){
    let x = String(s||'').replace(/\s+/g,' ').trim();
    x = x.replace(/^(?:[TPА-ЯA-Z]{0,2}\s*)?\d+(?:[\.:]\d+)*[\.)\.:\-\s]+/i, '');
    x = x.replace(/^[TP]\s*\d+\s*[\.)\.:\-\s]+/i, '');
    return x.toLowerCase().replace(/ё/g,'е')
      .replace(/[“”"'`]/g,'')
      .replace(/\s+/g,' ')
      .replace(/[^0-9a-zа-я .\-_/():,?]+/g,'')
      .trim();
  }

  function normZone(z){
    const v = String(z||'').trim().toLowerCase();
    if(!v) return '';
    if(v.includes('лицен')) return 'Лицензионный риск';
    if(v.includes('руч') || v.includes('операц')) return 'Операционная неэффективность / ручной труд';
    if(v.includes('истор') || v.includes('управ')) return 'Управляемость / отсутствие истории';
    return 'Серые зоны (охват / архитектура)';
  }

  function getBankExpanded(){
    if(window.__ITMEN_BANK_EXPANDED) return window.__ITMEN_BANK_EXPANDED;
    const base = (window.ITMEN_QUESTION_BANK)||{};
    const exp = {};
    try{
      Object.entries(base).forEach(([k,v])=>{
        exp[String(k)] = v;
        const nk = normKey(k);
        if(nk) exp[nk] = v;
        const nk2 = nk.replace(/^[tp]\s*\d+\s*[\.)\-:\s]+/i,'').trim();
        if(nk2) exp[nk2] = v;
      });
    }catch(_e){}
    window.__ITMEN_BANK_EXPANDED = exp;
    return exp;
  }

  // Compute risks by zones from interview answers in ACTIVE_ROW.
  // Supports multiple schemas:
  // 1) tech_01_label + tech_01_score (preferred)
  // 2) tech_01_score only (fallback; uses question bank codes t1..t10)
  // 3) tech_01 answer strings (Да/Нет/Частично) (fallback)
  function computeHeatmapFromRow(row){
    const bank = getBankExpanded();
    const zones = {
      'Серые зоны (охват / архитектура)': {w:0,s:0},
      'Лицензионный риск': {w:0,s:0},
      'Операционная неэффективность / ручной труд': {w:0,s:0},
      'Управляемость / отсутствие истории': {w:0,s:0},
    };

    function parseScore(v){
      if(v===null || v===undefined || v==='') return null;
      const n = Number(v);
      if(!Number.isNaN(n) && isFinite(n)){
        if(n>=0 && n<=2) return n;
      }
      const s = String(v).trim().toLowerCase();
      if(!s) return null;
      if(s==='да' || s==='yes' || s==='y') return 2;
      if(s==='частично' || s==='част' || s==='partly') return 1;
      if(s==='нет' || s==='no' || s==='n') return 0;
      return null;
    }

    function handle(prefix, count){
      for(let i=1;i<=count;i++){
        const idx = String(i).padStart(2,'0');
        const label = (row[`${prefix}_${idx}_label`] || '').toString().trim();
        const scoreRaw = (row[`${prefix}_${idx}_score`] !== undefined) ? row[`${prefix}_${idx}_score`] : row[`${prefix}_${idx}`];
        const v = parseScore(scoreRaw);
        if(v===null) continue;

        // v: 0 Нет, 1 Частично, 2 Да
        const answerRisk = (v===2)?0 : (v===1)?0.5 : 1;
        const key = normKey(label);
        const mCode = label.match(/^\s*([TP])\s*(\d+)\s*[\.)]/i);
        const inferredCode = (prefix==='tech') ? ('t'+String(i)) : ('p'+String(i));
        const codeKey = mCode ? (mCode[1].toLowerCase()+mCode[2]) : inferredCode;
        const meta = (codeKey && bank[codeKey]) ? bank[codeKey] : (bank[key] || null);
        if(!meta) continue;

        const w = Number(meta.w)||1;
        const zone = normZone(meta.zone);
        if(!zones[zone]) zones[zone] = {w:0,s:0};
        zones[zone].w += w;
        zones[zone].s += w*answerRisk;
      }
    }

    const techCount = Number(row.tech_count)||10;
    const procCount = Number(row.proc_count)||10;
    handle('tech', Math.min(10, techCount));
    handle('proc', Math.min(10, procCount));

    const out = {};
    let totW=0, totS=0;
    Object.keys(zones).forEach(z=>{
      const Zw=zones[z].w;
      const Zs=zones[z].s;
      const risk = (Zw>0) ? (Zs/Zw) : null; // 0..1
      out[z] = risk;
      if(risk!==null){ totW += Zw; totS += Zs; }
    });
    out.__overall = (totW>0) ? (totS/totW) : null;
    return out;
  }
  // expose for debugging
  try{ window.computeThemeABM = computeThemeABM; }catch(_e){}

  function computeThemeRisks(heatmap){
    const m = heatmap || {};
    const grey = m['Серые зоны (охват / архитектура)'] ?? 0;
    const lic  = m['Лицензионный риск'] ?? 0;
    const ops  = m['Операционная неэффективность / ручной труд'] ?? 0;
    const gov  = m['Управляемость / отсутствие истории'] ?? 0;

    // split zones into 8 thematics (simple, deterministic)
    return {
      'Видимость и охват': grey,
      'CMDB и классификация': grey,
      'Сетевое окружение и топология': grey,
      'Эксплуатация и стабильность': ops,
      'Изменения и DevOps': ops,
      'SAM и оптимизация ПО': lic,
      'Комплаенс, аудит и импортозамещение': lic,
      'Стратегия, финансы и управляемость': gov,
    };

  // --- ABM scoring (sales-priority) -------------------------------------------------
  // Uses: client indices + heatmap + deal triggers to prioritize themes for ABM.
  // Output: THEME_ABM[theme] = { base01, basePct, boostPts, boost01, abm01, abmPct, tier, reasons[] }

  const ABM_MATRIX = {
    psi: [
      { when: (v)=> v < 30, add: { 'Видимость и охват': 25, 'CMDB и классификация': 20, 'Стратегия, финансы и управляемость': 20, 'Изменения и DevOps': 15 } },
      { when: (v)=> v >= 30 && v < 50, add: { 'Видимость и охват': 15, 'CMDB и классификация': 10, 'Стратегия, финансы и управляемость': 10 } },
    ],
    tech_index: [
      { when: (v)=> v < 40, add: { 'Видимость и охват': 20, 'Сетевое окружение и топология': 15, 'Эксплуатация и стабильность': 15 } },
      { when: (v)=> v >= 40 && v < 60, add: { 'Видимость и охват': 10, 'Сетевое окружение и топология': 8, 'Эксплуатация и стабильность': 8 } },
    ],
    proc_index: [
      { when: (v)=> v < 40, add: { 'Стратегия, финансы и управляемость': 25, 'Изменения и DevOps': 20, 'Эксплуатация и стабильность': 10 } },
      { when: (v)=> v >= 40 && v < 60, add: { 'Стратегия, финансы и управляемость': 12, 'Изменения и DevOps': 10 } },
    ],
    coi_rub: [
      { when: (v)=> v >= 10_000_000, add: { 'Эксплуатация и стабильность': 25, 'SAM и оптимизация ПО': 20, 'Стратегия, финансы и управляемость': 15 } },
      { when: (v)=> v >= 3_000_000 && v < 10_000_000, add: { 'Эксплуатация и стабильность': 15, 'SAM и оптимизация ПО': 12 } },
    ],
    triggers_yes: [
      { key: 'risk_01_val', add: { 'Видимость и охват': 12, 'CMDB и классификация': 10 } }, // распределенная инфраструктура
      { key: 'risk_03_val', add: { 'Эксплуатация и стабильность': 15, 'Стратегия, финансы и управляемость': 10 } }, // много ручных операций
      { key: 'risk_04_val', add: { 'SAM и оптимизация ПО': 20, 'Комплаенс, аудит и импортозамещение': 15 } }, // риск неучтенного ПО
      { key: 'risk_05_val', add: { 'Эксплуатация и стабильность': 20, 'Изменения и DevOps': 10 } }, // частые инциденты/простои
      { key: 'risk_06_val', add: { 'Комплаенс, аудит и импортозамещение': 25, 'SAM и оптимизация ПО': 15 } }, // были внешние проверки
      { key: 'risk_07_val', add: { 'Изменения и DevOps': 20, 'Стратегия, финансы и управляемость': 10 } }, // планируются крупные изменения
    ],
    critical: [
      { key: 'tech_01_score', when: (v)=> v === 0, add: { 'Видимость и охват': 25, 'CMDB и классификация': 15 } },
      { key: 'tech_04_score', when: (v)=> v === 0, add: { 'Видимость и охват': 15, 'Сетевое окружение и топология': 15 } },
      { key: 'proc_01_score', when: (v)=> v === 0, add: { 'Стратегия, финансы и управляемость': 20 } },
      { key: 'proc_02_score', when: (v)=> v === 0, add: { 'Стратегия, финансы и управляемость': 20 } },
    ],
  };

  function toNum(v){
    if(v==null) return null;
    if(typeof v === 'number') return isFinite(v) ? v : null;
    const s = String(v).replace(/[\s\u00A0]/g,'').replace(',','.');
    const m = s.match(/-?\d+(?:\.\d+)?/);
    if(!m) return null;
    const n = Number(m[0]);
    return isFinite(n) ? n : null;
  }

  function isYes(v){
    if(v===true) return true;
    if(v===false) return false;
    const s = String(v||'').trim().toLowerCase();
    return (s==='да' || s==='yes' || s==='y' || s==='true' || s==='1');
  }

  function addBoost(boostMap, reasonsMap, theme, pts, reason){
    if(!theme || !isFinite(pts) || pts===0) return;
    boostMap[theme] = (boostMap[theme] || 0) + pts;
    if(reason){
      if(!reasonsMap[theme]) reasonsMap[theme] = [];
      reasonsMap[theme].push(reason);
    }
  }

  function applyRuleSet(value, rules, boostMap, reasonsMap, label){
    if(value==null) return;
    for(const r of rules){
      try{
        if(r.when(value)){
          for(const [t,pts] of Object.entries(r.add||{})){
            addBoost(boostMap, reasonsMap, t, pts, `${label}: ${Math.round(value)} → +${pts}`);
          }
        }
      }catch(_){}
    }
  }

  function computeThemeABM(rowObj, themeRisks01){
    const themes = (BN_CATALOG && BN_CATALOG.themes) ? BN_CATALOG.themes : Object.keys(themeRisks01||{});
    const boostPts = {};
    const reasons = {};

    // indices from DB headers: psi2Score, techIndex, procIndex, coi_total_loss
    const psi = toNum(rowObj?.psi2Score);
    const tech = toNum(rowObj?.techIndex);
    const proc = toNum(rowObj?.procIndex);
    const coi = toNum(rowObj?.coi_total_loss);

    applyRuleSet(psi, ABM_MATRIX.psi, boostPts, reasons, 'PSI');
    applyRuleSet(tech, ABM_MATRIX.tech_index, boostPts, reasons, 'TechIndex');
    applyRuleSet(proc, ABM_MATRIX.proc_index, boostPts, reasons, 'ProcIndex');
    applyRuleSet(coi, ABM_MATRIX.coi_rub, boostPts, reasons, 'COI ₽/год');

    // triggers (yes/no)
    for(const tr of ABM_MATRIX.triggers_yes){
      const v = rowObj?.[tr.key];
      if(isYes(v)){
        for(const [t,pts] of Object.entries(tr.add||{})){
          addBoost(boostPts, reasons, t, pts, `Триггер ${tr.key}=Да → +${pts}`);
        }
      }
    }

    // critical flags
    for(const c of ABM_MATRIX.critical){
      const v = toNum(rowObj?.[c.key]);
      if(v==null) continue;
      try{
        if(c.when(v)){
          for(const [t,pts] of Object.entries(c.add||{})){
            addBoost(boostPts, reasons, t, pts, `Critical ${c.key}=${v} → +${pts}`);
          }
        }
      }catch(_){}
    }

    // build ABM map
    const out = {};
    for(const t of themes){
      const base01 = Number(themeRisks01?.[t] ?? 0) || 0;
      const basePct = Math.max(0, Math.min(100, base01*100));
      const bPts = Math.max(0, boostPts[t] || 0);
      const b01 = Math.min(1, bPts/100); // normalize by 100 pts
      const abm01 = Math.max(0, Math.min(1, 0.55*base01 + 0.45*b01));
      out[t] = {
        base01, basePct: Math.round(basePct),
        boostPts: Math.round(bPts), boost01: b01,
        abm01, abmPct: Math.round(abm01*100),
        reasons: reasons[t] || [],
        tier: 'roadmap',
      };
    }

    // tiers: top-2 primary, next-2 secondary
    const sorted = Object.entries(out).sort((a,b)=> (b[1].abm01 - a[1].abm01));
    sorted.slice(0,2).forEach(([t])=> out[t].tier='primary');
    sorted.slice(2,4).forEach(([t])=> out[t].tier='secondary');

    return out;
  }
  // -------------------------------------------------------------------------------

  }

  function strengthForBN(bn){
    const zoneKey = normZone(bn.zone);
    const zoneRisk = (HEATMAP && HEATMAP[zoneKey]!=null) ? HEATMAP[zoneKey] : 0;
    const riskPct = zoneRisk * 100;
    const weight = Number(bn.weight)||1;
    // strength: risk × weight/3
    return (riskPct * (weight/3));
  }

  function groupBNByTheme(items){
    const map = {};
    (items||[]).forEach(bn=>{
      const t = bn.theme || 'Стратегия, финансы и управляемость';
      if(!map[t]) map[t] = [];
      map[t].push(bn);
    });
    Object.keys(map).forEach(t=>{
      map[t].sort((a,b)=> strengthForBN(b) - strengthForBN(a));
    });
    return map;
  }

  function fmtPct01(v){
    if(v==null || !isFinite(Number(v))) return '—';
    return Math.round(Number(v)*100) + '%';
  }

  function renderThemes(){
    const list = UI.themeList();
    if(!list) return;

    const baseThemes = (BN_CATALOG && BN_CATALOG.themes) ? BN_CATALOG.themes : Object.keys(THEME_RISKS||{});
    const themes = [...baseThemes].sort((a,b)=>{
      const aa = (THEME_ABM && THEME_ABM[a]) ? THEME_ABM[a].abm01 : (THEME_RISKS[a]||0);
      const bb = (THEME_ABM && THEME_ABM[b]) ? THEME_ABM[b].abm01 : (THEME_RISKS[b]||0);
      return bb - aa;
    });

    const rows = themes.map(t=>{
      const r01 = Number(THEME_RISKS[t] || 0) || 0;
      const abm = (THEME_ABM && THEME_ABM[t]) ? THEME_ABM[t] : null;
      const active = (t===ACTIVE_THEME) ? ' active' : '';
      const tier = abm ? abm.tier : 'roadmap';
      const tierLabel = tier==='primary' ? 'Primary' : (tier==='secondary' ? 'Secondary' : '');
      const meta = abm
        ? `Риск: <b>${fmtPct01(r01)}</b> · ABM: <b>${Math.round((abm.abm01||0)*100)}%</b>${tierLabel?` · <span class="tier ${tier}">${tierLabel}</span>`:''}`
        : `Риск: <b>${fmtPct01(r01)}</b>`;
      const barPct = abm ? Math.round((abm.abm01||0)*100) : Math.round(r01*100);

      return `<button class="tabBtn${active}" data-theme="${esc(t)}">
  <div class="tabTitle">${esc(t)}</div>
  <div class="tabMeta">${meta}</div>
  <div class="miniBar"><i style="width:${barPct}%"></i></div>
</button>`;
    }).join('');

    list.innerHTML = rows || '<div class="small">Нет данных — выбери компанию и заполни интервью.</div>';

    list.querySelectorAll('button[data-theme]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        ACTIVE_THEME = btn.getAttribute('data-theme') || '';
        renderThemes();
        renderNeeds();
      }, {passive:true});
    });
  }

  function renderNeeds(){
    const box = UI.needsList();
    if(!box) return;
    if(!BN_CATALOG){ box.innerHTML=''; return; }

    const all = BN_CATALOG.items || [];
    const grouped = groupBNByTheme(all);

    const theme = ACTIVE_THEME || Object.keys(grouped).sort((a,b)=> (THEME_RISKS[b]||0)-(THEME_RISKS[a]||0))[0] || '';
    ACTIVE_THEME = theme;

    // IMPORTANT UX CHANGE:
    // Previously we hid BN items when "strength" was 0 (risk low / answers indicate "everything ok").
    // This made the page look "broken" for companies with low calculated risk.
    // Now we always show BN list; items with 0 strength are marked as "не активировано" but still selectable.
    const bnList = (grouped[theme] || []);


// filters (manager helper)
const fTrig = !!(UI.fltTriggers() && UI.fltTriggers().checked);
const fCrit = !!(UI.fltCritical() && UI.fltCritical().checked);
const fMain = !!(UI.fltMain() && UI.fltMain().checked);

let filtered = bnList;
if(fTrig) filtered = filtered.filter(x=> themeHasTrigger_(x.theme || theme));
if(fCrit) filtered = filtered.filter(x=> themeHasCritical_(x.theme || theme));
if(fMain) filtered = filtered.filter(x=> bnIsMain_(x.id));

    // show only Top N inside theme (keeps UX small)
    const TOP_N = 10;
    const top = filtered.slice(0, TOP_N);

    if(!top.length){
      box.innerHTML = `<div class="small">По тематике «${esc(theme)}» нет бизнес‑потребностей в каталоге.</div>`;
      UI.needPanel().innerHTML = `<div class="muted">Выбери бизнес‑потребность слева.</div>`;
      renderThemes();
      return;
    }

    if(!ACTIVE_BN_ID || !top.some(x=>x.id===ACTIVE_BN_ID)) ACTIVE_BN_ID = top[0].id;

    box.innerHTML = top.map(bn=>{
      const active = (bn.id===ACTIVE_BN_ID) ? ' active' : '';
      const s = Math.round(strengthForBN(bn));
      const sLabel = (s>0) ? String(s) : '0 (не активировано)';
      const main = bnIsMain_(bn.id);
      const star = main ? ' <span class="star">★</span>' : '';
      return `<button class="tabBtn${active}" data-bn="${esc(bn.id)}">
        <div class="tabTitle">${esc(bn.name)}${star}</div>
        <div class="tabMeta">Сила: <b>${Math.round(str)}</b>${act?` (активировано)`:` (не активировано)`} · Вес: <b>${bn.weight||1}</b> · Зона: <b>${esc(bn.zone||'—')}</b></div>
        <div class="miniBar"><i style="width:${Math.min(100,Math.max(0,Math.round(str)))}%"></i></div>
      </button>`;
    }).join('');

    box.querySelectorAll('button[data-bn]').forEach(btn=>{
      btn.addEventListener('click', ()=>{
        ACTIVE_BN_ID = btn.getAttribute('data-bn') || '';
        renderNeeds();
        renderNeedPanel();
      }, {passive:true});
    });

    renderThemes();
    renderNeedPanel();
  }

  function getSessionStore(){
    const payload = tryParsePayload(ACTIVE_ROW || {});
    if(!payload.business_needs_sessions) payload.business_needs_sessions = {};
    return payload;
  }

  function ensureBnSession(payload, bnId){
    payload.business_needs_sessions = payload.business_needs_sessions || {};
    if(!payload.business_needs_sessions[bnId]){
      payload.business_needs_sessions[bnId] = {
        bn_id: bnId,
        theme: ACTIVE_THEME || '',
        strength: 0,
        selected_causes: [],
        selected_pains: [],
        answers: {},
        manager_notes: '',
        is_main: false,
        manager_comment: ''
      };
    }
    return payload.business_needs_sessions[bnId];
  }

  function renderNeedPanel(){
    const panel = UI.needPanel();
    if(!panel) return;

    if(!ACTIVE_ROW){
      panel.innerHTML = '<div class="muted">Сначала выбери компанию и нажми «Загрузить».</div>';
      return;
    }

    const bn = (BN_CATALOG.items || []).find(x=>x.id===ACTIVE_BN_ID);
    if(!bn){ panel.innerHTML='<div class="muted">Выбери бизнес‑потребность слева.</div>'; return; }

    const payload = getSessionStore();
    const sess = ensureBnSession(payload, bn.id);
    sess.strength = strengthForBN(bn);

    const causes = bn.causes || [];
    const pains  = bn.pains || [];
    const questions = bn.questions || [];

    function isChecked(arr, v){ return Array.isArray(arr) && arr.includes(v); }

    
panel.innerHTML = `
  <div class="needHead" style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:10px">
    <div>
      <div class="needTitle">${esc(bn.name)}</div>
      <div class="small">Тематика: <b>${esc(bn.theme||'—')}</b> · Зона: <b>${esc(bn.zone||'—')}</b> · Сила: <b>${Math.round(sess.strength)}</b></div>
      <div style="margin-top:8px;display:flex;gap:10px;flex-wrap:wrap">
        <label class="pill"><input type="checkbox" id="bnIsMain" ${sess.is_main?'checked':''}/> <span class="star">★</span> Основная</label>
      </div>
    </div>
    <div class="needHeadRight" style="display:flex;gap:10px">
      <button type="button" class="btn ghost" id="bnCollapseAll">Свернуть</button>
      <button type="button" class="btn" id="bnSaveNow">Сохранить</button>
    </div>
  </div>

  <div class="workTop">
    <div class="workBox">
      <h3>Подробное описание</h3>
      <div class="blockText">${esc(bn.task || '—')}</div>
      <div class="hr" style="margin:12px 0"></div>
      <h3>Комментарий менеджера</h3>
      <textarea class="qAns" id="bnMgrComment" placeholder="Коротко: что подтвердили / следующий шаг">${esc(sess.manager_comment||'')}</textarea>
    </div>

    <div class="workBox">
      <h3>Вопросы</h3>
      <div class="qaGrid">
        ${questions.map((q,idx)=>`<div class="qRow"><div class="qTxt">${esc(q)}</div></div>`).join('')}
      </div>
    </div>

    <div class="workBox">
      <h3>Ответы</h3>
      <div class="qaGrid">
        ${questions.map((q,idx)=>{
          const key = `q_${idx}`;
          const val = (sess.answers && sess.answers[key]) ? sess.answers[key] : '';
          return `<div class="qRow"><textarea class="qAns" data-kind="answer" data-q="${esc(key)}" placeholder="Ответ (фиксируем как есть)">${esc(val)}</textarea></div>`;
        }).join('')}
      </div>
    </div>
  </div>

  <div class="workBelow">
    <div class="workBox">
      <h3>Причины (отметь, что подтверждено)</h3>
      <div class="checkGrid">
        ${causes.map((c,idx)=>{
          const id = `c_${bn.id}_${idx}`;
          return `<label class="checkItem" for="${esc(id)}"><input type="checkbox" id="${esc(id)}" data-kind="cause" value="${esc(c)}" ${isChecked(sess.selected_causes,c)?'checked':''}/> <span>${esc(c)}</span></label>`;
        }).join('')}
      </div>

      <div class="hr" style="margin:12px 0"></div>
      <h3>Боли (что реально болит)</h3>
      <div class="checkGrid">
        ${pains.map((p,idx)=>{
          const id = `p_${bn.id}_${idx}`;
          return `<label class="checkItem" for="${esc(id)}"><input type="checkbox" id="${esc(id)}" data-kind="pain" value="${esc(p)}" ${isChecked(sess.selected_pains,p)?'checked':''}/> <span>${esc(p)}</span></label>`;
        }).join('')}
      </div>

      <div class="hr" style="margin:12px 0"></div>
      <h3>ITIL / KPI</h3>
      <div class="small">${esc((bn.itil||'') + (bn.kpi?(' · KPI: '+bn.kpi):'')) || '—'}</div>
    </div>

    <div class="workBox">
      <h3>Нужный функционал</h3>
      <div class="blockText">${esc(bn.functional || '—')}</div>
      <div class="hr" style="margin:12px 0"></div>
      <h3>Ожидаемый результат</h3>
      <div class="blockText">${esc(bn.result || '—')}</div>
    </div>
  </div>

  <div class="workOne workBox">
    <h3>Стратегическое резюме</h3>
    <div id="bnStrategicSummary" class="blockText"></div>
  </div>
`;
                return `<label class="checkItem" for="${esc(id)}"><input type="checkbox" id="${esc(id)}" data-kind="cause" value="${esc(c)}" ${isChecked(sess.selected_causes,c)?'checked':''}/> <span>${esc(c)}</span></label>`;
              }).join('') || '<div class="small">—</div>'}
            </div>
          </details>
        </div>

        <div class="block">
          <details open class="details" id="detPains">
            <summary>Боли (что реально болит)</summary>
            <div class="checkGrid">
              ${pains.map((p,idx)=>{
                const id = `p_${bn.id}_${idx}`;
                return `<label class="checkItem" for="${esc(id)}"><input type="checkbox" id="${esc(id)}" data-kind="pain" value="${esc(p)}" ${isChecked(sess.selected_pains,p)?'checked':''}/> <span>${esc(p)}</span></label>`;
              }).join('') || '<div class="small">—</div>'}
            </div>
          </details>
        </div>

        <div class="block">
          <details open class="details" id="detQ">
            <summary>Вопросы (фиксируем ответы)</summary>
            <div class="qList">
              ${questions.map((q,idx)=>{
                const key = `q${idx+1}`;
                const val = (sess.answers && sess.answers[key]) ? String(sess.answers[key]) : '';
                return `<div class="qItem">
                  <div class="qText">${esc(q)}</div>
                  <textarea class="qAnswer" data-qkey="${esc(key)}" placeholder="Ответ (фиксируем как есть)">${esc(val)}</textarea>
                </div>`;
              }).join('') || '<div class="small">—</div>'}
            </div>
          </details>
        </div>

        <div class="block">
          <details class="details" open id="detIt">
            <summary>ITIL комментарий</summary>
            <div class="blockText">${esc(bn.itil || '—')}</div>
          </details>
        </div>

        <div class="block">
          <details class="details" open id="detMgr">
            <summary>Подсказки менеджеру</summary>
            <div class="twoCols">
              <div>
                <div class="miniTitle">В каком процессе используется</div>
                <div class="blockText">${esc(bn.process || '—')}</div>
              </div>
              <div>
                <div class="miniTitle">Какой KPI улучшает</div>
                <div class="blockText">${esc(bn.kpi || '—')}</div>
              </div>
            </div>
          </details>
        </div>

        <div class="block">
          <details class="details" open id="detFunc">
            <summary>Нужный функционал ИТМен</summary>
            <div class="blockText">${esc(bn.functional || '—')}</div>
          </details>
        </div>

        <div class="block">
          <details class="details" id="detRes">
            <summary>Ожидаемый результат</summary>
            <div class="blockText">${esc(bn.result || '—')}</div>
          </details>
        </div>

      </div>
    `;

    // bind inputs
    panel.querySelectorAll('input[type="checkbox"][data-kind]').forEach(ch=>{
      ch.addEventListener('change', ()=>{
        const kind = ch.getAttribute('data-kind');
        const val = ch.value;
        if(kind==='cause'){
          sess.selected_causes = Array.isArray(sess.selected_causes) ? sess.selected_causes : [];
          if(ch.checked && !sess.selected_causes.includes(val)) sess.selected_causes.push(val);
          if(!ch.checked) sess.selected_causes = sess.selected_causes.filter(x=>x!==val);
        }else{
          sess.selected_pains = Array.isArray(sess.selected_pains) ? sess.selected_pains : [];
          if(ch.checked && !sess.selected_pains.includes(val)) sess.selected_pains.push(val);
          if(!ch.checked) sess.selected_pains = sess.selected_pains.filter(x=>x!==val);
        }
      }, {passive:true});
    
const mainCb = panel.querySelector('#bnIsMain');
mainCb && mainCb.addEventListener('change', ()=>{
  sess.is_main = !!mainCb.checked;
  try{ renderNeeds(); }catch(e){ console.error(e); }
});

const mgrTa = panel.querySelector('#bnMgrComment');
mgrTa && mgrTa.addEventListener('input', ()=>{
  sess.manager_comment = mgrTa.value;
});

});

    panel.querySelectorAll('textarea.qAnswer[data-qkey]').forEach(ta=>{
      ta.addEventListener('input', ()=>{
        const key = ta.getAttribute('data-qkey');
        sess.answers = sess.answers || {};
        sess.answers[key] = ta.value;
      });
    });

    const collapseBtn = panel.querySelector('#bnCollapseAll');
    collapseBtn && collapseBtn.addEventListener('click', ()=>{
      panel.querySelectorAll('details.details').forEach(d=>{ d.open = false; });
    });

    const saveNow = panel.querySelector('#bnSaveNow');
    saveNow && saveNow.addEventListener('click', async ()=>{
      await saveCurrent();
    });

    // keep row object updated
    ACTIVE_ROW.payload = JSON.stringify(payload);

    try{
      const sumEl = panel.querySelector('#bnStrategicSummary');
      if(sumEl){
        const topCauses = (sess.selected_causes||[]).slice(0,4);
        const topPains = (sess.selected_pains||[]).slice(0,4);
        const ansCount = sess.answers ? Object.values(sess.answers).filter(x=>String(x||'').trim()).length : 0;
        sumEl.innerHTML = `<b>Что важно:</b> сила ${Math.round(sess.strength)} · ответов: ${ansCount}`
          + (sess.is_main?` · <span class="star">★ основная</span>`:'')
          + (topCauses.length?`<br><b>Причины:</b> ${topCauses.map(esc).join(' · ')}`:'')
          + (topPains.length?`<br><b>Боли:</b> ${topPains.map(esc).join(' · ')}`:'')
          + (bn.result?`<br><b>Ожидаемый результат:</b> ${esc(bn.result)}`:'');
      }
    }catch(e){ console.error(e); }

    renderSummary();
  }

  function renderSummary(){
    const el = UI.summaryPanel();
    if(!el) return;
    const payload = tryParsePayload(ACTIVE_ROW||{});
    const sessMap = payload.business_needs_sessions || {};
    const entries = Object.values(sessMap);
    if(!entries.length){
      el.innerHTML = '<div class="muted">Заполни причины/боли/ответы — здесь появится стратегическое резюме.</div>';
      return;
    }

    // sort by strength
    entries.sort((a,b)=> (Number(b.strength)||0) - (Number(a.strength)||0));
    const top3 = entries.slice(0,3);

    const bnById = {};
    (BN_CATALOG.items||[]).forEach(x=>{ bnById[x.id]=x; });

    // functional aggregation
    const funcSet = new Set();
    for(const e of entries){
      const bn = bnById[e.bn_id];
      if(!bn) continue;
      const txt = (bn.functional||'').split(/\n+/).map(x=>x.trim()).filter(Boolean);
      txt.forEach(x=> funcSet.add(x));
    }

    el.innerHTML = `
      <div class="card">
        <div class="sectionTitle">Стратегическое резюме</div>
        <div class="small">Собрано автоматически по отмеченным бизнес‑потребностям + вес/риск.</div>
        <div class="hr"></div>

        <div class="block">
          <div class="blockTitle">Ключевые 3 бизнес‑задачи</div>
          <ol class="ol">
            ${top3.map(e=>{
              const bn = bnById[e.bn_id] || {name:e.bn_id};
              return `<li><b>${esc(bn.name)}</b> <span class="muted">(сила ${Math.round(Number(e.strength)||0)})</span></li>`;
            }).join('')}
          </ol>
        </div>

        <div class="block">
          <div class="blockTitle">Необходимый функционал на демонстрации</div>
          <ul class="ul">
            ${Array.from(funcSet).slice(0,30).map(x=>`<li>${esc(x)}</li>`).join('') || '<li>—</li>'}
          </ul>
        </div>

        <div class="block">
          <div class="blockTitle">Дальнейшие действия (черновик)</div>
          <div class="blockText">1) Подтвердить 2–3 боли цифрами (в ITSM/учёте/мониторинге). 2) На демо показать сценарии под Top‑3 BN. 3) Зафиксировать пилотную цель (покрытие/CMDB/SAM/Change) и KPI успеха.</div>
        </div>

      </div>
    `;
  }

  async function saveCurrent(){
    if(!WEBAPP_URL){ setStatus('GS_WEBAPP_URL пустой (config.js).', 'err'); return; }
    if(!ACTIVE_ROW){ setStatus('Не выбрана компания.', 'err'); return; }

    const payloadObj = tryParsePayload(ACTIVE_ROW);
    // attach helper info
    payloadObj.__bn_saved_at = new Date().toISOString();
    payloadObj.__bn_version = VERSION;

    // Compose "payload" row (we rely on Apps Script storing payload JSON)
    const base = WEBAPP_URL;
    const url = base + (base.includes('?') ? '&' : '?') + 'action=save';

    try{
      setStatus('Сохраняю…', 'warn');
      const body = 'action=save&payload=' + encodeURIComponent(JSON.stringify(payloadObj));
      const res = await fetch(url, {
        method:'POST',
        headers:{'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
        body
      });
      const text = await res.text();
      let data = null;
      try{ data = JSON.parse(text); }catch(_e){}
      if(!data || !data.ok){
        setStatus('Ошибка сохранения (action=save). Проверь Apps Script.', 'err');
        console.warn('save response', text);
        return;
      }
      setStatus('Сохранено.', 'ok');
    }catch(e){
      console.error(e);
      setStatus('Ошибка сети при сохранении.', 'err');
    }
  }

  // ===== QuickDock: search + load, consistent with other pages =====
  let searchTimer = null;
  let searchSeq = 0;

  function bindQuickDock(){
    const input = document.getElementById('dockCompany');
    const suggest = document.getElementById('dockSuggest');
    const loadBtn = document.getElementById('dockLoadBtn');

    if(!input || !suggest) return;

    input.addEventListener('input', ()=>{
      clearTimeout(searchTimer);
      const q = input.value.trim();
      if(q.length < 3){ suggest.style.display='none'; suggest.innerHTML=''; return; }
      const mySeq = ++searchSeq;
      suggest.style.display='block';
      suggest.innerHTML = `<div class="dockItem"><b>Ищу…</b><div class="small">${esc(q)}</div></div>`;
      searchTimer = setTimeout(()=> runSearch(q, mySeq), 250);
    });

    if(loadBtn){
      loadBtn.addEventListener('click', ()=>{
        const c = input.value.trim();
        if(c) loadCompany(c);
      });
    }

    // collapse toggle (same logic as other pages)
    const KEY = 'itmen_dock_collapsed_v1';
    const btn = document.getElementById('dockToggle');
    function apply(){
      const collapsed = (localStorage.getItem(KEY) === '1');
      document.body.classList.toggle('dockCollapsed', collapsed);
      if(btn) btn.textContent = collapsed ? '▶' : '◀';
      if(btn) btn.title = collapsed ? 'Развернуть панель' : 'Свернуть панель';
    }
    try{ apply(); }catch(_e){}
    btn && btn.addEventListener('click', ()=>{
      const collapsed = document.body.classList.contains('dockCollapsed');
      try{ localStorage.setItem(KEY, collapsed ? '0' : '1'); }catch(_e){}
      apply();
    });

    // auto-load by query param
    const params = new URLSearchParams(location.search);
    const c = params.get('company');
    if(c){
      input.value = c;
      loadCompany(c);
    }
  }

  async function runSearch(q, mySeq){
    if(!WEBAPP_URL) return;
    try{
      const url = WEBAPP_URL + '?action=search&q=' + encodeURIComponent(q) + '&limit=25';
      const data = await jsonp(url, 45000);
      if(mySeq !== searchSeq) return;
      if(!data || !data.ok){ return; }
      const items = Array.isArray(data.items) ? data.items : [];
      const map = new Map();
      for(const it of items){
        const name = (it.company||'').trim();
        if(!name) continue;
        const ts = it.timestamp || '';
        const prev = map.get(name);
        if(!prev) map.set(name, {name, ts});
        else if(ts && (!prev.ts || ts > prev.ts)) prev.ts = ts;
      }
      const list = Array.from(map.values()).sort((a,b)=>(b.ts||'').localeCompare(a.ts||''));
      const suggest = document.getElementById('dockSuggest');
      if(!suggest) return;
      if(!list.length){ suggest.style.display='none'; suggest.innerHTML=''; return; }
      suggest.innerHTML = list.slice(0,10).map(it=>
        `<div class="dockItem" data-company="${esc(it.name)}"><b>${esc(it.name)}</b><div class="small">Обновлено: ${esc(it.ts||'—')}</div></div>`
      ).join('');
      suggest.style.display='block';
      suggest.querySelectorAll('.dockItem[data-company]').forEach(el=>{
        el.addEventListener('click', ()=>{
          const c = el.getAttribute('data-company')||'';
          document.getElementById('dockCompany').value = c;
          suggest.style.display='none';
          suggest.innerHTML='';
          loadCompany(c);
        });
      });
    }catch(e){
      // ignore
    }
  }

  async function loadCompany(company){
    if(!WEBAPP_URL){ setStatus('GS_WEBAPP_URL пустой (config.js).', 'err'); return; }
    ACTIVE_COMPANY = company;
    ACTIVE_ROW = null;
    HEATMAP = null;
    THEME_RISKS = {};
    ACTIVE_THEME = '';
    ACTIVE_BN_ID = '';

    if(UI.companyLabel()) UI.companyLabel().textContent = company;
    setStatus('Загружаю данные…', 'warn');

    try{
      // 1) get latest row for company
      // Apps Script router uses action=latest (alias of get). Keep legacy getLatest by also supporting alias on backend.
      const url = WEBAPP_URL + '?action=latest_bn&company=' + encodeURIComponent(company);
      const data = await jsonp(url, 45000);

// Apps Script may return either:
//  - legacy: { ok:true, row:[...] } where row is an array aligned to SHEET_KEYS
//  - compact: { ok:true, payload:{...} } or { ok:true, item:{...} } where payload/item is already an object
if(!data || !data.ok){
  setStatus('Не найдено данных по компании. Сначала заполни интервью/индексы.', 'err');
  return;
}

let rowObj = null;
if (Array.isArray(data.row)) {
  const keys = (window.SHEET_KEYS || []);
  rowObj = parseTSVRowToObject(data.row, keys);
} else if (data.payload && typeof data.payload === 'object') {
  rowObj = data.payload;
} else if (data.item && typeof data.item === 'object') {
  rowObj = data.item;
}

if(!rowObj){
  // We got a response but it doesn't include a usable row.
  setStatus('Данные по компании не подцепились (формат ответа latest_bn).', 'err');
  return;
}

ACTIVE_ROW = rowObj;

      // 2) compute heatmap from saved tech/proc answers
      HEATMAP = computeHeatmapFromRow(rowObj);
      THEME_RISKS = computeThemeRisks(HEATMAP);
            // ABM scoring (hardened)
      try{
        if(typeof computeThemeABM==='function'){
          THEME_ABM = computeThemeABM(rowObj, THEME_RISKS) || {};
        }else{
          console.warn('computeThemeABM is not defined — fallback to base risk ordering');
          THEME_ABM = {};
        }
      }catch(e){
        console.error('computeThemeABM error:', e);
        THEME_ABM = {};
      }

      // 3) render
      setStatus('Данные загружены. Выбери тематику и BN.', 'ok');
      renderThemes();
      renderNeeds();
      try{
      const sumEl = panel.querySelector('#bnStrategicSummary');
      if(sumEl){
        const topCauses = (sess.selected_causes||[]).slice(0,4);
        const topPains = (sess.selected_pains||[]).slice(0,4);
        const ansCount = sess.answers ? Object.values(sess.answers).filter(x=>String(x||'').trim()).length : 0;
        sumEl.innerHTML = `<b>Что важно:</b> сила ${Math.round(sess.strength)} · ответов: ${ansCount}`
          + (sess.is_main?` · <span class="star">★ основная</span>`:'')
          + (topCauses.length?`<br><b>Причины:</b> ${topCauses.map(esc).join(' · ')}`:'')
          + (topPains.length?`<br><b>Боли:</b> ${topPains.map(esc).join(' · ')}`:'')
          + (bn.result?`<br><b>Ожидаемый результат:</b> ${esc(bn.result)}`:'');
      }
    }catch(e){ console.error(e); }

    renderSummary();

      // update query string for share
      const qs = '?company=' + encodeURIComponent(company);
      history.replaceState(null,'', location.pathname + qs);

      // update quickdock links
      try{ updateDockLinks(company); }catch(_e){}

    }catch(e){
      console.error(e);
      setStatus('Ошибка обработки данных (см. Console).', 'err');
    }
  }

  function updateDockLinks(company){
    const qs = company ? ('?company='+encodeURIComponent(company)) : '';
    document.querySelectorAll('.toolGrid a.tool').forEach(a=>{
      const href = a.getAttribute('href')||'';
      if(!href || href.startsWith('http')) return;
      const base = href.split('?')[0];
      const v = href.includes('v=') ? href.split('v=')[1] : '';
      const ver = v ? ('?v='+encodeURIComponent(v)) : '';
      // keep existing v param, add company
      const join = ver ? (ver + '&company='+encodeURIComponent(company)) : ('?company='+encodeURIComponent(company));
      a.setAttribute('href', base + join);
    });
  }

  async function loadCatalog(){
    try{
      const res = await fetch('bn_catalog.json?v=' + encodeURIComponent(VERSION||'1'));
      BN_CATALOG = await res.json();
    }catch(e){
      console.error('bn_catalog load error', e);
      BN_CATALOG = {themes:[], items:[]};
    }
  }

  document.addEventListener('DOMContentLoaded', async ()=>{
    await loadCatalog();
    bindQuickDock();

// BN filters
[UI.fltTriggers(), UI.fltCritical(), UI.fltMain()].forEach(el=>{
  if(!el) return;
  el.addEventListener('change', ()=>{ try{ renderNeeds(); }catch(e){ console.error(e); } });
});

    // Save button (top)
    const topSave = UI.saveBtn();
    topSave && topSave.addEventListener('click', saveCurrent);

    // initial empty render
    renderThemes();
    renderNeeds();
    try{
      const sumEl = panel.querySelector('#bnStrategicSummary');
      if(sumEl){
        const topCauses = (sess.selected_causes||[]).slice(0,4);
        const topPains = (sess.selected_pains||[]).slice(0,4);
        const ansCount = sess.answers ? Object.values(sess.answers).filter(x=>String(x||'').trim()).length : 0;
        sumEl.innerHTML = `<b>Что важно:</b> сила ${Math.round(sess.strength)} · ответов: ${ansCount}`
          + (sess.is_main?` · <span class="star">★ основная</span>`:'')
          + (topCauses.length?`<br><b>Причины:</b> ${topCauses.map(esc).join(' · ')}`:'')
          + (topPains.length?`<br><b>Боли:</b> ${topPains.map(esc).join(' · ')}`:'')
          + (bn.result?`<br><b>Ожидаемый результат:</b> ${esc(bn.result)}`:'');
      }
    }catch(e){ console.error(e); }

    renderSummary();
  });

})();
/* bn_engine_v2.js (BN page engine)
   - company search (action=search)
   - load latest row for selected company (action=get)
   - compute priorities (themes + needs) from interview payload
   - selectable causes/pains (multi)
   - free-text answers for questions
   - save to BN_Log (action=bn_log_append)
*/
(function(){
  const $ = (id)=>document.getElementById(id);

  const els = {
    dockCompany: $('dockCompany'),
    dockLoadBtn: $('dockLoadBtn'),
    dockSuggest: $('dockSuggest'),
    dockToggle: $('dockToggle'),
    bnCompanyLabel: $('bnCompanyLabel'),
    bnStatus: $('bnStatus'),
    bnSaveBtn: $('bnSaveBtn'),
    bnCompanyInput: $('bnCompanyInput'),
    bnCompanyBtn: $('bnCompanyBtn'),
    bnCompanySuggest: $('bnCompanySuggest'),
    themeList: $('themeList'),
    needsList: $('needsList'),
    needPanel: $('needPanel'),
    bnSummary: $('bnSummary'),
    fltTriggers: $('bnFltTriggers'),
    fltCritical: $('bnFltCritical'),
    fltMain: $('bnFltMain')
  };

  // ===== Utilities =====
  function escapeHtml(s){
    return String(s)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
  }

  // Normalize strings for matching (questions/indices coming from Excel vs payload).
  function normText(s){
    return String(s||'')
      .toLowerCase()
      .replace(/\u00a0/g,' ')
      .replace(/[“”\"'`]/g,'')
      .replace(/[()\[\]{}]/g,'')
      .replace(/[?!,:;•]/g,'')
      .replace(/\s+/g,' ')
      .trim();
  }

  function extractCode(label){
    // Supports: T1., P10., R3., etc. Returns 't1','p10', ...
    const m = String(label||'').trim().match(/^\s*([TPR])\s*(\d{1,2})\s*\./i);
    if(!m) return '';
    return (m[1] + String(Number(m[2]))).toLowerCase();
  }

  function normalizeTriggerName(trig){
    const s = String(trig||'').trim();
    if(!s) return '';
    // Common index trigger aliases from sheets
    if(/^COI\b/i.test(s) || /индекс\s+консистентности\s+данных/i.test(s)) return 'COI';
    if(/^PSI\b/i.test(s) || /проектн(ая|ой)\s+готовност/i.test(s)) return 'PSI';
    if(/техническ(ой|ая)\s+зрелост/i.test(s)) return 'Индекс технической зрелости';
    if(/процессн(ой|ая)\s+зрелост/i.test(s)) return 'Индекс процессной зрелости';
    if(/серые\s+зоны/i.test(s)) return 'Серые зоны инфраструктуры';
    if(/лицензионн/i.test(s) && /риск/i.test(s)) return 'Лицензионный риск';
    if(/операционн/i.test(s) && /(неэффектив|ручн)/i.test(s)) return 'Операционная неэффективность / ручной труд';
    if(/управляемост/i.test(s) || /отсутствие\s+истории/i.test(s)) return 'Управляемость / отсутствие истории';
    if(/потенциал\s+возврата\s+бюджета/i.test(s)) return 'Потенциал возврата бюджета';
    if(/экономическ(ое|ий)\s+давлен/i.test(s)) return 'Индекс экономического давления';
    // Normalize small wording differences for inputs
    if(/^Bus\-factor/i.test(s)) return 'Bus-factor ≤2 (есть?)';
    return s;
  }

  function toNum(v){
    if(v === null || v === undefined) return NaN;
    if(typeof v === 'number') return v;
    const s = String(v).replace(',', '.').replace(/[^0-9.\-]/g,'').trim();
    if(!s) return NaN;
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }

  function clamp(n, a, b){
    if(!Number.isFinite(n)) return a;
    return Math.max(a, Math.min(b, n));
  }

  function debounce(fn, ms){
    let t=null;
    return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
  }

  function setStatus(msg, type){
    if(!els.bnStatus) return;
    els.bnStatus.textContent = msg || '';
    els.bnStatus.className = 'bnStatus' + (type ? (' '+type) : '');
  }


  // ===== Loader overlay (for long operations) =====
  function ensureLoader(){
    if(document.getElementById('bnLoader')) return;
    const d = document.createElement('div');
    d.id = 'bnLoader';
    d.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(255,255,255,.55);backdrop-filter:blur(2px);z-index:9999;';
    d.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;align-items:center;">
        <div style="width:34px;height:34px;border:4px solid #ddd;border-top-color:#ef4444;border-radius:50%;animation:bnspin 1s linear infinite;"></div>
        <div id="bnLoaderText" style="font:600 14px Inter,system-ui;color:#111827">Загрузка…</div>
      </div>
    `;
    const st = document.createElement('style');
    st.textContent = '@keyframes bnspin{to{transform:rotate(360deg)}}';
    document.head.appendChild(st);
    document.body.appendChild(d);
  }

  function showLoader(text){
    ensureLoader();
    const d = document.getElementById('bnLoader');
    const t = document.getElementById('bnLoaderText');
    if(t) t.textContent = text || 'Загрузка…';
    if(d) d.style.display = 'flex';
  }

  function hideLoader(){
    const d = document.getElementById('bnLoader');
    if(d) d.style.display = 'none';
  }

  // ===== Config / HTTP =====
  function webappUrl(){
    return window.GS_WEBAPP_URL || window.GOOGLE_SHEETS_WEBAPP_URL || window.WEBAPP_URL || '';
  }

  async function gsGet(params){
    const base = webappUrl();
    if(!base) throw new Error('GS_WEBAPP_URL is not set (config.js)');
    const url = new URL(base);
    Object.entries(params||{}).forEach(([k,v])=> url.searchParams.set(k, String(v)));
    const res = await fetch(url.toString(), { method:'GET', credentials:'omit' });
    const txt = await res.text();
    try{ return JSON.parse(txt); }
    catch(e){ throw new Error('Bad JSON from Apps Script: ' + txt.slice(0,180)); }
  }

  async function gsPost(action, obj){
    const base = webappUrl();
    if(!base) throw new Error('GS_WEBAPP_URL is not set (config.js)');
    const body = new URLSearchParams();
    body.set('action', action);
    body.set('data', JSON.stringify(obj||{}));
    const res = await fetch(base, {
      method:'POST',
      headers: {'Content-Type':'application/x-www-form-urlencoded;charset=UTF-8'},
      body: body.toString(),
      credentials:'omit'
    });
    const txt = await res.text();
    try{ return JSON.parse(txt); }
    catch(e){ throw new Error('Bad JSON from Apps Script: ' + txt.slice(0,180)); }
  }

  // ===== State =====
  let CATALOG = null;
  let RULES = null;
  let SELECTED_THEME = '';
  let SELECTED_NEED_ID = '';
  const BN_STATE = {
    // needId -> {causes:Set, pains:Set, answers:Array<string>}
    picks: {}
  };

  function ensurePick(needId){
    if(!BN_STATE.picks[needId]){
      BN_STATE.picks[needId] = { causes:new Set(), pains:new Set(), answers:[] };
    }
    return BN_STATE.picks[needId];
  }

  // ===== Catalog loading =====
  async function loadCatalog(){
    if(CATALOG) return CATALOG;
    const res = await fetch('bn_catalog.json', {cache:'no-store'});
    CATALOG = await res.json();
    return CATALOG;
  }

  async function loadRules(){
    if(RULES) return RULES;
    try{
      const res = await fetch('bn_rules.json', {cache:'no-store'});
      RULES = await res.json();
      return RULES;
    }catch(e){
      console.warn('bn_rules.json not found or invalid. Falling back to heuristic priorities.', e);
      RULES = null;
      return null;
    }
  }

  // ===== Priority model =====
  // Primary model is rule-driven (bn_rules.json).
  // If rules are missing, we fallback to a lightweight heuristic.

  function getInterview(){
    return window.__BN_DATA || null;
  }

  function signalPct(data, key){
    if(!data) return NaN;
    const v = data[key] ?? data[String(key).toLowerCase()];
    const n = toNum(v);
    if(!Number.isFinite(n)) return NaN;
    // allow 0..1 or 0..100
    return n <= 1 ? n*100 : n;
  }

  function normalizeThemeName(s){
    const t = String(s||'').trim();
    if(!t) return '';
    if(t === 'Управление жизненным циклом ИТ-активов') return 'Управление жизненным циклом ИТ-активов и их ответственностью';
    if(t === 'Финансы и бюджет (SAM + ITAM + FinOps)') return 'Финансы и бюджет (пересечение SAM + ITAM + FinOps)';
    return t;
  }

  function computeBudgetAnnual(data){
    const w = clamp(toNum(data?.workplaces), 0, 1e9);
    const s = clamp(toNum(data?.servers), 0, 1e9);
    if(!Number.isFinite(w) && !Number.isFinite(s)) return NaN;
    const costPerWorkplace = 12000; // ₽/мес
    const costPerServer    = 45000; // ₽/мес
    const monthly = (Number.isFinite(w)? w*costPerWorkplace : 0) + (Number.isFinite(s)? s*costPerServer : 0);
    return monthly * 12;
  }

  function getIndexValueByName(indexName, data){
    const n = String(indexName||'').trim();
    if(!data) return NaN;
    const pick = (k)=>{
      const v = (data?.[k] ?? data?.[String(k).toLowerCase()]);
      const num = toNum(v);
      return Number.isFinite(num) ? num : NaN;
    };

    if(n === 'PSI') return clamp(signalPct(data, 'psi2Score') ?? signalPct(data,'psi'), 0, 100);
    if(n === 'Индекс технической зрелости') return clamp(signalPct(data,'techIndex') ?? signalPct(data,'tech'), 0, 100);
    if(n === 'Индекс процессной зрелости') return clamp(signalPct(data,'procIndex') ?? signalPct(data,'proc'), 0, 100);
    if(n === 'Потенциал возврата бюджета') return clamp(signalPct(data,'recoverIndex') ?? signalPct(data,'recover'), 0, 100);
    if(n === 'Индекс экономического давления') return clamp(signalPct(data,'painIndex') ?? signalPct(data,'pain') ?? signalPct(data,'aiIndex') ?? signalPct(data,'ai'), 0, 100);

    if(n === 'Серые зоны инфраструктуры') return clamp(signalPct(data,'risk_grey_pct') ?? signalPct(data,'riskGreyPct'), 0, 100);
    if(n === 'Лицензионный риск') return clamp(signalPct(data,'risk_lic_pct') ?? signalPct(data,'riskLicPct'), 0, 100);
    if(n === 'Операционная неэффективность / ручной труд') return clamp(signalPct(data,'risk_ops_pct') ?? signalPct(data,'riskOpsPct'), 0, 100);
    if(n === 'Управляемость / отсутствие истории') return clamp(signalPct(data,'risk_gov_pct') ?? signalPct(data,'riskGovPct'), 0, 100);

    if(n === 'COI'){
      const loss = pick('coiTotal') ?? pick('coi_total_loss');
      const budget = computeBudgetAnnual(data);
      if(!Number.isFinite(loss) || !Number.isFinite(budget) || budget<=0) return NaN;
      const share = loss / budget;
      const score = 100 * (1 - clamp(share/0.04, 0, 1));
      return Math.round(clamp(score, 0, 100));
    }
    return NaN;
  }

  function findMaturityAnswer(prefix, questionLabel, data){
    if(!data) return '';
    const wantCode = extractCode(questionLabel);
    const wantNorm = normText(questionLabel);
    const max = (prefix==='risk') ? 8 : 10;
    for(let i=1;i<=max;i++){
      const n = String(i).padStart(2,'0');
      const keyL = `${prefix}_${n}_label`;
      const keyV = prefix==='risk' ? `${prefix}_${n}_val` : `${prefix}_${n}_score`;
      const lbl = String(data?.[keyL] ?? '').trim();
      if(!lbl) continue;
      const gotCode = extractCode(lbl);
      const ok = (wantCode && gotCode && wantCode===gotCode) || (!wantCode && normText(lbl)===wantNorm);
      if(ok){
        const v = String(data?.[keyV] ?? '').trim();
        if(prefix==='risk') return v==='1' ? 'Да' : (v==='0' ? 'Нет' : '');
        if(v==='2') return 'Да';
        if(v==='1') return 'Частично';
        if(v==='0') return 'Нет';
        return '';
      }
    }
    return '';
  }

  function getQuestionValue(questionLabel, data){
    const q = String(questionLabel||'').trim();
    if(!q || !data) return { kind:'none', value:null };

    if(/^T\d+\./.test(q)) return { kind:'choice', value: findMaturityAnswer('tech', q, data) };
    if(/^P\d+\./.test(q)) return { kind:'choice', value: findMaturityAnswer('proc', q, data) };
    {
      const a = findMaturityAnswer('risk', q, data);
      if(a) return { kind:'choice', value:a };
    }

    const MAP = {
      'Кол-во рабочих мест':'workplaces',
      'Кол-во серверов':'servers',
      'Кол-во филиалов':'branches',
      'VDI':'vdi',
      'Закрытый контур':'closed',
      'Модель размещения':'hostingModel',
      'Домены AD / каталогов (кол-во)':'adDomains',
      'Сегментация сети':'netSeg',
      'Терминальные фермы / RDS / VDI farms':'terminalFarms',
      'Возраст основного железа':'hwAge',
      'Учет железа (как сейчас)':'hwAccounting',
      'Резервирование критичных серверов':'redundancy',
      'Средняя зарплата IT (₽/мес) GROSS':'salary',
      'Кол-во IT сотрудников':'itCount',
      '% ручных операций':'manualPct',
      'Бюджет на лицензии (₽/год)':'licBudget',
      '% неиспользуемого ПО':'unusedPct',
      '% неиспользуемых VM':'vmUnusedPct',
      'Бюджет на железо (₽/год)':'hwBudget',
      'План обновления железа':'hwPlan',
      'Часов простоя в год':'downtimeHours',
      'Стоимость часа простоя (₽/час)':'downtimeCost',
      'Инцидентов в месяц':'incidentsPerMonth',
      'Сервис-деск':'serviceDesk',
      'Bus-factor ≤2 (есть?)':'keyPeopleRisk',
      'Документированность (0–2)':'docScore',
      '% устаревших ОС/ПО':'obsoletePct'
    };
    const qNorm = normText(q);
    // direct match
    let key = MAP[q];
    // fallback: normalized match (helps with small wording variations like missing "(есть?)")
    if(!key){
      for(const [k,v] of Object.entries(MAP)){
        if(normText(k)===qNorm){ key=v; break; }
      }
    }
    if(key){
      const raw = (data?.[key] ?? data?.[String(key).toLowerCase()]);
      if(key==='keyPeopleRisk' || key==='docScore'){
        const num = toNum(raw);
        return { kind:'number', value: Number.isFinite(num) ? num : null };
      }
      if(key==='serviceDesk' || key==='hwPlan'){
        const s = String(raw ?? '').trim();
        return { kind:'choice', value: s ? 'Да' : '' };
      }
      if(['vdi','closed','netSeg','terminalFarms','hwAccounting','redundancy','hostingModel'].includes(key)){
        const s = String(raw ?? '').trim();
        if(!s) return {kind:'choice', value:''};
        const low = s.toLowerCase();
        if(low==='нет' || low==='no' || low==='0') return {kind:'choice', value:'Нет'};
        return {kind:'choice', value:'Да'};
      }
      const num = toNum(raw);
      if(Number.isFinite(num)) return { kind:'number', value:num };
      const s = String(raw ?? '').trim();
      return s ? {kind:'text', value:s} : {kind:'none', value:null};
    }

    if(q in data) return {kind:'text', value:data[q]};
    return { kind:'none', value:null };
  }

  function parseCond(cond){
    const s = String(cond||'').trim();
    if(!s) return {type:'any'};
    const ss = s.replace(/–/g,'-').replace(/−/g,'-');
    if(/^(да|нет|частично)$/i.test(ss)) return {type:'choice', v:ss.toLowerCase()};
    let m = ss.match(/^([<>]=?)\s*(-?\d+(?:[\.,]\d+)?)$/);
    if(m) return {type:'cmp', op:m[1], num:Number(m[2].replace(',','.'))};
    m = ss.match(/^(-?\d+(?:[\.,]\d+)?)\s*-\s*(-?\d+(?:[\.,]\d+)?)$/);
    if(m) return {type:'range', a:Number(m[1].replace(',','.')), b:Number(m[2].replace(',','.'))};
    m = ss.match(/^(-?\d+(?:[\.,]\d+)?)$/);
    if(m) return {type:'eq', num:Number(m[1].replace(',','.'))};
    return {type:'text', v:ss.toLowerCase()};
  }

  function matchCond(valueObj, condStr){
    const c = parseCond(condStr);
    if(c.type==='any') return true;
    if(c.type==='choice'){
      const v = String(valueObj?.value ?? '').trim().toLowerCase();
      return v === c.v;
    }
    const vNum = toNum(valueObj?.value);
    if(c.type==='cmp'){
      if(!Number.isFinite(vNum)) return false;
      if(c.op==='<' ) return vNum <  c.num;
      if(c.op==='<=') return vNum <= c.num;
      if(c.op==='>' ) return vNum >  c.num;
      if(c.op==='>=') return vNum >= c.num;
      return false;
    }
    if(c.type==='range'){
      if(!Number.isFinite(vNum)) return false;
      const a = Math.min(c.a,c.b), b = Math.max(c.a,c.b);
      return vNum >= a && vNum <= b;
    }
    if(c.type==='eq'){
      if(!Number.isFinite(vNum)) return false;
      return vNum === c.num;
    }
    if(c.type==='text'){
      const v = String(valueObj?.value ?? '').trim().toLowerCase();
      return v === c.v;
    }
    return false;
  }

  function computeThemeScores(data){
    const out = {};
    const themes = (CATALOG?.themes||[]).map(t => {
      if(typeof t === 'string') return t;
      if(t && typeof t === 'object') return t.name || t.id || '';
      return String(t||'');
    }).map(normalizeThemeName).filter(Boolean);
    themes.forEach(t=> out[t]=0);
    if(!data) return out;

    if(RULES && RULES.theme_index && RULES.theme_questions){
      const idxRules = RULES.theme_index || [];
      const qRules = (RULES.theme_questions || []).filter(r=> String(r.theme||'') !== '—');

      for(const theme0 of themes){
        const theme = normalizeThemeName(theme0);
        let indexPts = 0;
        let qPts = 0;

        const idxRows = idxRules.filter(r=> normalizeThemeName(r.theme) === theme);
        const byIdx = {};
        idxRows.forEach(r=>{ const k=String(r.index||'').trim(); (byIdx[k] ||= []).push(r); });
        Object.entries(byIdx).forEach(([idxName, rows])=>{
          const v = getIndexValueByName(idxName, data);
          if(!Number.isFinite(v)) return;
          for(const r of rows){
            if(matchCond({kind:'number', value:v}, r.cond)) { indexPts += toNum(r.points)||0; break; }
          }
        });

        const qRows = qRules.filter(r=> normalizeThemeName(r.theme) === theme);
        const byQ = {};
        qRows.forEach(r=>{ const k=String(r.question||'').trim(); (byQ[k] ||= []).push(r); });
        Object.entries(byQ).forEach(([qLabel, rows])=>{
          const v = getQuestionValue(qLabel, data);
          if(!v || v.kind==='none') return;
          for(const r of rows){
            if(matchCond(v, r.cond)) { qPts += toNum(r.points)||0; break; }
          }
        });

        const blended = (indexPts*0.4 + qPts*0.6);
        out[theme] = Math.round(clamp(blended, 0, 100));
      }
      return out;
    }

    // Core indices (0..100)
    const pain  = clamp(signalPct(data,'painIndex'), 0, 100);
    const risk  = clamp(signalPct(data,'riskIndex'), 0, 100);
    const obso  = clamp(signalPct(data,'obsolIndex'), 0, 100);
    const tech  = clamp(signalPct(data,'techIndex'), 0, 100);
    const proc  = clamp(signalPct(data,'procIndex'), 0, 100);
    const bus   = clamp(signalPct(data,'busIndex'), 0, 100);
    const ready = clamp(signalPct(data,'readyIndex'),0, 100);
    const recov = clamp(signalPct(data,'recoverIndex'),0,100);
    const prob  = clamp(signalPct(data,'probIndex'),0,100);

    // Useful numeric signals from interview
    const manualPct   = clamp(signalPct(data,'manualPct'),0,100);
    const unusedPct   = clamp(signalPct(data,'unusedPct'),0,100);
    const vmUnusedPct = clamp(signalPct(data,'vmUnusedPct'),0,100);
    const obsoletePct = clamp(signalPct(data,'obsoletePct'),0,100);
    const docScore    = clamp(signalPct(data,'docScore'),0,100);

    const psiBad = (function(){
      try{
        const keys = Object.keys(data||{}).filter(k=>/^psi_\d{2}_ok$/i.test(k));
        if(!keys.length) return 0;
        let bad=0;
        keys.forEach(k=>{
          const v = data[k];
          const s = String(v===undefined?"":v).trim().toLowerCase();
          if(v===0 || v===false || s==='нет' || s==='no' || s==='false') bad++;
        });
        return (bad/keys.length)*100;
      }catch(e){ return 0; }
    })();

    // Gaps (the worse, the higher priority)
    const gapTech  = 100 - (Number.isFinite(tech)?tech:50);
    const gapProc  = 100 - (Number.isFinite(proc)?proc:50);
    const gapBus   = 100 - (Number.isFinite(bus)?bus:50);
    const gapReady = 100 - (Number.isFinite(ready)?ready:50);

    // Helper: average with NaN-safe
    const avg = (...xs)=>{
      const a = xs.filter(v=>Number.isFinite(v));
      if(!a.length) return 0;
      return a.reduce((s,v)=>s+v,0)/a.length;
    };

    // Map to your 8 new thematics
    out['Видимость и единый источник данных'] =
      clamp(avg(gapTech, gapProc, pain, prob) * 0.85 + manualPct*0.15, 0, 100);

    out['Сбор, агрегация и управление качеством данных'] =
      clamp(avg(pain, gapProc, manualPct, (100-docScore), psiBad) , 0, 100);

    out['Контроль изменений и конфигурации (Change / Drift)'] =
      clamp(avg(risk, gapProc, gapTech, prob, psiBad*0.6) , 0, 100);

    out['Контроль технических и киберрисков инфраструктуры'] =
      clamp(avg(risk, recov, obso, prob) , 0, 100);

    out['Управление жизненным циклом ИТ-активов и их ответственностью'] =
      clamp(avg(obso, obsoletePct, gapProc, gapTech) , 0, 100);

    out['Управление программным обеспечением, лицензиями и рисками (SAM + Security + импортозамещение)'] =
      clamp(avg(risk, unusedPct, obso, prob) , 0, 100);

    out['Финансы и бюджет (пересечение SAM + ITAM + FinOps)'] =
      clamp(avg(gapBus, unusedPct, vmUnusedPct, gapReady) , 0, 100);

    out['Отчетность и стратегическое управление'] =
      clamp(avg(gapBus, gapProc, (100-docScore), bus, psiBad) * 0.9 , 0, 100);

    themes.forEach(k=>{
      if(!Number.isFinite(out[k])) out[k]=0;
      out[k]=Math.round(clamp(out[k],0,100));
    });
    return out;
  }

  function needStrength(item, themeScores){
    const w = clamp(toNum(item.weight), 1, 3);
    const data = getInterview();
    let pts = 0;

    if(RULES && RULES.need_triggers && data){
      const rows = (RULES.need_triggers||[]).filter(r=> String(r.need||'').trim() === String(item.name||'').trim());
      const byTrig = {};
      rows.forEach(r=>{ const k=normalizeTriggerName(r.trigger); (byTrig[k] ||= []).push(r); });
      Object.entries(byTrig).forEach(([trig, trs])=>{
        const trigName = normalizeTriggerName(trig);
        const idxVal = getIndexValueByName(trigName, data);
        const vObj = Number.isFinite(idxVal) ? {kind:'number', value:idxVal} : getQuestionValue(trigName, data);
        if(!vObj || vObj.kind==='none') return;
        for(const r of trs){
          if(matchCond(vObj, r.cond)) { pts += toNum(r.points)||0; break; }
        }
      });
    }else{
      const tScore = clamp(toNum(themeScores[item.theme] ?? 40), 0, 100);
      pts = tScore;
    }

    const mult = clamp(0.85 + (w-1)*0.075, 0.85, 1.00);
    return Math.round(clamp(pts * mult, 0, 100));
  }

  // ===== Rendering: Themes =====
  function renderThemes(themeScores){
    if(!els.themeList || !CATALOG) return;

    // Support both formats: ['name', ...] or [{id,name}, ...]
    const themes = (CATALOG.themes||[]).map(t => {
      if(typeof t === 'string') return {id:t, name:t};
      if(t && typeof t === 'object') return {id: t.id || t.name, name: t.name || t.id};
      return {id:String(t), name:String(t)};
    }).filter(t=>t.name);

    // Sort by score desc if company loaded.
    if(getInterview()){
      themes.sort((a,b)=> (themeScores[b.name]||0) - (themeScores[a.name]||0));
    }

    els.themeList.innerHTML='';
    themes.forEach((t)=>{
      const score = clamp(toNum(themeScores[t.name]), 0, 100);
      const btn = document.createElement('button');
      btn.type='button';
      btn.className = 'tabBtn' + (t.name===SELECTED_THEME ? ' active' : '');
      btn.innerHTML = `
        <div class="tabTitle">${escapeHtml(t.name)} <span class="badge" style="margin-left:8px">Приоритет: ${score}</span></div>
        <div class="tabMeta">Основано на интервью (индексы/риски). Выше — важнее.</div>
        <div class="miniBar"><i style="width:${score}%"></i></div>
      `;
      btn.onclick = ()=>{
        SELECTED_THEME = t.name;
        renderAll();
      };
      els.themeList.appendChild(btn);
    });
  }

  // ===== Filters =====
  function passesFilters(item){
    const trig = !!(els.fltTriggers && els.fltTriggers.checked);
    const crit = !!(els.fltCritical && els.fltCritical.checked);
    const main = !!(els.fltMain && els.fltMain.checked);
    if(trig){
      if(item.trigger !== true) return false;
    }
    if(crit){
      if(Number(item.weight||0) < 3) return false;
    }
    if(main){
      if(Number(item.weight||0) < 2) return false;
    }
    return true;
  }

  // ===== Rendering: Needs =====
  function renderNeeds(themeScores){
    if(!els.needsList || !CATALOG) return;

    const items = (CATALOG.items||[])
      .filter(it => !SELECTED_THEME || String(it.theme||'') === SELECTED_THEME)
      .filter(passesFilters)
      .map(it => ({...it, __strength: needStrength(it, themeScores)}))
      .sort((a,b)=> (b.__strength - a.__strength) || (Number(b.weight||0)-Number(a.weight||0)));

    els.needsList.innerHTML='';

    items.forEach((it)=>{
      const row = document.createElement('div');
      row.className = 'needCard' + (it.id===SELECTED_NEED_ID ? ' active' : '');
      const strength = clamp(toNum(it.__strength), 0, 100);
      const company = (window.__BN_COMPANY || '');
      const keyTitle = (it.name||it.id||'');
      const primaryOn = isPrimaryNeed(company, keyTitle);

      row.innerHTML = `
        <div class="needHeader">
          <div>
            <div class="needTitle">${escapeHtml(keyTitle)}</div>
            <div class="needMeta">${escapeHtml((it.zone?it.zone+' · ':'') + (it.theme?it.theme:'') + (it.subtheme?(' · '+it.subtheme):''))}</div>
          </div>

          <div class="needPriorityWrap">
            <button class="bnStarBtn" data-on="${primaryOn?1:0}" title="Отметить как основную">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M12 17.3l-6.18 3.25 1.18-6.9L1.99 8.9l6.91-1L12 1.6l3.1 6.3 6.91 1-5 4.75 1.18 6.9z"/>
              </svg>
            </button>

            <div class="needPriorityBadge">Приоритет: ${Math.round(strength)}</div>
            <div class="needPriorityBar"><i style="width:${Math.round(strength)}%"></i></div>
            <div class="pill">Вес: ${escapeHtml(String(it.weight||1))}</div>
          </div>
        </div>
      `;

      const starBtn = row.querySelector('.bnStarBtn');
      if(starBtn){
        starBtn.onclick = (ev) => {
          ev.stopPropagation();
          const arr = togglePrimaryNeed(company, keyTitle);
          starBtn.setAttribute('data-on', arr.includes(keyTitle) ? '1' : '0');
          // если включен фильтр "только основные" — перерисуем список
          const flt = document.getElementById('bnFltMain');
          if(flt && flt.checked) renderNeeds();
        };
      }
      row.onclick = ()=>{
        SELECTED_NEED_ID = it.id;
        renderNeedPanel(it, themeScores);
        // highlight selection in grid
        renderNeeds(themeScores);
      };
      els.needsList.appendChild(row);
    });

    if(!items.length){
      els.needsList.innerHTML = '<div class="muted">Ничего не найдено по фильтрам.</div>';
    }
  }

  function renderChecklist(title, items, set, onChange){
    const safeItems = Array.isArray(items) ? items : [];
    const html = safeItems.length ? safeItems.map((txt, idx)=>{
      const checked = set.has(String(txt)) ? 'checked' : '';
      const id = `${title}_${idx}_${Math.random().toString(16).slice(2)}`;
      return `
        <label class="checkItem" for="${id}">
          <input id="${id}" type="checkbox" data-value="${escapeHtml(String(txt))}" ${checked}/>
          <span>${escapeHtml(String(txt))}</span>
        </label>
      `;
    }).join('') : '<div class="muted">—</div>';

    const wrap = document.createElement('div');
    wrap.className = 'block';
    wrap.innerHTML = `
      <div class="blockTitle">${escapeHtml(title)}</div>
      <div class="checkGrid">${html}</div>
    `;
    // bind events
    wrap.querySelectorAll('input[type="checkbox"]').forEach((inp)=>{
      inp.addEventListener('change', ()=>{
        const v = inp.getAttribute('data-value') || '';
        if(inp.checked) set.add(v); else set.delete(v);
        onChange && onChange();
      });
    });
    return wrap;
  }

  function renderQuestions(questions, answers, onChange){
    const safeQ = Array.isArray(questions) ? questions : [];
    const box = document.createElement('div');
    box.className = 'block';
    box.innerHTML = `<div class="blockTitle">Вопросы (ответы — свободный ввод)</div>`;

    const list = document.createElement('div');
    list.className = 'qList';

    if(!safeQ.length){
      list.innerHTML = '<div class="muted">—</div>';
    }else{
      safeQ.forEach((q, idx)=>{
        const val = answers[idx] || '';
        const row = document.createElement('div');
        row.className = 'qRow';
        row.innerHTML = `
          <div class="qText">${escapeHtml(String(q))}</div>
          <textarea class="qAnswer" data-idx="${idx}" placeholder="Ответ…">${escapeHtml(String(val))}</textarea>
        `;
        row.querySelector('textarea').addEventListener('input', (e)=>{
          const i = Number(e.target.getAttribute('data-idx'));
          answers[i] = e.target.value;
          onChange && onChange();
        });
        list.appendChild(row);
      });
    }
    box.appendChild(list);
    return box;
  }

  function renderNeedPanel(it, themeScores){
    if(!els.needPanel) return;
    const strength = needStrength(it, themeScores);
    const pick = ensurePick(it.id);

    // Ensure answers length
    const qCount = Array.isArray(it.questions) ? it.questions.length : 0;
    if(pick.answers.length < qCount){
      pick.answers = pick.answers.concat(new Array(qCount - pick.answers.length).fill(''));
    }

    els.needPanel.innerHTML = '';

    const head = document.createElement('div');
    head.className = 'needHead';
    head.innerHTML = `
      <div>
        <div class="needTitle">${escapeHtml(it.name||it.id||'')}</div>
        <div class="small">${escapeHtml(it.theme||'')} · ${escapeHtml(it.zone||'')} · Вес ${Number(it.weight||0)} · <b>Приоритет ${strength}</b></div>
      </div>
      <div class="needHeadRight">
        <span class="pill"><span class="star">★</span> Выбери причины/боли и заполни ответы — это сохранится в BN_Log</span>
      </div>
    `;
    els.needPanel.appendChild(head);

    const desc = document.createElement('div');
    desc.className = 'block';
    desc.innerHTML = `
      <div class="blockTitle">Описание / бизнес‑задача</div>
      <div class="blockText">${escapeHtml(it.task||'')}</div>
    `;
    els.needPanel.appendChild(desc);

    // Questions with free input (должны идти сразу после описания)
    els.needPanel.appendChild(renderQuestions(it.questions, pick.answers, ()=>{}));

    // Causes & Pains with checkboxes
    const two = document.createElement('div');
    two.className = 'twoCols';
    const onPickChange = ()=>{ /* no-op for now */ };
    two.appendChild(renderChecklist('Причины (мультивыбор)', it.causes, pick.causes, onPickChange));
    two.appendChild(renderChecklist('Боли (мультивыбор)', it.pains, pick.pains, onPickChange));
    els.needPanel.appendChild(two);

    // Details blocks
    const mkDetails = (title, text)=>{
      const d = document.createElement('details');
      d.className='details';
      d.innerHTML = `<summary>${escapeHtml(title)}</summary><pre class="pre">${escapeHtml(text||'')}</pre>`;
      return d;
    };
    els.needPanel.appendChild(mkDetails('ITIL', it.itil||''));
    els.needPanel.appendChild(mkDetails('Процессы / интеграции', it.process||''));
    els.needPanel.appendChild(mkDetails('KPI', it.kpi||''));
    els.needPanel.appendChild(mkDetails('Класс решений', it.solutions_class||''));
    els.needPanel.appendChild(mkDetails('Функционал ИТМен', it.functional||''));
    const res = document.createElement('div');
    res.className='block';
    res.innerHTML = `<div class="blockTitle">Ожидаемый результат</div><pre class="pre">${escapeHtml(it.result||'')}</pre>`;
    els.needPanel.appendChild(res);
  }

  // ===== Company search / load =====
  let lastSearchToken = 0;

  async function searchCompany(q, target){
    const token = ++lastSearchToken;
    q = String(q||'').trim();
    if(!q || q.length < 2){
      renderSuggest(target, []);
      return;
    }
        setStatus('Поиск компании…', 'warn');
    setSuggestLoading(target);

    try{
      const out = await gsGet({action:'search', q, limit:10});
      if(token !== lastSearchToken) return;
      if(!out || out.ok !== true) throw new Error(out && out.error ? out.error : 'search failed');
      renderSuggest(target, out.items||[]);
    }catch(err){
      if(token !== lastSearchToken) return;
      console.error('BN search error:', err);
      renderSuggest(target, []);
    }
  }

  function setSuggestLoading(target){
    const box = (target==='dock') ? els.dockSuggest : els.bnCompanySuggest;
    if(!box) return;
    box.innerHTML = '<div class="bnSuggestItem" style="opacity:.8;">Поиск…</div>';
    box.style.display = 'block';
  }



  function renderSuggest(target, items){
    const box = target === 'dock' ? els.dockSuggest : els.bnCompanySuggest;
    if(!box) return;
    if(!items || !items.length){
      box.style.display = 'none';
      box.innerHTML = '';
      return;
    }
    box.innerHTML = items.map(it => `
      <div class="dockItem" data-row="${it.row||''}" data-company="${escapeHtml(it.company||'')}">
        <b>${escapeHtml(it.company||'')}</b>
        <div class="small">${escapeHtml(String(it.timestamp||''))}</div>
      </div>
    `).join('');
    box.style.display = 'block';
    box.querySelectorAll('.dockItem').forEach((node)=>{
      node.onclick = ()=>{
        const company = node.getAttribute('data-company') || '';
        const row = Number(node.getAttribute('data-row')||0);
        if(target === 'dock'){
          if(els.dockCompany) els.dockCompany.value = company;
        }else{
          if(els.bnCompanyInput) els.bnCompanyInput.value = company;
        }
        box.style.display='none';
        loadCompany({company, row});
      };
    });
  }

  async function loadCompany({company, row}){
    company = String(company||'').trim();
    if(!company && !row) return;
    showLoader('Загрузка данных по компании…');
    setStatus('Загрузка данных по компании…', 'warn');
    try{
      const out = await gsGet(row ? {action:'get', row} : {action:'get', company});
      if(!out || out.ok !== true) throw new Error(out && out.error ? out.error : 'get failed');
      const payload = out.payload || out.item || {};

      const name = payload._company || payload.company || company || '';
      window.__BN_COMPANY = name;
      window.__BN_DATA = payload;

      if(els.bnCompanyLabel) els.bnCompanyLabel.textContent = name || '—';
      const ts = payload.timestamp || payload.Timestamp || payload._timestamp || '';
      const rowNum = payload._row || '';
      const v = payload.version || payload.Version || '';
      if(els.bnSummary){
        els.bnSummary.textContent = `Источник: PSI_Log${rowNum?(' · строка '+rowNum):''}${ts?(' · '+ts):''}${v?(' · '+v):''}`;
      }

      // Reset selections for new company (optional)
      BN_STATE.picks = {};
      SELECTED_THEME = '';
      SELECTED_NEED_ID = '';

      setStatus('Данные загружены: ' + (name||''), 'ok');
      hideLoader();
      renderAll();
    }catch(err){
      console.error('BN load error:', err);
      hideLoader();
      setStatus('Ошибка загрузки: ' + (err && err.message ? err.message : err), 'err');
    }
  }

  // ===== Save =====
  function buildSavePayload(themeScores){
    const company = (window.__BN_COMPANY || '').trim();
    if(!company) throw new Error('Компания не выбрана');
    const data = getInterview() || {};
    const thematics = (CATALOG.themes||[])
      .slice()
      .sort((a,b)=> (themeScores[b]||0) - (themeScores[a]||0))
      .slice(0,8);

    // top needs by strength
    const items = (CATALOG.items||[])
      .map(it=>({ ...it, __strength: needStrength(it, themeScores) }))
      .sort((a,b)=> b.__strength - a.__strength)
      .slice(0,20);

    const bns = items.map(it=>{
      const pick = ensurePick(it.id);
      return {
        bn_id: it.id,
        bn_name: it.name,
        strength: it.__strength,
        zone: it.zone,
        functional: it.functional,
        causes: Array.from(pick.causes),
        pains: Array.from(pick.pains),
        answers: (pick.answers||[]).slice(0,10)
      };
    });

    return {
      company_name: company,
      source_row: data._row || '',
      source_timestamp: data.timestamp || data.Timestamp || '',
      thematics,
      bns
    };
  }

  async function saveAll(themeScores){
    try{
      setStatus('Сохраняю выбор в BN_Log…', 'warn');
      const payload = buildSavePayload(themeScores);
      const out = await gsPost('bn_log_append', payload);
      if(!out || out.ok !== true) throw new Error(out && out.error ? out.error : 'save failed');
      setStatus(`Сохранено в BN_Log: строка ${out.row || ''} · ${out.timestamp || ''}`, 'ok');
    }catch(err){
      console.error('BN save error:', err);
      setStatus('Ошибка сохранения: ' + (err && err.message ? err.message : err), 'err');
    }
  }

  // ===== Render all =====
  function renderAll(){
    if(!CATALOG) return;
    const data = getInterview();
    const themeScores = computeThemeScores(data);
    renderThemes(themeScores);
    renderNeeds(themeScores);
    if(SELECTED_NEED_ID){
      const item = (CATALOG.items||[]).find(x=>x.id===SELECTED_NEED_ID);
      if(item) renderNeedPanel(item, themeScores);
    }
    // wire save
    if(els.bnSaveBtn){
      els.bnSaveBtn.onclick = ()=> saveAll(themeScores);
    }
    // wire filters
    ['fltTriggers','fltCritical','fltMain'].forEach(k=>{
      const el = els[k];
      if(el && !el.__bn_bound){
        el.__bn_bound = true;
        el.addEventListener('change', ()=> renderNeeds(themeScores));
      }
    });
  }

  // ===== Init =====
  function initDockCollapse(){
    if(!els.dockToggle) return;
    const KEY='itmen_dock_collapsed';
    const isCollapsed = localStorage.getItem(KEY)==='1';
    if(isCollapsed) document.body.classList.add('dockCollapsed');
    els.dockToggle.textContent = document.body.classList.contains('dockCollapsed') ? '▶' : '◀';
    els.dockToggle.onclick = ()=>{
      document.body.classList.toggle('dockCollapsed');
      localStorage.setItem(KEY, document.body.classList.contains('dockCollapsed') ? '1' : '0');
      els.dockToggle.textContent = document.body.classList.contains('dockCollapsed') ? '▶' : '◀';
    };
  }

  async function boot(){
    initDockCollapse();
    await loadCatalog();
    await loadRules();

    // initial render without company (neutral)
    renderAll();

    // Company search: dock + inline
    const doSearchDock = debounce((v)=> searchCompany(v, 'dock'), 250);
    const doSearchInline = debounce((v)=> searchCompany(v, 'inline'), 250);

    if(els.dockCompany){
      els.dockCompany.addEventListener('input', ()=> doSearchDock(els.dockCompany.value));
    }
    if(els.bnCompanyInput){
      els.bnCompanyInput.addEventListener('input', ()=> doSearchInline(els.bnCompanyInput.value));
    }
    if(els.dockLoadBtn){
      els.dockLoadBtn.onclick = ()=> loadCompany({company: els.dockCompany ? els.dockCompany.value : ''});
    }
    if(els.bnCompanyBtn){
      els.bnCompanyBtn.onclick = ()=> loadCompany({company: els.bnCompanyInput ? els.bnCompanyInput.value : ''});
    }
  }

  // ===== Debug helpers (optional) =====
  // window.bnDebug() -> prints theme + needs priorities.
  // window.bnDebugBreakdown() -> prints matched triggers & points per need.
  window.bnDebug = function(){
    const data = getInterview();
    const themeScores = computeThemeScores(data);
    console.table(Object.entries(themeScores).sort((a,b)=>b[1]-a[1]).map(([k,v])=>({theme:k, priority:v})));
    const needs = (CATALOG?.needs||[]).map(n=>({
      name: n.name || n.id || n,
      theme: n.theme || '',
      weight: n.weight || ''
    }));
    const rows = needs.map(n=>({
      need:n.name,
      theme:n.theme,
      weight:n.weight,
      priority: needStrength(n, themeScores)
    })).sort((a,b)=>b.priority-a.priority);
    console.table(rows);
    return {themeScores, rows};
  };

  window.bnDebugBreakdown = function(){
    const data = getInterview();
    if(!data || !RULES) return {error:'no data or rules'};
    const out = [];
    for(const r of (RULES.need_triggers||[])){
      const trig = normalizeTriggerName(r.trigger);
      const idxVal = getIndexValueByName(trig, data);
      const vObj = Number.isFinite(idxVal) ? {kind:'number', value:idxVal} : getQuestionValue(trig, data);
      const ok = vObj && vObj.kind!=='none' && matchCond(vObj, r.cond);
      out.push({need:r.need, trigger:trig, cond:r.cond, points:r.points, value:vObj?.value, matched: ok});
    }
    console.table(out.filter(x=>x.matched));
    const byNeed = {};
    out.filter(x=>x.matched).forEach(x=>{ byNeed[x.need] = (byNeed[x.need]||0) + (toNum(x.points)||0); });
    console.table(Object.entries(byNeed).sort((a,b)=>b[1]-a[1]).map(([need,sum])=>({need, points:sum})));
    return {matched: out.filter(x=>x.matched), sums: byNeed};
  };

  boot().catch(err=>{
    console.error('BN boot failed:', err);
    setStatus('Ошибка инициализации BN: ' + (err && err.message ? err.message : err), 'err');
  });
})();

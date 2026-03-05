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

  // ===== Priority model (heuristics) =====
  const THEME_KEYS = [
    'Видимость и охват',
    'CMDB и классификация',
    'Сетевое окружение и топология',
    'Эксплуатация и стабильность',
    'Изменения и DevOps',
    'SAM и оптимизация ПО',
    'Комплаенс, аудит и импортозамещение',
    'Стратегия, финансы и управляемость'
  ];

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

  function computeThemeScores(data){
    const out = {};
    THEME_KEYS.forEach(t=> out[t]=40); // default
    if(!data) return out;

    const grey = signalPct(data,'risk_grey_pct');
    const lic  = signalPct(data,'risk_lic_pct');
    const ops  = signalPct(data,'risk_ops_pct');
    const gov  = signalPct(data,'risk_gov_pct');
    const pilot= signalPct(data,'pilot_readiness_pct');

    const pain = clamp(signalPct(data,'painIndex'), 0, 100);
    const risk = clamp(signalPct(data,'riskIndex'), 0, 100);
    const obso = clamp(signalPct(data,'obsolIndex'), 0, 100);
    const tech = clamp(signalPct(data,'techIndex'), 0, 100);
    const proc = clamp(signalPct(data,'procIndex'), 0, 100);
    const bus  = clamp(signalPct(data,'busIndex'), 0, 100);
    const ready= clamp(signalPct(data,'readyIndex'), 0, 100);

    const overall = clamp((Number.isFinite(risk)?risk:0)*0.5 + (Number.isFinite(pain)?pain:0)*0.5, 0, 100) || 40;

    const invTechGap = 100 - (Number.isFinite(tech)?tech:50);
    const invProcGap = 100 - (Number.isFinite(proc)?proc:50);
    const invBusGap  = 100 - (Number.isFinite(bus)?bus:50);
    const invReadyGap= 100 - (Number.isFinite(ready)?ready:50);
    const invPilotGap= 100 - (Number.isFinite(pilot)?pilot:50);

    // Map known explicit risk buckets first; fallback to index gaps.
    out['Видимость и охват'] = clamp(
      (Number.isFinite(grey)?grey:NaN), 0, 100
    );
    if(!Number.isFinite(out['Видимость и охват'])){
      out['Видимость и охват'] = clamp(overall*0.6 + invTechGap*0.4, 0, 100);
    }

    out['CMDB и классификация'] = clamp(
      (Number.isFinite(grey)?grey*0.8:NaN), 0, 100
    );
    if(!Number.isFinite(out['CMDB и классификация'])){
      out['CMDB и классификация'] = clamp(overall*0.5 + invProcGap*0.5, 0, 100);
    }

    // network: use netSeg / terminalFarms / adDomains hints if present
    const netSeg = toNum(data.netSeg ?? data.netseg);
    const adDomains = toNum(data.adDomains ?? data.addomains);
    const branches = toNum(data.branches ?? data['Кол-во филиалов']);
    const netHint = (Number.isFinite(netSeg) && netSeg>0) || (Number.isFinite(adDomains)&&adDomains>1) || (Number.isFinite(branches)&&branches>0);
    out['Сетевое окружение и топология'] = clamp(netHint ? (overall*0.85) : (overall*0.55), 0, 100);

    out['Эксплуатация и стабильность'] = clamp(
      (Number.isFinite(ops)?ops:NaN), 0, 100
    );
    if(!Number.isFinite(out['Эксплуатация и стабильность'])){
      out['Эксплуатация и стабильность'] = clamp(overall*0.5 + obso*0.5, 0, 100);
    }

    out['Изменения и DevOps'] = clamp(overall*0.45 + invProcGap*0.55, 0, 100);

    out['SAM и оптимизация ПО'] = clamp(
      (Number.isFinite(lic)?lic:NaN), 0, 100
    );
    if(!Number.isFinite(out['SAM и оптимизация ПО'])){
      const unusedPct = clamp(signalPct(data,'unusedPct'), 0, 100);
      out['SAM и оптимизация ПО'] = clamp(overall*0.4 + (Number.isFinite(unusedPct)?unusedPct:50)*0.6, 0, 100);
    }

    out['Комплаенс, аудит и импортозамещение'] = clamp(
      (Number.isFinite(gov)?gov:NaN), 0, 100
    );
    if(!Number.isFinite(out['Комплаенс, аудит и импортозамещение'])){
      const docScore = clamp(signalPct(data,'docScore'), 0, 100);
      const invDocGap = 100 - (Number.isFinite(docScore)?docScore:50);
      out['Комплаенс, аудит и импортозамещение'] = clamp(overall*0.5 + invDocGap*0.5, 0, 100);
    }

    out['Стратегия, финансы и управляемость'] = clamp(overall*0.35 + invBusGap*0.35 + invReadyGap*0.2 + invPilotGap*0.1, 0, 100);

    // Fallback: any still NaN
    THEME_KEYS.forEach(t=>{ if(!Number.isFinite(out[t])) out[t]=40; });
    return out;
  }

  function needStrength(item, themeScores){
    const w = clamp(toNum(item.weight), 0, 5);
    const tScore = clamp(toNum(themeScores[item.theme] ?? 40), 0, 100);
    // 0..100 (weight scales impact)
    return Math.round(clamp((tScore * (w/3)), 0, 100));
  }

  // ===== Rendering: Themes =====
  function renderThemes(themeScores){
    if(!els.themeList || !CATALOG) return;
    const themes = (CATALOG.themes||[]).slice();
    // Sort by score desc if company loaded.
    if(getInterview()){
      themes.sort((a,b)=> (themeScores[b]||0) - (themeScores[a]||0));
    }

    els.themeList.innerHTML='';
    themes.forEach((t)=>{
      const score = clamp(toNum(themeScores[t]), 0, 100);
      const btn = document.createElement('button');
      btn.type='button';
      btn.className='tabBtn' + (t===SELECTED_THEME ? ' active' : '');
      btn.innerHTML = `
        <div class="tabTitle">${escapeHtml(t)} <span class="badge" style="margin-left:8px">Приоритет: ${score}</span></div>
        <div class="tabMeta">Основано на интервью (индексы/риски). Выше — важнее.</div>
        <div class="miniBar"><i style="width:${score}%"></i></div>
      `;
      btn.onclick = ()=>{
        SELECTED_THEME = t;
        // update active state
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
      row.className = 'needRow' + (it.id===SELECTED_NEED_ID ? ' active' : '');
      const strength = clamp(toNum(it.__strength), 0, 100);
      const star = strength >= 70 ? '<span class="star">★</span>' : '';
      row.innerHTML = `
        <div class="needLeft">
          <div class="needName">${escapeHtml(it.name||it.id||'')} ${star}</div>
          <div class="needMeta">${escapeHtml((it.zone?it.zone:'') + (it.theme?(' · '+it.theme):''))}</div>
        </div>
        <div class="needRight" style="display:flex;gap:8px;flex-wrap:wrap;justify-content:flex-end">
          <span class="badge">Сила: ${strength}</span>
          <span class="badge">Вес: ${Number(it.weight||0)}</span>
        </div>
      `;
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
        <div class="small">${escapeHtml(it.theme||'')} · ${escapeHtml(it.zone||'')} · Вес ${Number(it.weight||0)} · <b>Сила ${strength}</b></div>
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

    // Causes & Pains with checkboxes
    const two = document.createElement('div');
    two.className = 'twoCols';
    const onPickChange = ()=>{ /* no-op for now */ };
    two.appendChild(renderChecklist('Причины (мультивыбор)', it.causes, pick.causes, onPickChange));
    two.appendChild(renderChecklist('Боли (мультивыбор)', it.pains, pick.pains, onPickChange));
    els.needPanel.appendChild(two);

    // Questions with free input
    els.needPanel.appendChild(renderQuestions(it.questions, pick.answers, ()=>{}));

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
      renderAll();
    }catch(err){
      console.error('BN load error:', err);
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

  boot().catch(err=>{
    console.error('BN boot failed:', err);
    setStatus('Ошибка инициализации BN: ' + (err && err.message ? err.message : err), 'err');
  });
})();

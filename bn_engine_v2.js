
/* bn_engine_v2.js (v146)
   BN page engine:
   - company search + load latest interview row from PSI_Log via Apps Script
   - compute priorities for themes + business needs based on interview indices
   - render UI (themes, needs, panel)
   - save selections/answers to BN_Log (action=bn_log_append)
*/
(function(){
  const $ = (id)=>document.getElementById(id);

  const els = {
    dockCompany: $('dockCompany'),
    dockLoadBtn: $('dockLoadBtn'),
    dockSuggest: $('dockSuggest'),

    bnCompanyLabel: $('bnCompanyLabel'),
    bnStatus: $('bnStatus'),
    bnSaveBtn: $('bnSaveBtn'),

    bnCompanyInput: $('bnCompanyInput'),
    bnCompanyBtn: $('bnCompanyBtn'),
    bnCompanySuggest: $('bnCompanySuggest'),

    themeList: $('themeList'),
    needsList: $('needsList'),
    needPanel: $('needPanel'),

    fltTriggers: $('bnFltTriggers'),
    fltCritical: $('bnFltCritical'),
    fltMain: $('bnFltMain')
  };

  function escapeHtml(s){
    return String(s??'')
      .replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;')
      .replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function setStatus(msg, isErr){
    if(!els.bnStatus) return;
    els.bnStatus.textContent = msg || '';
    els.bnStatus.style.color = isErr ? '#b91c1c' : '#374151';
  }

  // ===== loader overlay =====
  function ensureLoader(){
    if(document.getElementById('bnLoader')) return;
    const d = document.createElement('div');
    d.id = 'bnLoader';
    d.style.cssText = 'position:fixed;inset:0;display:none;align-items:center;justify-content:center;background:rgba(255,255,255,.6);backdrop-filter:blur(2px);z-index:9999;';
    d.innerHTML = `
      <div style="display:flex;flex-direction:column;gap:10px;align-items:center;">
        <div style="width:34px;height:34px;border:4px solid #ddd;border-top-color:#ff0000;border-radius:50%;animation:bnspin 1s linear infinite;"></div>
        <div id="bnLoaderText" style="font:500 14px Inter,system-ui;color:#111827">Загрузка…</div>
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
    d.style.display='flex';
  }
  function hideLoader(){
    const d = document.getElementById('bnLoader');
    if(d) d.style.display='none';
  }

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
    try { return JSON.parse(txt); } catch(e){
      throw new Error('Bad JSON from Apps Script: ' + txt.slice(0,200));
    }
  }
  async function gsPost(action, payload){
    const base = webappUrl();
    if(!base) throw new Error('GS_WEBAPP_URL is not set (config.js)');
    const res = await fetch(base, {
      method:'POST',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ action, ...payload })
    });
    const txt = await res.text();
    try { return JSON.parse(txt); } catch(e){
      throw new Error('Bad JSON from Apps Script: ' + txt.slice(0,200));
    }
  }

  function debounce(fn, ms){
    let t=null;
    return (...args)=>{ clearTimeout(t); t=setTimeout(()=>fn(...args), ms); };
  }

  // ===== Catalog =====
  let CATALOG=null;
  async function loadCatalog(){
    if(CATALOG) return CATALOG;
    const res = await fetch('bn_catalog.json', {cache:'no-store'});
    CATALOG = await res.json();
    return CATALOG;
  }

  // ===== interview payload =====
  let CURRENT_COMPANY = '';
  let CURRENT_ROW = null;
  let CURRENT_PAYLOAD = null;

  // Normalize numbers to 0..100
  function toNum(v){
    if(v===null||v===undefined||v==='') return NaN;
    if(typeof v === 'number') return v;
    const s = String(v).replace(',', '.').replace(/[^\d.\-]/g,'').trim();
    const n = Number(s);
    return Number.isFinite(n) ? n : NaN;
  }
  function norm100(v){
    const n = toNum(v);
    if(!Number.isFinite(n)) return null;
    // if looks like 0..1 => percent
    if(n>=0 && n<=1) return n*100;
    // if looks like 0..10 => scale
    if(n>=0 && n<=10) return n*10;
    // clamp 0..100
    return Math.max(0, Math.min(100, n));
  }
  function getAny(payload, keys){
    for(const k of keys){
      if(payload==null) continue;
      if(payload[k]!==undefined && payload[k]!==null && payload[k]!== '') return payload[k];
      const lk = String(k).toLowerCase();
      if(payload[lk]!==undefined && payload[lk]!==null && payload[lk]!== '') return payload[lk];
    }
    return null;
  }

  // ===== Priority model (heuristics, based on interview indices) =====
  function computeThemePriorities(payload){
    const tech = norm100(getAny(payload,['techIndex','techindex']));
    const proc = norm100(getAny(payload,['procIndex','procindex']));
    const risk = norm100(getAny(payload,['riskIndex','riskindex']));
    const pain = norm100(getAny(payload,['painIndex','painindex']));
    const bus  = norm100(getAny(payload,['busIndex','busindex']));
    const rec  = norm100(getAny(payload,['recoverIndex','recoverindex']));
    const obsol= norm100(getAny(payload,['obsolIndex','obsolindex']));
    const ready= norm100(getAny(payload,['readyIndex','readyindex']));
    const coi  = norm100(getAny(payload,['coiTotal','coitotal'])); // may be RUB; norm handles, but not meaningful
    // helper weighted avg ignoring nulls
    const wavg = (pairs)=>{
      let sw=0, sx=0;
      for(const [val,w] of pairs){
        if(val===null || !Number.isFinite(val)) continue;
        sw+=w; sx+=val*w;
      }
      if(sw<=0) return 0;
      return Math.max(0, Math.min(100, sx/sw));
    };

    const out = {};

    const themes = (CATALOG && CATALOG.themes) ? CATALOG.themes : [];
    for(const t of themes){
      let score = 0;
      if(t.includes('Видимость') || t.includes('источник данных')){
        score = wavg([[pain,0.35],[proc,0.25],[tech,0.25],[risk,0.15]]);
      } else if(t.includes('Change') || t.includes('Drift') || t.includes('изменен')){
        score = wavg([[risk,0.45],[proc,0.30],[tech,0.25]]);
      } else if(t.includes('кибер') || t.includes('техничес')){
        score = wavg([[risk,0.45],[tech,0.35],[proc,0.20]]);
      } else if(t.includes('Отчет') || t.includes('стратег')){
        score = wavg([[bus,0.40],[ready,0.25],[proc,0.20],[risk,0.15]]);
      } else if(t.includes('качеством данных') || t.includes('агрегац') || t.includes('Сбор')){
        score = wavg([[pain,0.40],[proc,0.30],[tech,0.20],[risk,0.10]]);
      } else if(t.includes('жизненным циклом') || t.includes('активов')){
        score = wavg([[obsol,0.40],[tech,0.30],[proc,0.20],[risk,0.10]]);
      } else if(t.includes('программным обеспечением') || t.includes('SAM') || t.includes('лиценз')){
        score = wavg([[risk,0.35],[pain,0.25],[proc,0.20],[tech,0.20]]);
      } else if(t.includes('Финансы') || t.includes('бюджет') || t.includes('FinOps')){
        score = wavg([[bus,0.35],[risk,0.25],[proc,0.20],[tech,0.20]]);
      } else {
        score = wavg([[risk,0.25],[proc,0.25],[tech,0.25],[pain,0.25]]);
      }
      out[t] = Number(score.toFixed(2));
    }
    return out;
  }

  function weightMultiplier(w){
    const n = Number(w||0);
    if(n>=3) return 1.00;
    if(n===2) return 0.85;
    if(n===1) return 0.70;
    return 0.75;
  }

  function computeNeedPriority(need, themeScore){
    const base = Number(themeScore||0);
    const mult = weightMultiplier(need.weight);
    const score = Math.max(0, Math.min(100, base * mult));
    return Number(score.toFixed(0));
  }

  // ===== UI render =====
  let THEME_SCORES = {};
  let ACTIVE_THEME = '';
  let ACTIVE_NEED_ID = '';

  function renderThemes(){
    if(!els.themeList || !CATALOG) return;
    els.themeList.innerHTML = '';
    const themes = (CATALOG.themes||[]).slice().sort((a,b)=> (THEME_SCORES[b]||0)-(THEME_SCORES[a]||0));
    themes.forEach((t)=>{
      const score = Number(THEME_SCORES[t]||0);
      const btn = document.createElement('button');
      btn.type='button';
      btn.className = 'themeCard' + (t===ACTIVE_THEME ? ' active' : '');
      btn.innerHTML = `
        <div class="themeTop">
          <div class="themeName">${escapeHtml(t)}</div>
          <div class="themeBadge">Приоритет: ${escapeHtml(score)}</div>
        </div>
        <div class="themeHint">Основано на интервью (индексы/риски). Выше — важнее.</div>
        <div class="bar"><span style="width:${score}%;"></span></div>
      `;
      btn.onclick = ()=>{
        ACTIVE_THEME = t;
        document.querySelectorAll('#themeList .themeCard').forEach(x=>x.classList.remove('active'));
        btn.classList.add('active');
        renderNeeds();
      };
      els.themeList.appendChild(btn);
    });
  }

  function passesFilters(item){
    const trig = !!(els.fltTriggers && els.fltTriggers.checked);
    const crit = !!(els.fltCritical && els.fltCritical.checked);
    const main = !!(els.fltMain && els.fltMain.checked);

    // triggers are not in catalog now -> false unless we later add `trigger:true`
    if(trig && item.trigger !== true) return false;

    const w = Number(item.weight||0);
    if(crit && w < 3) return false;
    if(main && w < 2) return false;
    return true;
  }

  function renderNeeds(){
    if(!els.needsList || !CATALOG) return;
    const items = (CATALOG.items||[])
      .filter(it => !ACTIVE_THEME || String(it.theme||'')===ACTIVE_THEME)
      .filter(passesFilters)
      .map(it=>{
        const tp = Number(THEME_SCORES[it.theme]||0);
        const pr = computeNeedPriority(it, tp);
        return {...it, priority: pr, themePriority: tp};
      })
      .sort((a,b)=> (b.priority-a.priority) || (Number(b.weight||0)-Number(a.weight||0)));

    els.needsList.innerHTML = '';
    items.forEach((it)=>{
      const card = document.createElement('button');
      card.type='button';
      card.className = 'needCard' + (it.id===ACTIVE_NEED_ID ? ' active' : '');
      card.innerHTML = `
        <div class="needTitle">${escapeHtml(it.name)}</div>
        <div class="needSub">${escapeHtml((it.zone||'') + (it.theme?(' · '+it.theme):''))}</div>
        <div class="needBadges">
          <span class="badge">Приоритет: ${escapeHtml(it.priority)}</span>
          <span class="badge muted">Вес: ${escapeHtml(it.weight||0)}</span>
        </div>
      `;
      card.onclick = ()=>{
        ACTIVE_NEED_ID = it.id;
        document.querySelectorAll('#needsList .needCard').forEach(x=>x.classList.remove('active'));
        card.classList.add('active');
        renderNeedPanel(it);
      };
      els.needsList.appendChild(card);
    });

    if(items.length===0){
      els.needsList.innerHTML = '<div class="muted">Нет бизнес‑потребностей по выбранным фильтрам.</div>';
    }
  }

  function splitLinesToList(text){
    const s = String(text||'').trim();
    if(!s) return [];
    // split by newline or bullet
    const raw = s.split(/
+/).map(x=>x.trim()).filter(Boolean);
    // also split long lines that contain bullets with "•" or "-"
    const out=[];
    raw.forEach(line=>{
      const parts = line.split(/•|•|–|- /).map(x=>x.trim()).filter(Boolean);
      if(parts.length>1 && parts.join('').length < line.length+5) out.push(...parts);
      else out.push(line);
    });
    // de-duplicate
    const seen = new Set();
    return out.filter(x=>{ const k=x.toLowerCase(); if(seen.has(k)) return false; seen.add(k); return true; });
  }

  function renderNeedPanel(it){
    if(!els.needPanel) return;
    const qList = splitLinesToList(it.questions);
    const causes = splitLinesToList(it.causes);
    const pains  = splitLinesToList(it.pains);

    const questionsHtml = qList.map((q,idx)=>`
      <div class="qBlock">
        <div class="qText">${escapeHtml(q)}</div>
        <textarea class="qAnswer" data-q="${escapeHtml(String(idx))}" placeholder="Ответ..."></textarea>
      </div>
    `).join('');

    const causeHtml = causes.map((c,idx)=>`
      <label class="chk">
        <input type="checkbox" class="bnCause" data-i="${escapeHtml(String(idx))}">
        <span>${escapeHtml(c)}</span>
      </label>
    `).join('');

    const painHtml = pains.map((p,idx)=>`
      <label class="chk">
        <input type="checkbox" class="bnPain" data-i="${escapeHtml(String(idx))}">
        <span>${escapeHtml(p)}</span>
      </label>
    `).join('');

    els.needPanel.innerHTML = `
      <div class="panelHead">
        <div class="panelTitle">${escapeHtml(it.name)}</div>
        <div class="panelMeta">${escapeHtml(it.theme)} · ${escapeHtml(it.zone||'')} · Вес ${escapeHtml(it.weight||0)} · Приоритет ${escapeHtml(computeNeedPriority(it, THEME_SCORES[it.theme]||0))}</div>
        <div class="panelHint">⭐ Выбери причины/боли и заполни ответы — это сохранится в BN_Log</div>
      </div>

      <div class="panelSection">
        <div class="h">Описание (биз‑задача)</div>
        <div class="p">${escapeHtml(it.description||'')}</div>
      </div>

      <div class="panelSection">
        <div class="h">Вопросы (ответы — свободный ввод)</div>
        ${questionsHtml || '<div class="muted">Нет вопросов.</div>'}
      </div>

      <div class="panelSection cols2">
        <div>
          <div class="h">Причины (мультивыбор)</div>
          ${causeHtml || '<div class="muted">Нет причин.</div>'}
        </div>
        <div>
          <div class="h">Боли (мультивыбор)</div>
          ${painHtml || '<div class="muted">Нет болей.</div>'}
        </div>
      </div>

      <details class="panelSection">
        <summary class="h">ITIL</summary>
        <div class="p pre">${escapeHtml(it.itil||'')}</div>
      </details>

      <details class="panelSection">
        <summary class="h">Процессы / интеграции</summary>
        <div class="p pre">${escapeHtml(it.process_integration||'')}</div>
      </details>

      <details class="panelSection">
        <summary class="h">KPI</summary>
        <div class="p pre">${escapeHtml(it.kpi||'')}</div>
      </details>

      <details class="panelSection">
        <summary class="h">Класс решений</summary>
        <div class="p pre">${escapeHtml(it.solutions_class||'')}</div>
      </details>

      <details class="panelSection">
        <summary class="h">Функционал ITMen</summary>
        <div class="p pre">${escapeHtml(it.functional||'')}</div>
      </details>

      <details class="panelSection">
        <summary class="h">Ожидаемый результат</summary>
        <div class="p pre">${escapeHtml(it.result||'')}</div>
      </details>
    `;
  }

  // ===== Company search + load =====
  const doSearch = debounce(async (q, targetSuggest)=>{
    const query = String(q||'').trim();
    if(query.length < 2){
      if(targetSuggest) targetSuggest.innerHTML='';
      return;
    }
    try{
      setStatus('Поиск компании…', false);
      showLoader('Поиск компании…');
      const out = await gsGet({action:'search', q:query, limit:10});
      hideLoader();
      if(!out || out.ok!==true) throw new Error(out && out.error ? out.error : 'search failed');
      const items = out.items || [];
      if(!targetSuggest) return;
      targetSuggest.innerHTML = '';
      items.forEach((it)=>{
        const b = document.createElement('button');
        b.type='button';
        b.className='suggestItem';
        b.textContent = it.company + (it.timestamp ? (' · ' + it.timestamp) : '');
        b.onclick = ()=>{
          const name = it.company;
          if(els.dockCompany) els.dockCompany.value = name;
          if(els.bnCompanyInput) els.bnCompanyInput.value = name;
          targetSuggest.innerHTML='';
          loadCompanyByRow(it.row, name);
        };
        targetSuggest.appendChild(b);
      });
      if(items.length===0){
        targetSuggest.innerHTML = '<div class="muted" style="padding:8px 10px">Не найдено</div>';
      }
      setStatus('', false);
    }catch(err){
      hideLoader();
      setStatus('Ошибка поиска: ' + (err.message||String(err)), true);
    }
  }, 300);

  async function loadCompanyByRow(row, name){
    try{
      setStatus('Загрузка данных по компании…', false);
      showLoader('Загрузка данных по компании…');
      const out = await gsGet({action:'get', row: row});
      hideLoader();
      if(!out || out.ok!==true) throw new Error(out && out.error ? out.error : 'get failed');
      const payload = out.payload || out.item || {};
      CURRENT_PAYLOAD = payload;
      CURRENT_ROW = payload._row || row;
      CURRENT_COMPANY = payload._company || name || payload.company || '';
      if(els.bnCompanyLabel) els.bnCompanyLabel.textContent = CURRENT_COMPANY ? ('Данные загружены: ' + CURRENT_COMPANY) : '';
      THEME_SCORES = computeThemePriorities(payload);
      renderThemes();
      // auto-select best theme
      const best = Object.keys(THEME_SCORES).sort((a,b)=> (THEME_SCORES[b]||0)-(THEME_SCORES[a]||0))[0] || '';
      ACTIVE_THEME = best;
      renderThemes();
      renderNeeds();
      setStatus('', false);
    }catch(err){
      hideLoader();
      setStatus('Ошибка загрузки: ' + (err.message||String(err)), true);
    }
  }

  async function loadCompanyByName(name){
    const q = String(name||'').trim();
    if(!q) return;
    try{
      setStatus('Загрузка данных по компании…', false);
      showLoader('Загрузка данных по компании…');
      const out = await gsGet({action:'get', company:q});
      hideLoader();
      if(!out || out.ok!==true) throw new Error(out && out.error ? out.error : 'get failed');
      const payload = out.payload || out.item || {};
      CURRENT_PAYLOAD = payload;
      CURRENT_ROW = payload._row || null;
      CURRENT_COMPANY = payload._company || q;
      if(els.bnCompanyLabel) els.bnCompanyLabel.textContent = CURRENT_COMPANY ? ('Данные загружены: ' + CURRENT_COMPANY) : '';
      THEME_SCORES = computeThemePriorities(payload);
      renderThemes();
      const best = Object.keys(THEME_SCORES).sort((a,b)=> (THEME_SCORES[b]||0)-(THEME_SCORES[a]||0))[0] || '';
      ACTIVE_THEME = best;
      renderThemes();
      renderNeeds();
      setStatus('', false);
    }catch(err){
      hideLoader();
      setStatus('Ошибка загрузки: ' + (err.message||String(err)), true);
    }
  }

  // ===== Save to BN_Log =====
  async function saveBn(){
    try{
      if(!CURRENT_COMPANY) throw new Error('Сначала загрузите компанию (поиск/выбор).');
      const need = (CATALOG.items||[]).find(x=>x.id===ACTIVE_NEED_ID) || null;

      const answers = {};
      document.querySelectorAll('#needPanel textarea.qAnswer').forEach(t=>{
        const k = t.getAttribute('data-q');
        answers[k] = t.value || '';
      });

      const selCauses = [];
      document.querySelectorAll('#needPanel input.bnCause:checked').forEach(ch=>{
        const i = Number(ch.getAttribute('data-i'));
        selCauses.push(i);
      });
      const selPains = [];
      document.querySelectorAll('#needPanel input.bnPain:checked').forEach(ch=>{
        const i = Number(ch.getAttribute('data-i'));
        selPains.push(i);
      });

      const payload = {
        company: CURRENT_COMPANY,
        source_row: CURRENT_ROW || '',
        selected_theme: ACTIVE_THEME || (need?need.theme:''),
        selected_need_id: need?need.id:'',
        selected_need_name: need?need.name:'',
        theme_priority: THEME_SCORES[ACTIVE_THEME] ?? (need?THEME_SCORES[need.theme]:0) ?? 0,
        need_priority: need ? computeNeedPriority(need, THEME_SCORES[need.theme]||0) : 0,
        weight: need ? (need.weight||0) : 0,
        selected_causes_idx: selCauses,
        selected_pains_idx: selPains,
        answers: answers,
        // keep snapshot of theme scores for audit
        theme_scores: THEME_SCORES
      };

      showLoader('Сохранение…');
      const out = await gsPost('bn_log_append', { payload });
      hideLoader();
      if(!out || out.ok!==true) throw new Error(out && out.error ? out.error : 'save failed');
      setStatus('Сохранено в BN_Log' + (out.row?(': строка '+out.row):''), false);
    }catch(err){
      hideLoader();
      setStatus('Ошибка сохранения: ' + (err.message||String(err)), true);
    }
  }

  // ===== init =====
  async function init(){
    await loadCatalog();

    // ensure containers have layout classes (if CSS exists)
    if(els.themeList) els.themeList.classList.add('themeGrid');
    if(els.needsList) els.needsList.classList.add('needsGrid');

    // hooks
    if(els.dockCompany){
      els.dockCompany.addEventListener('input', (e)=> doSearch(e.target.value, els.dockSuggest));
    }
    if(els.bnCompanyInput){
      els.bnCompanyInput.addEventListener('input', (e)=> doSearch(e.target.value, els.bnCompanySuggest));
    }
    if(els.dockLoadBtn){
      els.dockLoadBtn.addEventListener('click', ()=> loadCompanyByName(els.dockCompany ? els.dockCompany.value : ''));
    }
    if(els.bnCompanyBtn){
      els.bnCompanyBtn.addEventListener('click', ()=> loadCompanyByName(els.bnCompanyInput ? els.bnCompanyInput.value : ''));
    }
    if(els.bnSaveBtn){
      els.bnSaveBtn.addEventListener('click', saveBn);
    }

    [els.fltTriggers, els.fltCritical, els.fltMain].forEach(ch=>{
      if(!ch) return;
      ch.addEventListener('change', ()=> renderNeeds());
    });

    // initial render without company
    THEME_SCORES = {};
    (CATALOG.themes||[]).forEach(t=> THEME_SCORES[t]=0);
    renderThemes();
    ACTIVE_THEME = (CATALOG.themes||[])[0] || '';
    renderThemes();
    renderNeeds();
  }

  document.addEventListener('DOMContentLoaded', init);
})();


/* bn_engine_v2.js
   Business Needs (BN) page engine:
   - company search (action=search)
   - load latest row for selected company (action=get)
   - basic rendering of themes + needs catalog
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
    bnSummary: $('bnSummary'),
    fltTriggers: $('bnFltTriggers'),
    fltCritical: $('bnFltCritical'),
    fltMain: $('bnFltMain')
  };

  function setStatus(msg, isErr){
    if(!els.bnStatus) return;
    els.bnStatus.textContent = msg || '';
    els.bnStatus.style.color = isErr ? '#b91c1c' : '#374151';
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
    // Apps Script sometimes returns JSONP if callback is passed; we don't.
    try { return JSON.parse(txt); } catch(e){
      throw new Error('Bad JSON from Apps Script: ' + txt.slice(0,180));
    }
  }

  function debounce(fn, ms){
    let t=null;
    return (...args)=>{
      clearTimeout(t);
      t=setTimeout(()=>fn(...args), ms);
    };
  }

  // ===== Catalog loading =====
  let CATALOG = null;

  async function loadCatalog(){
    if(CATALOG) return CATALOG;
    const res = await fetch('bn_catalog.json', {cache:'no-store'});
    CATALOG = await res.json();
    return CATALOG;
  }

  function renderThemes(){
    if(!els.themeList || !CATALOG) return;
    els.themeList.innerHTML = '';
    (CATALOG.themes||[]).forEach((t)=>{
      const chip = document.createElement('button');
      chip.type='button';
      chip.className='chip';
      chip.textContent = t;
      chip.onclick = ()=> {
        document.querySelectorAll('#themeList .chip').forEach(n=>n.classList.remove('active'));
        chip.classList.add('active');
        renderNeeds({theme:t});
      };
      els.themeList.appendChild(chip);
    });
  }

  function passesFilters(item){
    // place-holders: based on fields in catalog, if exist
    // triggers/critical/main are not explicit in current catalog -> treat weight>=3 as critical and weight==1 as main? (approx)
    const trig = !!(els.fltTriggers && els.fltTriggers.checked);
    const crit = !!(els.fltCritical && els.fltCritical.checked);
    const main = !!(els.fltMain && els.fltMain.checked);
    if(trig){
      // if catalog ever adds `trigger:true`
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

  function renderNeeds(opts){
    if(!els.needsList || !CATALOG) return;
    const theme = opts && opts.theme ? String(opts.theme) : '';
    const items = (CATALOG.items||[])
      .filter(it => !theme || String(it.theme||'')===theme)
      .filter(passesFilters)
      .sort((a,b)=>Number(b.weight||0)-Number(a.weight||0));
    els.needsList.innerHTML='';
    items.forEach((it)=>{
      const row = document.createElement('div');
      row.className='needRow';
      row.innerHTML = `
        <div class="needLeft">
          <div class="needName">${escapeHtml(it.name||it.id||'')}</div>
          <div class="needMeta">${escapeHtml((it.theme||'') + (it.zone?(' · '+it.zone):''))}</div>
        </div>
        <div class="needRight">
          <span class="badge">Вес: ${Number(it.weight||0)}</span>
        </div>
      `;
      row.onclick = ()=> renderNeedPanel(it);
      els.needsList.appendChild(row);
    });
    if(!items.length){
      els.needsList.innerHTML = '<div class="muted">Ничего не найдено по фильтрам.</div>';
    }
  }

  function renderNeedPanel(it){
    if(!els.needPanel) return;
    const lines = (arr)=> (arr && arr.length) ? `<ul>${arr.map(x=>`<li>${escapeHtml(String(x))}</li>`).join('')}</ul>` : '<div class="muted">—</div>';
    els.needPanel.innerHTML = `
      <div class="panel">
        <div class="panelTitle">${escapeHtml(it.name||it.id||'')}</div>
        <div class="panelSub">${escapeHtml(it.task||'')}</div>

        <div class="panelGrid">
          <div>
            <h4>Причины</h4>
            ${lines(it.causes)}
          </div>
          <div>
            <h4>Боли</h4>
            ${lines(it.pains)}
          </div>
          <div>
            <h4>Вопросы</h4>
            ${lines(it.questions)}
          </div>
          <div>
            <h4>Ожидаемый результат</h4>
            <pre class="pre">${escapeHtml(it.result||'')}</pre>
          </div>
        </div>

        <details class="details"><summary>ITIL</summary><pre class="pre">${escapeHtml(it.itil||'')}</pre></details>
        <details class="details"><summary>Процессы / интеграции</summary><pre class="pre">${escapeHtml(it.process||'')}</pre></details>
        <details class="details"><summary>KPI</summary><pre class="pre">${escapeHtml(it.kpi||'')}</pre></details>
        <details class="details"><summary>Класс решений</summary><pre class="pre">${escapeHtml(it.solutions_class||'')}</pre></details>
        <details class="details"><summary>Функционал ИТМен</summary><pre class="pre">${escapeHtml(it.functional||'')}</pre></details>
      </div>
    `;
  }

  function escapeHtml(s){
    return String(s)
      .replaceAll('&','&amp;')
      .replaceAll('<','&lt;')
      .replaceAll('>','&gt;')
      .replaceAll('"','&quot;')
      .replaceAll("'","&#039;");
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
    setStatus('Загрузка данных по компании…');
    try{
      const out = await gsGet(row ? {action:'get', row} : {action:'get', company});
      if(!out || out.ok !== true) throw new Error(out && out.error ? out.error : 'get failed');
      const payload = out.payload || out.item || {};
      const name = payload._company || payload.company || company || '';
      window.__BN_COMPANY = name;
      window.__BN_DATA = payload;

      if(els.bnCompanyLabel) els.bnCompanyLabel.textContent = name || '—';
      setStatus('Данные загружены: ' + (name||''));
      // (Optional) You can use payload to highlight themes later.
      if(els.bnSummary){
        const ts = payload.timestamp || payload.Timestamp || payload._timestamp || '';
        const ri = payload.riskIndex || payload.riskindex || '';
        els.bnSummary.textContent = `Источник: PSI_Log, строка ${payload._row||''}${ts?(' · '+ts):''}${ri?(' · RiskIndex: '+ri):''}`;
      }
      // Render default list if not yet
      if(CATALOG){
        renderNeeds({});
      }
    }catch(err){
      console.error('BN load error:', err);
      setStatus('Ошибка загрузки: ' + (err && err.message ? err.message : err), true);
    }
  }

  function init(){
    // Catalog
    loadCatalog().then(()=>{
      renderThemes();
      renderNeeds({});
    }).catch((e)=>console.error('bn_catalog load failed', e));

    // Bind search inputs
    const debDock = debounce((e)=>searchCompany(e.target.value, 'dock'), 250);
    const debMain = debounce((e)=>searchCompany(e.target.value, 'main'), 250);

    if(els.dockCompany) els.dockCompany.addEventListener('input', debDock);
    if(els.bnCompanyInput) els.bnCompanyInput.addEventListener('input', debMain);

    if(els.dockLoadBtn) els.dockLoadBtn.addEventListener('click', ()=>{
      const v = els.dockCompany ? els.dockCompany.value : '';
      loadCompany({company:v});
    });
    if(els.bnCompanyBtn) els.bnCompanyBtn.addEventListener('click', ()=>{
      const v = els.bnCompanyInput ? els.bnCompanyInput.value : '';
      loadCompany({company:v});
    });

    // Filters
    [els.fltTriggers, els.fltCritical, els.fltMain].forEach(cb=>{
      if(!cb) return;
      cb.addEventListener('change', ()=>renderNeeds({theme: getActiveTheme()}));
    });

    // If company is already in input (e.g., carried from quick dock), attempt load on button click only.
    setStatus('');
  }

  function getActiveTheme(){
    const act = document.querySelector('#themeList .chip.active');
    return act ? act.textContent : '';
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();

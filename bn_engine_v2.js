// BN Engine v2 — Risks -> Themes -> Business Needs -> (Causes/Pains/Questions)
// Data source: bn_catalog.json (generated from "Копия Подход.xlsx")
// Storage: embedded into saved payload JSON under key "business_needs_sessions".

(function(){
  const WEBAPP_URL = (window.GS_WEBAPP_URL || '').trim();
  const VERSION = (window.BUILD_INFO && window.BUILD_INFO.version) ? window.BUILD_INFO.version : '';

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
    status: () => document.getElementById('bnStatus')
  };

  let BN_CATALOG = null;
  let ACTIVE_COMPANY = '';
  let ACTIVE_ROW = null; // latest row object from Sheets (parsed)
  let HEATMAP = null;    // zone risks 0..1
  let THEME_RISKS = {};  // theme -> 0..1
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

  function jsonp(url, timeoutMs=12000){
    return new Promise((resolve, reject) => {
      const cb = 'cb_' + Math.random().toString(36).slice(2);
      const script = document.createElement('script');
      const timer = setTimeout(() => { cleanup(); reject(new Error('JSONP timeout')); }, timeoutMs);
      function cleanup(){
        clearTimeout(timer);
        try{ delete window[cb]; }catch(e){ window[cb]=undefined; }
        if(script.parentNode) script.parentNode.removeChild(script);
      }
      window[cb] = (data)=>{ cleanup(); resolve(data); };
      const sep = url.includes('?') ? '&' : '?';
      script.src = url + sep + 'callback=' + encodeURIComponent(cb);
      script.onerror = ()=>{ cleanup(); reject(new Error('JSONP load error')); };
      document.body.appendChild(script);
    });
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

    const themes = (BN_CATALOG && BN_CATALOG.themes) ? BN_CATALOG.themes : Object.keys(THEME_RISKS);
    const rows = themes.map(t=>{
      const r = THEME_RISKS[t];
      const active = (t===ACTIVE_THEME) ? ' active' : '';
      return `<button class="themeBtn${active}" data-theme="${esc(t)}">
        <div class="themeName">${esc(t)}</div>
        <div class="themeMeta">Риск: <b>${fmtPct01(r)}</b></div>
        <div class="themeBar"><span style="width:${Math.max(0,Math.min(100,Math.round((r||0)*100)))}%"></span></div>
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

    // show only Top N inside theme (keeps UX small)
    const TOP_N = 10;
    const top = bnList.slice(0, TOP_N);

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
      return `<button class="needBtn${active}" data-bn="${esc(bn.id)}">
        <div class="needName">${esc(bn.name)}</div>
        <div class="needMeta">Сила: <b>${esc(sLabel)}</b> · Вес: ${esc(bn.weight)} · Зона: ${esc(bn.zone||'—')}</div>
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
        manager_notes: ''
      };
    }
    return payload.business_needs_sessions[bnId];
  }

  function renderNeedPanel(){
    const panel = UI.needPanel();
    if(!panel) return;

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
      <div class="card">
        <div class="needHead">
          <div>
            <div class="needTitle">${esc(bn.name)}</div>
            <div class="small">Тематика: <b>${esc(bn.theme||'—')}</b> · Зона: <b>${esc(bn.zone||'—')}</b> · Сила: <b>${Math.round(sess.strength)}</b></div>
          </div>
          <div class="needHeadRight">
            <button type="button" class="btn ghost" id="bnCollapseAll">Свернуть</button>
            <button type="button" class="btn" id="bnSaveNow">Сохранить</button>
          </div>
        </div>
        <div class="hr"></div>

        <div class="block">
          <div class="blockTitle">Подробное описание</div>
          <div class="blockText">${esc(bn.task || '—')}</div>
        </div>

        <div class="block">
          <details open class="details" id="detCauses">
            <summary>Причины (отметь, что подтверждено)</summary>
            <div class="checkGrid">
              ${causes.map((c,idx)=>{
                const id = `c_${bn.id}_${idx}`;
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
      const data = await jsonp(url);
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
      const url = WEBAPP_URL + '?action=latest&company=' + encodeURIComponent(company);
      const data = await jsonp(url);
      if(!data || !data.ok || !data.row || !Array.isArray(data.row)){
        setStatus('Не найдено данных по компании. Сначала заполни интервью/индексы.', 'err');
        return;
      }

      // row is array aligned to SHEET_KEYS
      const keys = (window.SHEET_KEYS || []);
      const rowObj = parseTSVRowToObject(data.row, keys);
      ACTIVE_ROW = rowObj;

      // 2) compute heatmap from saved tech/proc answers
      HEATMAP = computeHeatmapFromRow(rowObj);
      THEME_RISKS = computeThemeRisks(HEATMAP);

      // 3) render
      setStatus('Данные загружены. Выбери тематику и BN.', 'ok');
      renderThemes();
      renderNeeds();
      renderSummary();

      // update query string for share
      const qs = '?company=' + encodeURIComponent(company);
      history.replaceState(null,'', location.pathname + qs);

      // update quickdock links
      try{ updateDockLinks(company); }catch(_e){}

    }catch(e){
      console.error(e);
      setStatus('Ошибка загрузки из Apps Script.', 'err');
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

    // Save button (top)
    const topSave = UI.saveBtn();
    topSave && topSave.addEventListener('click', saveCurrent);

    // initial empty render
    renderThemes();
    renderNeeds();
    renderSummary();
  });

})();

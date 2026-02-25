// Auto-injected build metadata (update on each deploy)
window.ITMEN_BUILD = {
  build: "v71",
  built_at: "2026-02-25T00:00:00Z",
  source: "repo_v71"
};

(function(){
  try {
    console.log(`✅ BUILD ${window.ITMEN_BUILD.build} loaded | built_at ${window.ITMEN_BUILD.built_at}`);
  } catch(_e){}

  function ensureBadge(){
    try{
      const id = 'itmen-build-badge';
      let el = document.getElementById(id);
      if(!el){
        el = document.createElement('div');
        el.id = id;
        el.style.position = 'fixed';
        el.style.right = '10px';
        el.style.bottom = '10px';
        el.style.zIndex = '2147483647';
        el.style.padding = '6px 10px';
        el.style.borderRadius = '10px';
        el.style.fontFamily = 'ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace';
        el.style.fontSize = '12px';
        el.style.lineHeight = '1.2';
        el.style.background = 'rgba(0,0,0,0.65)';
        el.style.color = '#fff';
        el.style.boxShadow = '0 6px 20px rgba(0,0,0,0.25)';
        el.style.backdropFilter = 'blur(6px)';
        el.style.webkitBackdropFilter = 'blur(6px)';
        el.style.cursor = 'pointer';
        el.title = 'Click to copy build info';
        document.body.appendChild(el);
        el.addEventListener('click', async ()=>{
          const txt = `BUILD ${window.ITMEN_BUILD.build} | built_at ${window.ITMEN_BUILD.built_at} | source ${window.ITMEN_BUILD.source}`;
          try{ await navigator.clipboard.writeText(txt); }catch(_e){}
        });
      }
      el.textContent = `BUILD ${window.ITMEN_BUILD.build}`;
    }catch(_e){}
  }

  if(document.readyState === 'loading'){
    document.addEventListener('DOMContentLoaded', ensureBadge, {once:true});
  } else {
    ensureBadge();
  }
})();

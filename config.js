// Central config for ITMen PSI tools
// Update GS_WEBAPP_URL here and it will apply to all pages.
// IMPORTANT:
// Put your *current* Apps Script WebApp /exec URL here after each deployment.
// Example:
// window.GS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbwtBLKDLp9Okdlm0EvcUAWb5COpdHya3YTnkJJ7Vxp7uZkuIFtFi3WFgQKnum3vPdQyeA/exec";
// ✅ CURRENT WebApp /exec URL
// Если после деплоя снова "Ошибка загрузки" — почти всегда причина в том, что URL поменялся.
// Обнови эту строку на новый /exec.
window.GS_WEBAPP_URL = "https://script.google.com/macros/s/AKfycbxo3dDM7FNDggGYD18_ZJHzunaa9i0HdcUukkz9_wbvzPvzzGXXnryxnQ9wfMLvglUtGg/exec";

// Optional: allow overriding from URL for quick debug
// Example: view_1_indices.html?gs=https://script.google.com/macros/s/....../exec
try{
  const u = new URL(location.href);
  const override = (u.searchParams.get('gs') || u.searchParams.get('webapp') || '').trim();
  if(override && override.startsWith('https://script.google.com/macros/s/')){
    window.GS_WEBAPP_URL = override;
  }
}catch(_e){}

// Backward-compatible alias used by older pages
window.GOOGLE_SHEETS_WEBAPP_URL = window.GS_WEBAPP_URL;

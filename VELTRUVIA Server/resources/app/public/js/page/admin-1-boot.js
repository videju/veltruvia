
// ── Global Error Boundary ──
window.onerror=function(msg,src,line,col,err){console.error("[VELTRUVIA Error]",{msg,src,line,col,err});return false;};
window.addEventListener("unhandledrejection",function(e){console.error("[VELTRUVIA Unhandled Promise]",e.reason);});
function toggleTheme(){const h=document.documentElement;const c=h.getAttribute('data-theme')||'light';const n=c==='light'?'dark':'light';h.setAttribute('data-theme',n);localStorage.setItem('onco_admin_theme',n);document.getElementById('theme-btn').textContent=n==='dark'?'☀️':'🌙';}
(function(){const s=localStorage.getItem('onco_admin_theme')||'light';document.documentElement.setAttribute('data-theme',s);document.addEventListener('DOMContentLoaded',()=>{document.getElementById('theme-btn').textContent=s==='dark'?'☀️':'🌙';});})();

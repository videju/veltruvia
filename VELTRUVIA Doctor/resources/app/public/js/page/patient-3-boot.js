
// ── Global Error Boundary ──
window.onerror=function(msg,src,line,col,err){console.error("[VELTRUVIA Error]",{msg,src,line,col,err});return false;};
window.addEventListener("unhandledrejection",function(e){console.error("[VELTRUVIA Unhandled Promise]",e.reason);});
(function(){
  if(new URLSearchParams(location.search).get('standalone')==='1'){
    document.title='VELTRUVIA Patient';
    window._standaloneMode=true;
    // Hide portal switcher & links in sidebar
    var s=document.getElementById('portal-switcher');
    var l=document.getElementById('portal-links');
    if(s)s.style.display='none';
    if(l)l.style.display='none';
    // Hide Lab login tab and card — patient app is PATIENT ONLY
    var tabs=document.querySelectorAll('.ltab');
    tabs.forEach(function(t){
      if(t.textContent.indexOf('Lab')!==-1||t.textContent.indexOf('lab')!==-1) t.style.display='none';
    });
    var labCard=document.getElementById('login-lab');
    if(labCard) labCard.style.display='none';
    // Make sure Patient tab is active
    var pTab=document.querySelector('.ltab.active');
    if(!pTab){
      var first=document.querySelector('.ltab');
      if(first){first.click();}
    }
    // Also hide any cross-portal links that appear anywhere
    document.querySelectorAll('a[href="/"],a[href="/lab.html"],a[href="/admin.html"]').forEach(function(a){a.style.display='none';});
    // Navigation guard: prevent going to other portals
    window.addEventListener('beforeunload',function(e){
      var dest=(e.target||document).location;
      if(dest && (dest.pathname==='/lab.html'||dest.pathname==='/admin.html'||dest.pathname==='/')){
        e.preventDefault();e.returnValue='';return false;
      }
    });
  }
})();

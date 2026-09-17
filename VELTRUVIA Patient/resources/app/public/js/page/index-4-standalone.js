
(function(){
  if(new URLSearchParams(location.search).get('standalone')==='1'){
    document.title='VELTRUVIA Doctor';
    window._standaloneMode=true;
    // Hide portal switcher section
    var el=document.getElementById('portal-switcher');
    if(el)el.style.display='none';
    // Hide any cross-portal links that appear anywhere in the DOM
    document.querySelectorAll('a[href="/patient.html"],a[href="/lab.html"],a[href="/admin.html"]').forEach(function(a){
      a.style.display='none';a.removeAttribute('href');
    });
    // Watch for dynamically added cross-portal links
    var obs=new MutationObserver(function(mutations){
      mutations.forEach(function(m){
        m.addedNodes.forEach(function(n){
          if(n.nodeType!==1)return;
          if(n.querySelectorAll){
            n.querySelectorAll('a[href="/patient.html"],a[href="/lab.html"],a[href="/admin.html"]').forEach(function(a){a.style.display='none';});
          }
        });
      });
    });
    obs.observe(document.body,{childList:true,subtree:true});
  }
})();

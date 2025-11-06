(function(){
  if (window.__universalNavInjected) return; window.__universalNavInjected = true;
  function h(tag, props, children){
    var el = document.createElement(tag);
    if (props) Object.keys(props).forEach(function(k){
      if (k === 'style') Object.assign(el.style, props.style);
      else if (k === 'text') el.textContent = props.text;
      else el.setAttribute(k, props[k]);
    });
    (children||[]).forEach(function(ch){ if (typeof ch === 'string') el.appendChild(document.createTextNode(ch)); else if (ch) el.appendChild(ch) });
    return el;
  }
  var z = 10000;
  var state = { open: false, mode: 'nav', isAuthed: false };
  var label = (function(){
    try {
      var t = document.title || '';
      if (!t) return 'BA';
      var parts = t.split('•');
      return (parts[0] || t).trim();
    } catch { return 'BA' }
  })();

  var backdrop = h('div', { style: { position:'fixed', inset:'0', background:'rgba(0,0,0,0.35)', opacity:'0', transition:'opacity 200ms ease', pointerEvents:'none', zIndex: String(z) } });
  var leftBtn = h('button', { style: { position:'fixed', top:'calc(env(safe-area-inset-top, 0px) + 8px)', left:'8px', zIndex: String(z+2), background:'transparent', border:'none', padding:'8px', opacity:'0.9', color:'#fff', cursor:'pointer', touchAction:'manipulation' } });
  leftBtn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7 H20 M4 12 H20 M4 17 H20" stroke="#fff" stroke-opacity="0.6" stroke-width="2" stroke-linecap="round"/></svg>';
  var rightBtn = h('button', { style: { position:'fixed', top:'calc(env(safe-area-inset-top, 0px) + 8px)', right:'8px', zIndex: String(z+2), background:'transparent', border:'none', padding:'8px', opacity:'0.9', color:'#fff', cursor:'pointer', touchAction:'manipulation' } });
  rightBtn.innerHTML = '<svg width="28" height="28" viewBox="0 0 24 24" aria-hidden="true"><rect x="4" y="4" width="6" height="6" stroke="#fff" stroke-opacity="0.6" stroke-width="1.8" fill="none"/><rect x="14" y="4" width="6" height="6" stroke="#fff" stroke-opacity="0.6" stroke-width="1.8" fill="none"/><rect x="4" y="14" width="6" height="6" stroke="#fff" stroke-opacity="0.6" stroke-width="1.8" fill="none"/><rect x="14" y="14" width="6" height="6" stroke="#fff" stroke-opacity="0.6" stroke-width="1.8" fill="none"/></svg>';
  var center = h('div', { style: { position:'fixed', top:'calc(env(safe-area-inset-top, 0px) + 10px)', left:'50%', transform:'translateX(-50%)', color:'#fff', zIndex: String(z+1), fontSize:'14px', padding:'6px 12px', borderRadius:'999px', background:'rgba(0,0,0,0.4)', border:'1px solid rgba(255,255,255,0.2)' } }, [label]);
  var panel = h('div', { style: { position:'fixed', top:'0', left:'0', bottom:'0', width:'78vw', maxWidth:'340px', background:'rgba(0,0,0,0.8)', color:'#fff', zIndex: String(z+1), transform:'translate3d(-100%,0,0)', transition:'transform 260ms cubic-bezier(0.25,1,0.5,1)', paddingTop:'calc(env(safe-area-inset-top, 0px) + 56px)', paddingBottom:'calc(env(safe-area-inset-bottom, 0px) + 16px)', paddingLeft:'12px', paddingRight:'12px', boxShadow:'none', pointerEvents:'none', WebkitBackdropFilter:'saturate(120%) blur(6px)', backdropFilter:'saturate(120%) blur(6px)', overflowY:'auto' } });

  function setOpen(next){
    state.open = !!next;
    backdrop.style.opacity = state.open ? '1' : '0';
    backdrop.style.pointerEvents = state.open ? 'auto' : 'none';
    panel.style.transform = state.open ? 'translate3d(0,0,0)' : 'translate3d(-100%,0,0)';
    panel.style.boxShadow = state.open ? '2px 0 12px rgba(0,0,0,0.5)' : 'none';
    panel.style.pointerEvents = state.open ? 'auto' : 'none';
    renderPanel();
  }
  function setMode(mode){ state.mode = mode; setOpen(true) }

  function renderPanel(){
    panel.innerHTML = '';
    if (state.mode === 'nav') {
      var btn = h('a', { href: state.isAuthed ? '/logout' : '/login', style: { display:'inline-block', textDecoration:'none', textAlign:'center', color:'#fff', background: state.isAuthed ? '#d32f2f' : '#2e7d32', padding:'12px 20px', borderRadius:'10px', fontWeight:'600', boxShadow:'0 4px 10px rgba(0,0,0,0.35), inset 0 1px 0 rgba(255,255,255,0.12)', border:'1px solid rgba(255,255,255,0.15)', marginBottom:'14px' } }, [state.isAuthed ? 'LOGOUT' : 'LOGIN']);
      panel.appendChild(btn);
      var links = [ { label:'My Uploads', href:'/uploads' } ];
      links.forEach(function(l){
        var a = h('a', { href:l.href, style:{ color:'#fff', textDecoration:'none', fontSize:'16px', padding:'10px 12px', borderRadius:'8px', border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.04)', display:'block', marginBottom:'10px' } }, [l.label]);
        a.addEventListener('click', function(){ setOpen(false) });
        panel.appendChild(a);
      });
      var upcoming = [ { label:'My Groups', note:'Coming soon' }, { label:'My Channels', note:'Coming soon' }, { label:'My Messages', note:'Coming soon' } ];
      upcoming.forEach(function(u){
        var d = h('div', { style:{ fontSize:'15px', color:'rgba(255,255,255,0.6)', padding:'8px 10px', borderRadius:'8px', border:'1px dashed rgba(255,255,255,0.2)', background:'rgba(255,255,255,0.02)', marginBottom:'10px' } }, [u.label + ' ', h('span', { style:{ marginLeft:'8px', fontSize:'12px', opacity:'0.7' } }, ['(' + u.note + ')'])]);
        panel.appendChild(d);
      });
    } else {
      panel.appendChild(h('div', { style:{ color:'#fff', fontSize:'15px', marginBottom:'10px' } }, ['Space switching is available on the Feed.']));
      var link = h('a', { href:'/', style:{ color:'#9cf', textDecoration:'none', fontSize:'16px', padding:'10px 12px', borderRadius:'8px', border:'1px solid rgba(255,255,255,0.12)', background:'rgba(255,255,255,0.04)', display:'inline-block' } }, ['Go to Feed']);
      link.addEventListener('click', function(){ setOpen(false) });
      panel.appendChild(link);
    }
  }

  leftBtn.addEventListener('click', function(e){ e.stopPropagation(); setMode('nav') });
  rightBtn.addEventListener('click', function(e){ e.stopPropagation(); setMode('spaces') });
  backdrop.addEventListener('click', function(e){ e.stopPropagation(); setOpen(false) });
  document.addEventListener('keydown', function(e){ if (e.key === 'Escape') setOpen(false) });

  function mount(){
    document.body.appendChild(backdrop);
    document.body.appendChild(leftBtn);
    document.body.appendChild(rightBtn);
    document.body.appendChild(center);
    document.body.appendChild(panel);
  }

  function fetchMe(){
    try {
      fetch('/api/me', { credentials:'same-origin' }).then(function(res){ return res.json() }).then(function(me){ state.isAuthed = !!(me && me.userId != null) }).catch(function(){ state.isAuthed = false })
    } catch { state.isAuthed = false }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', function(){ mount(); fetchMe(); }); else { mount(); fetchMe(); }
})();


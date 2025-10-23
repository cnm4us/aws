(function(){
  function parseContext(){
    var p = location.pathname;
    var m = p.match(/^\/(spaces|groups|channels)\/(\d+)\/admin\/users\/(\d+)/);
    if (!m) return { type:'spaces', id:null, userId:null };
    return { type: m[1], id: Number(m[2]), userId: Number(m[3]) };
  }
  function setNav(ctx){
    var base = '/' + ctx.type + '/' + ctx.id;
    var label = ctx.type === 'spaces' ? 'Space' : ctx.type === 'groups' ? 'Group' : 'Channel';
    var title = document.getElementById('navTitle'); if (title) title.textContent = label + ' Admin';
    var s = document.getElementById('navSettings'); if (s) s.href = base + '/admin/settings';
    var m = document.getElementById('navMembers'); if (m) m.href = base + '/admin/members';
    var mod = document.getElementById('navModeration'); if (mod) mod.href = base + '/moderation';
  }
  function csrf(){ const m=document.cookie.match(/(?:^|;\s*)csrf=([^;]+)/); return m?decodeURIComponent(m[1]):null }
  function headers(){ const h={'Content-Type':'application/json'}; const t=csrf(); if(t) h['x-csrf-token']=t; return h }

  var ctx = parseContext(); setNav(ctx);
  var sid = ctx.id, uid = ctx.userId;
  var canModerate = true; // assume allowed; adjust after probing
  var activePostingDegree = 0;
  var activeBan = false;

  async function loadSpaceTitle(){
    try{
      const res = await fetch('/api/spaces/' + sid + '/settings', { credentials:'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      var title = document.getElementById('spaceNameTitle');
      if (title) title.textContent = data && data.name ? data.name : (ctx.type === 'groups' ? 'Group' : ctx.type === 'channels' ? 'Channel' : 'Space');
    }catch(e){ /* ignore */ }
  }

  function setDisabled(sectionId, disabled, noteId){
    var sec = document.getElementById(sectionId);
    if (!sec) return;
    Array.prototype.forEach.call(sec.querySelectorAll('input,select,textarea,button'), function(el){ el.disabled = !!disabled; });
    if (noteId) { var n = document.getElementById(noteId); if (n) n.style.display = disabled ? '' : 'none'; }
  }

  function renderMemberHeader(name, email){
    var t = document.getElementById('memberTitle'); if (t) t.textContent = name ? name : ('User #' + uid);
    var m = document.getElementById('memberMeta'); if (m) m.textContent = email ? email : '';
  }

  async function loadMemberMeta(){
    try{
      const res = await fetch('/api/spaces/' + sid + '/members', { credentials:'same-origin' });
      if (!res.ok) throw new Error('members_failed');
      const data = await res.json();
      const rows = Array.isArray(data.members) ? data.members : [];
      const me = rows.find(function(r){ return Number(r.userId) === uid; });
      if (me) renderMemberHeader(me.displayName || me.email, me.email);
      else renderMemberHeader(null, null);
    }catch(e){ renderMemberHeader(null, null); }
  }

  function renderLog(list){
    const tbody = document.getElementById('logRows');
    if (!Array.isArray(list) || !list.length) { tbody.innerHTML = '<tr><td colspan="6">No suspensions.</td></tr>'; return; }
    tbody.innerHTML = '';
    list.forEach(function(s){
      var tr = document.createElement('tr');
      tr.innerHTML = '<td>'+s.id+'</td><td>'+s.kind+'</td><td>'+(s.degree||'')+'</td><td>'+(s.startsAt||'')+'</td><td>'+(s.endsAt||'')+'</td><td>'+(s.reason||'')+'</td>';
      tbody.appendChild(tr);
    });
  }

  async function loadModerationState(){
    try{
      const res = await fetch('/api/spaces/' + sid + '/suspensions', { credentials:'same-origin' });
      if (res.status === 403) {
        canModerate = false;
        setDisabled('suspensionSection', true, 'permNoteSuspend');
        setDisabled('banSection', true, 'permNoteBan');
        setDisabled('liftSection', true);
        // Still attempt to show log via active=1? It will also 403; just render note.
        document.getElementById('logRows').innerHTML = '<tr><td colspan="6">Insufficient permissions to view suspension log.</td></tr>';
        return;
      }
      if (!res.ok) throw new Error('suspensions_failed');
      const data = await res.json();
      const all = Array.isArray(data.suspensions) ? data.suspensions : [];
      const mine = all.filter(function(s){ return Number(s.userId) === uid; });
      renderLog(mine);
      // active state
      activePostingDegree = 0; activeBan = false;
      mine.forEach(function(s){
        var isActive = (!s.startsAt || Date.parse(s.startsAt) <= Date.now()) && (!s.endsAt || Date.parse(s.endsAt) >= Date.now());
        if (!isActive) return;
        if (String(s.kind)==='posting') activePostingDegree = Number(s.degree||0) || 1;
        if (String(s.kind)==='ban') activeBan = true;
      });
      // Apply radio
      document.querySelectorAll('input[name="suspDegree"]').forEach(function(r){ r.checked = (Number(r.value) === activePostingDegree); });
      // Ban buttons
      document.getElementById('liftBan').disabled = !activeBan || !canModerate;
    } catch(e){ /* ignore */ }
  }

  async function issueSusp(){
    const dEl = document.querySelector('input[name="suspDegree"]:checked');
    const degree = dEl ? Number(dEl.value) : 1;
    const reason = (document.getElementById('suspReason').value||'').trim();
    const st = document.getElementById('suspStatus');
    try{
      // Lift any active posting suspensions first
      const listRes = await fetch('/api/spaces/' + sid + '/suspensions?active=1', { credentials:'same-origin' });
      if (listRes.ok) {
        const j = await listRes.json();
        const mine = (j.suspensions||[]).filter(function(s){ return Number(s.userId)===uid && String(s.kind)==='posting'; });
        for (var i=0;i<mine.length;i++){
          await fetch('/api/spaces/' + sid + '/suspensions/' + mine[i].id, { method:'DELETE', headers: headers(), credentials:'same-origin' });
        }
      }
      const payload = { userId: uid, kind:'posting', degree: degree, reason: reason || null };
      const res = await fetch('/api/spaces/' + sid + '/suspensions', { method:'POST', headers: headers(), credentials:'same-origin', body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Failed to issue suspension');
      st.textContent = 'Issued'; st.className='status ok';
      await loadModerationState();
    } catch(e){ st.textContent = e && e.message ? e.message : 'Failed'; st.className='status error'; }
  }

  async function liftSusp(){
    const st = document.getElementById('liftStatus');
    try{
      const listRes = await fetch('/api/spaces/' + sid + '/suspensions?active=1', { credentials:'same-origin' });
      if (!listRes.ok) throw new Error('Failed to load active suspensions');
      const j = await listRes.json();
      const mine = (j.suspensions||[]).filter(function(s){ return Number(s.userId)===uid && String(s.kind)==='posting'; });
      if (!mine.length) { st.textContent='No active posting suspension'; st.className='status'; return; }
      for (var i=0;i<mine.length;i++){
        const delRes = await fetch('/api/spaces/' + sid + '/suspensions/' + mine[i].id, { method:'DELETE', headers: headers(), credentials:'same-origin' });
        if (!delRes.ok) throw new Error('Failed to lift');
      }
      st.textContent = 'Lifted'; st.className='status ok';
      await loadModerationState();
    } catch(e){ st.textContent = e && e.message ? e.message : 'Failed'; st.className='status error'; }
  }

  async function banUser(){
    const st = document.getElementById('banStatus');
    const reason = (document.getElementById('banReason').value||'').trim();
    try{
      const payload = { userId: uid, kind:'ban', reason: reason || null };
      const res = await fetch('/api/spaces/' + sid + '/suspensions', { method:'POST', headers: headers(), credentials:'same-origin', body: JSON.stringify(payload) });
      if (!res.ok) throw new Error('Failed to ban');
      st.textContent='Banned'; st.className='status ok';
      await loadModerationState();
    } catch(e){ st.textContent = e && e.message ? e.message : 'Failed'; st.className='status error'; }
  }

  async function liftBan(){
    const st = document.getElementById('banStatus');
    try{
      const listRes = await fetch('/api/spaces/' + sid + '/suspensions?active=1', { credentials:'same-origin' });
      if (!listRes.ok) throw new Error('Failed to load active suspensions');
      const j = await listRes.json();
      const mine = (j.suspensions||[]).filter(function(s){ return Number(s.userId)===uid && String(s.kind)==='ban'; });
      if (!mine.length) { st.textContent='No active ban'; st.className='status'; return; }
      for (var i=0;i<mine.length;i++){
        const delRes = await fetch('/api/spaces/' + sid + '/suspensions/' + mine[i].id, { method:'DELETE', headers: headers(), credentials:'same-origin' });
        if (!delRes.ok) throw new Error('Failed to lift ban');
      }
      st.textContent='Lifted ban'; st.className='status ok';
      await loadModerationState();
    } catch(e){ st.textContent = e && e.message ? e.message : 'Failed'; st.className='status error'; }
  }

  function bind(){
    document.getElementById('issueSusp').addEventListener('click', issueSusp);
    document.getElementById('liftSusp').addEventListener('click', liftSusp);
    document.getElementById('banUser').addEventListener('click', banUser);
    document.getElementById('liftBan').addEventListener('click', liftBan);
  }

  (async function init(){
    if (!sid || !uid) return;
    bind();
    await loadSpaceTitle();
    await loadMemberMeta();
    await loadModerationState();
  })();
})();

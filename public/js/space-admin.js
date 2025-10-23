(function() {
  function parseContext() {
    var p = location.pathname;
    var m = p.match(/^\/(spaces|groups|channels)\/(\d+)\/(admin|moderation)/);
    if (!m) return { type: 'spaces', id: null };
    return { type: m[1], id: Number(m[2]) };
  }
  var ctx = parseContext();
  var sid = ctx.id;
  var label = document.getElementById('spaceLabel');
  if (label && sid) label.textContent = '(space #' + sid + ')';
  var link = document.getElementById('modLink');
  if (link && sid) link.href = '/spaces/' + sid + '/moderation';

  async function fetchJson(url) {
    const r = await fetch(url, { credentials: 'include' });
    if (!r.ok) throw new Error('fetch_failed');
    return r.json();
  }

  function renderMembers(data, suspIndex) {
    const body = document.getElementById('membersBody');
    const items = (data && Array.isArray(data.members)) ? data.members : [];
    if (!items.length) { body.innerHTML = '<tr><td colspan="3" class="muted">No members.</td></tr>'; return; }
    body.innerHTML = '';
    items.forEach(function(m){
      const name = m.displayName || m.email || ('User #' + m.userId);
      const roles = (Array.isArray(m.roles) ? m.roles : []).join(', ');
      const s = suspIndex[m.userId] || {};
      const badges = [];
      if (s.ban) badges.push('<span class="badge ban">Banned</span>');
      if (s.posting) badges.push('<span class="badge susp">Suspended</span>');
      const html = [
        '<td>' + name + (badges.length? (' ' + badges.join(' ')) : '') + '</td>',
        '<td>' + roles + '</td>',
        '<td>'
          + '<button class="btn" data-action="suspend" data-user="' + m.userId + '" data-kind="posting" data-degree="1" data-state="' + ((s.postingByDegree && s.postingByDegree[1])?'active':'inactive') + '">Suspend 1d</button> '
          + '<button class="btn" data-action="suspend" data-user="' + m.userId + '" data-kind="posting" data-degree="2" data-state="' + ((s.postingByDegree && s.postingByDegree[2])?'active':'inactive') + '">Suspend 7d</button> '
          + '<button class="btn" data-action="suspend" data-user="' + m.userId + '" data-kind="posting" data-degree="3" data-state="' + ((s.postingByDegree && s.postingByDegree[3])?'active':'inactive') + '">Suspend 30d</button> '
          + '<button class="btn" data-action="ban" data-user="' + m.userId + '" data-kind="ban" data-state="' + (s.ban?'active':'inactive') + '">Ban</button> '
          + (s.posting ? '<button class="btn" data-action="lift" data-user="' + m.userId + '" data-kind="posting" data-state="active">Lift Suspension</button> ' : '')
          + (s.ban ? '<button class="btn" data-action="unban" data-user="' + m.userId + '" data-kind="ban" data-state="active">Unban</button>' : '')
        + '</td>'
      ].join('');
      var tr = document.createElement('tr');
      tr.innerHTML = html;
      body.appendChild(tr);
    });
  }

  function renderSubscribers(data, suspIndex) {
    const body = document.getElementById('subsBody');
    const items = (data && Array.isArray(data.subscribers)) ? data.subscribers : [];
    if (!items.length) { body.innerHTML = '<tr><td colspan="4" class="muted">No subscribers.</td></tr>'; return; }
    body.innerHTML = '';
    items.forEach(function(s){
      const name = s.displayName || s.email || ('User #' + s.userId);
      const su = suspIndex[s.userId] || {};
      const badges = [];
      if (su.ban) badges.push('<span class="badge ban">Banned</span>');
      if (su.posting) badges.push('<span class="badge susp">Suspended</span>');
      const html = [
        '<td>' + name + (badges.length? (' ' + badges.join(' ')) : '') + '</td>',
        '<td>' + (s.tier || '-') + '</td>',
        '<td>' + s.status + '</td>',
        '<td>'
          + '<button class="btn" data-action="suspend" data-user="' + s.userId + '" data-kind="posting" data-degree="1" data-state="' + ((su.postingByDegree && su.postingByDegree[1])?'active':'inactive') + '">Suspend 1d</button> '
          + '<button class="btn" data-action="suspend" data-user="' + s.userId + '" data-kind="posting" data-degree="2" data-state="' + ((su.postingByDegree && su.postingByDegree[2])?'active':'inactive') + '">Suspend 7d</button> '
          + '<button class="btn" data-action="suspend" data-user="' + s.userId + '" data-kind="posting" data-degree="3" data-state="' + ((su.postingByDegree && su.postingByDegree[3])?'active':'inactive') + '">Suspend 30d</button> '
          + '<button class="btn" data-action="ban" data-user="' + s.userId + '" data-kind="ban" data-state="' + (su.ban?'active':'inactive') + '">Ban</button> '
          + (su.posting ? '<button class="btn" data-action="lift" data-user="' + s.userId + '" data-kind="posting" data-state="active">Lift Suspension</button> ' : '')
          + (su.ban ? '<button class="btn" data-action="unban" data-user="' + s.userId + '" data-kind="ban" data-state="active">Unban</button>' : '')
        + '</td>'
      ].join('');
      var tr = document.createElement('tr');
      tr.innerHTML = html;
      body.appendChild(tr);
    });
  }

  function getCsrf() { var m = document.cookie.match(/(?:^|;)\s*csrf=([^;]+)/); return m ? decodeURIComponent(m[1]) : null; }
  async function api(method, url, body) {
    var headers = { 'Content-Type':'application/json' };
    var csrf = getCsrf(); if (csrf) headers['x-csrf-token'] = csrf;
    var res = await fetch(url, { method, credentials:'include', headers, body: body?JSON.stringify(body):undefined });
    if (!res.ok) throw new Error('request_failed');
    return res.json().catch(()=>({ ok:true }));
  }
  function setGroupPending(userId, kind, degreeBtn) {
    var sel = kind==='posting' ? '[data-action="suspend"][data-kind="posting"][data-user="'+userId+'"]' : '[data-action="ban"][data-kind="ban"][data-user="'+userId+'"]';
    document.querySelectorAll(sel).forEach(function(b){ b.setAttribute('disabled','true'); if (degreeBtn===b) b.setAttribute('data-state','pending'); });
  }
  function clearGroupPending(userId, kind) {
    var sel = kind==='posting' ? '[data-action="suspend"][data-kind="posting"][data-user="'+userId+'"]' : '[data-action="ban"][data-kind="ban"][data-user="'+userId+'"]';
    document.querySelectorAll(sel).forEach(function(b){ b.removeAttribute('disabled'); if (b.getAttribute('data-state')==='pending') b.setAttribute('data-state','inactive'); });
  }
  function applyPostingState(userId, activeDegree) {
    ['1','2','3'].forEach(function(d){ var btn = document.querySelector('[data-action="suspend"][data-kind="posting"][data-user="'+userId+'"][data-degree="'+d+'"]'); if (btn) btn.setAttribute('data-state', d===String(activeDegree)? 'active':'inactive'); });
    var lift = document.querySelector('[data-action="lift"][data-kind="posting"][data-user="'+userId+'"]');
    if (lift) { if (activeDegree) lift.removeAttribute('hidden'); else lift.setAttribute('hidden','true'); }
    else if (activeDegree) {
      var row = document.querySelector('[data-action="suspend"][data-user="'+userId+'"]');
      if (row) { var td = row.closest('td'); if (td) { var b = document.createElement('button'); b.className='btn'; b.dataset.action='lift'; b.dataset.user=String(userId); b.dataset.kind='posting'; b.dataset.state='active'; b.textContent='Lift Suspension'; td.appendChild(document.createTextNode(' ')); td.appendChild(b); } }
    }
  }
  function applyBanState(userId, banned) {
    var ban = document.querySelector('[data-action="ban"][data-kind="ban"][data-user="'+userId+'"]'); if (ban) ban.setAttribute('data-state', banned? 'active':'inactive');
    var unban = document.querySelector('[data-action="unban"][data-kind="ban"][data-user="'+userId+'"]');
    if (unban) { if (banned) unban.removeAttribute('hidden'); else unban.setAttribute('hidden','true'); }
    else if (banned && ban) { var td = ban.closest('td'); if (td) { var b = document.createElement('button'); b.className='btn'; b.dataset.action='unban'; b.dataset.user=String(userId); b.dataset.kind='ban'; b.dataset.state='active'; b.textContent='Unban'; td.appendChild(document.createTextNode(' ')); td.appendChild(b); } }
  }

  async function handleClick(e) {
    var t = e.target; if (!(t instanceof HTMLElement)) return;
    var act = t.dataset.action; if (!act) return;
    var userId = Number(t.dataset.user||0); var kind = t.dataset.kind||'';
    if (!userId || !kind) return;
    try {
      if (act==='suspend') {
        var degree = Number(t.dataset.degree||0);
        setGroupPending(userId, 'posting', t);
        var active = await fetchJson('/api/spaces/'+sid+'/suspensions?active=1');
        var ids = (active.suspensions||[]).filter(function(x){ return Number(x.userId)===userId && String(x.kind)==='posting'; }).map(function(x){ return Number(x.id); });
        for (var i=0;i<ids.length;i++) { await api('DELETE','/api/spaces/'+sid+'/suspensions/'+ids[i]); }
        await api('POST','/api/spaces/'+sid+'/suspensions',{ userId, kind:'posting', degree });
        applyPostingState(userId, degree);
        clearGroupPending(userId, 'posting');
      } else if (act==='lift') {
        setGroupPending(userId, 'posting');
        var active2 = await fetchJson('/api/spaces/'+sid+'/suspensions?active=1');
        var ids2 = (active2.suspensions||[]).filter(function(x){ return Number(x.userId)===userId && String(x.kind)==='posting'; }).map(function(x){ return Number(x.id); });
        for (var j=0;j<ids2.length;j++) { await api('DELETE','/api/spaces/'+sid+'/suspensions/'+ids2[j]); }
        applyPostingState(userId, 0);
        clearGroupPending(userId, 'posting');
      } else if (act==='ban') {
        setGroupPending(userId, 'ban', t);
        await api('POST','/api/spaces/'+sid+'/suspensions',{ userId, kind:'ban' });
        applyBanState(userId, true);
        clearGroupPending(userId, 'ban');
      } else if (act==='unban') {
        setGroupPending(userId, 'ban', t);
        var active3 = await fetchJson('/api/spaces/'+sid+'/suspensions?active=1');
        var ids3 = (active3.suspensions||[]).filter(function(x){ return Number(x.userId)===userId && String(x.kind)==='ban'; }).map(function(x){ return Number(x.id); });
        for (var k=0;k<ids3.length;k++) { await api('DELETE','/api/spaces/'+sid+'/suspensions/'+ids3[k]); }
        applyBanState(userId, false);
        clearGroupPending(userId, 'ban');
      }
    } catch (err) {
      alert('Action failed');
      clearGroupPending(userId, kind);
    }
  }

  document.addEventListener('click', handleClick);

  async function init() {
    try {
      const [m, s, su] = await Promise.all([
        fetchJson('/api/spaces/' + sid + '/members'),
        fetchJson('/api/spaces/' + sid + '/subscribers'),
        fetchJson('/api/spaces/' + sid + '/suspensions?active=1')
      ]);
      const suspIndex = {};
      if (su && Array.isArray(su.suspensions)) {
        su.suspensions.forEach(function(x){
          var u = Number(x.userId);
          if (!suspIndex[u]) suspIndex[u] = { ban:false, posting:false, postingByDegree:{} };
          if (String(x.kind) === 'ban') suspIndex[u].ban = true;
          if (String(x.kind) === 'posting') {
            suspIndex[u].posting = true;
            var d = Number(x.degree || 0);
            if (d === 1 || d === 2 || d === 3) suspIndex[u].postingByDegree[d] = true;
          }
        });
      }
      renderMembers(m, suspIndex);
      renderSubscribers(s, suspIndex);
    } catch (err) {
      document.getElementById('membersBody').innerHTML = '<tr><td colspan="3">Failed to load.</td></tr>';
      document.getElementById('subsBody').innerHTML = '<tr><td colspan="4">Failed to load.</td></tr>';
    }
  }
  if (sid) init();
})();


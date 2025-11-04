(function(){
  function parseContext(){
    var p = location.pathname;
    var m = p.match(/^\/(spaces|groups|channels)\/(\d+)\/(?:admin(?:\/members)?)?/);
    if (!m) return { type:'spaces', id:null };
    return { type: m[1], id: Number(m[2]) };
  }
  var ctx = parseContext();
  var sid = ctx.id;

  function setNav(){
    var base = '/' + ctx.type + '/' + sid;
    var label = ctx.type === 'spaces' ? 'Space' : ctx.type === 'groups' ? 'Group' : 'Channel';
    var title = document.getElementById('navTitle'); if (title) title.textContent = label + ' Admin';
    var s = document.getElementById('navSettings'); if (s) s.href = base + '/admin/settings';
    var m = document.getElementById('navMembers'); if (m) m.href = base + '/admin/members';
    var mod = document.getElementById('navModeration'); if (mod) mod.href = base + '/moderation';
  }

  async function loadSpaceTitle(){
    try{
      const res = await fetch('/api/spaces/' + sid + '/settings', { credentials:'same-origin' });
      if (!res.ok) return;
      const data = await res.json();
      var title = document.getElementById('spaceNameTitle');
      if (title) title.textContent = data && data.name ? data.name : (ctx.type === 'groups' ? 'Group' : ctx.type === 'channels' ? 'Channel' : 'Space');
    } catch(e){ /* ignore */ }
  }

  async function load(){
    const tbody = document.getElementById('rows');
    const status = document.getElementById('status');
    if (!sid) { tbody.innerHTML = '<tr><td colspan="3">Bad space id</td></tr>'; return; }
    try{
      const res = await fetch('/api/spaces/' + sid + '/members', { credentials:'same-origin' });
      if (!res.ok) throw new Error('failed');
      const data = await res.json();
      const items = Array.isArray(data.members) ? data.members : [];
      if (!items.length) { tbody.innerHTML = '<tr><td colspan="3">No members.</td></tr>'; return; }
      tbody.innerHTML = '';
      items.forEach(function(u){
        var tr = document.createElement('tr');
        var name = u.displayName || u.email || ('User #' + u.userId);
        var link = '/' + ctx.type + '/' + sid + '/admin/users/' + u.userId;
        var allowed = ['space_admin','space_moderator','space_member','space_subscriber'];
        var roles = Array.isArray(u.roles) ? u.roles.filter(function(r){ return allowed.indexOf(String(r)) !== -1; }) : [];
        tr.innerHTML = '<td>'+u.userId+'</td><td><a href="'+link+'">'+name+'</a></td><td>'+(u.email||'')+'</td><td>'+(roles.join(', ')||'')+'</td>';
        tbody.appendChild(tr);
      });
    } catch(e){
      status.textContent = 'Failed to load members'; status.className='status error';
    }
  }

  (function init(){
    setNav();
    if (sid) { loadSpaceTitle(); load(); }
  })();
})();


### 2025-12-28T21:55:00+00:00


### 2025-12-28T21:28:42+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review/personal`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review • Personal</title>
    <link rel="stylesheet" href="/admin-nav.css" />
  </head>
  <body class="admin-shell">
    <input id="adminNavToggle" class="admin-nav-toggle" type="checkbox" aria-hidden="true" />
    <aside class="sidebar" aria-label="Admin navigation">
      <div class="sidebar-header">
        <div class="sidebar-title">Site Admin</div>
        <label for="adminNavToggle" class="sidebar-close">Close</label>
      </div>
      <nav class="sidebar-nav">
        <a href="/admin/groups" class="">Groups</a><a href="/admin/channels" class="">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="">Pages</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">Review • Personal</div>
      </div>
      <main class="content">
<h1>Personal Spaces</h1><div class="toolbar"><div><span class="pill">Review List</span></div><div><a href="/admin/review">All queues</a></div></div><form method="GET" action="/admin/review/personal" class="section" style="margin:12px 0"><div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end"><label style="display:flex; flex-direction:column; gap:6px; min-width:260px; flex: 1 1 260px"><span style="font-size:12px; opacity:.85">Search</span><input name="q" value="" placeholder="Space name, slug, or owner email" /></label><input type="hidden" name="limit" value="50" /><button type="submit">Search</button></div></form><table><thead><tr><th>Space</th><th>Owner</th><th>Pending</th></tr></thead><tbody><tr><td><a href="/admin/review/personal/20">Tester 02</a><div style="opacity:.7; font-size:.9rem">tester-02 <span style="opacity:.7">#20</span></div></td><td>Tester 02 <span style="opacity:.8">(tester_02@cnm4us.com)</span></td><td>0</td></tr><tr><td><a href="/admin/review/personal/15">Dr. Smith</a><div style="opacity:.7; font-size:.9rem">dr-smith <span style="opacity:.7">#15</span></div></td><td>Dr. Smith <span style="opacity:.8">(tester_01@cnm4us.com)</span></td><td>0</td></tr><tr><td><a href="/admin/review/personal/1">Admin</a><div style="opacity:.7; font-size:.9rem">admin <span style="opacity:.7">#1</span></div></td><td>Admin <span style="opacity:.8">(michael@bayareacreativeservices.com)</span></td><td>0</td></tr></tbody></table>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T21:28:42+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review/personal/20`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review • Personal Space</title>
    <link rel="stylesheet" href="/admin-nav.css" />
  </head>
  <body class="admin-shell">
    <input id="adminNavToggle" class="admin-nav-toggle" type="checkbox" aria-hidden="true" />
    <aside class="sidebar" aria-label="Admin navigation">
      <div class="sidebar-header">
        <div class="sidebar-title">Site Admin</div>
        <label for="adminNavToggle" class="sidebar-close">Close</label>
      </div>
      <nav class="sidebar-nav">
        <a href="/admin/groups" class="">Groups</a><a href="/admin/channels" class="">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="">Pages</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">Review • Personal Space</div>
      </div>
      <main class="content">
<h1>Tester 02</h1><div class="toolbar"><div><span class="pill">Review Queue</span></div><div><a href="/admin/review/personal">Back to personal spaces</a></div></div><div class="section"><div class="section-title">Space</div><div>Tester 02 <span style="opacity:.7">#20</span></div><div style="margin-top:6px"><span style="opacity:.8">Owner:</span> Tester 02 <span style="opacity:.8">(tester_02@cnm4us.com)</span></div></div><p>No pending videos.</p>
      </main>
    </div>
  </body>
</html>
```

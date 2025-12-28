
### 2025-12-28T22:10:00+00:00


### 2025-12-28T21:31:40+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review/groups`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review • Groups</title>
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
        <div class="topbar-title">Review • Groups</div>
      </div>
      <main class="content">
<h1>Groups</h1><div class="toolbar"><div><span class="pill">Review List</span></div><div><a href="/admin/review">All queues</a></div></div><form method="GET" action="/admin/review/groups" class="section" style="margin:12px 0"><div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end"><label style="display:flex; flex-direction:column; gap:6px; min-width:260px; flex: 1 1 260px"><span style="font-size:12px; opacity:.85">Search</span><input name="q" value="" placeholder="Group name or slug" /></label><input type="hidden" name="limit" value="50" /><button type="submit">Search</button></div></form><table><thead><tr><th>Group</th><th>Pending</th></tr></thead><tbody><tr><td><a href="/admin/review/groups/28">maybe</a><div style="opacity:.7; font-size:.9rem">maybe <span style="opacity:.7">#28</span></div></td><td>0</td></tr><tr><td><a href="/admin/review/groups/16">Test Group</a><div style="opacity:.7; font-size:.9rem">test-group <span style="opacity:.7">#16</span></div></td><td>0</td></tr><tr><td><a href="/admin/review/groups/18">Test Group 2</a><div style="opacity:.7; font-size:.9rem">test-group-2 <span style="opacity:.7">#18</span></div></td><td>0</td></tr><tr><td><a href="/admin/review/groups/21">Test Group 3</a><div style="opacity:.7; font-size:.9rem">test-group-3 <span style="opacity:.7">#21</span></div></td><td>0</td></tr></tbody></table>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T21:31:40+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review/channels`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review • Channels</title>
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
        <div class="topbar-title">Review • Channels</div>
      </div>
      <main class="content">
<h1>Channels</h1><div class="toolbar"><div><span class="pill">Review List</span></div><div><a href="/admin/review">All queues</a></div></div><form method="GET" action="/admin/review/channels" class="section" style="margin:12px 0"><div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end"><label style="display:flex; flex-direction:column; gap:6px; min-width:260px; flex: 1 1 260px"><span style="font-size:12px; opacity:.85">Search</span><input name="q" value="" placeholder="Channel name or slug" /></label><input type="hidden" name="limit" value="50" /><button type="submit">Search</button></div></form><table><thead><tr><th>Channel</th><th>Pending</th></tr></thead><tbody><tr><td><a href="/admin/review/channels/29">Global Feed</a><div style="opacity:.7; font-size:.9rem">global-feed <span style="opacity:.7">#29</span></div></td><td>0</td></tr><tr><td><a href="/admin/review/channels/17">Test Channel</a><div style="opacity:.7; font-size:.9rem">test-channel <span style="opacity:.7">#17</span></div></td><td>0</td></tr><tr><td><a href="/admin/review/channels/19">Test Channel 2</a><div style="opacity:.7; font-size:.9rem">test-channel-2 <span style="opacity:.7">#19</span></div></td><td>0</td></tr></tbody></table>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T21:34:31+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review/channels` (after excluding global/global-feed)
- Status: `200`
```
<!doctype html>
... (omitted)
... <tbody><tr><td><a href="/admin/review/channels/17">Test Channel</a> ...
```

### 2025-12-28T21:31:40+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review/groups/28`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review • Group: maybe</title>
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
        <div class="topbar-title">Review • Group: maybe</div>
      </div>
      <main class="content">
<h1>maybe</h1><div class="toolbar"><div><span class="pill">Review Queue</span></div><div><a href="/admin/review/groups">Back</a></div></div><div class="section"><div class="section-title">Group</div><div>maybe <span style="opacity:.7">#28</span></div></div><p>No pending videos.</p>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T21:31:40+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review/channels/29`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review • Channel: Global Feed</title>
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
        <div class="topbar-title">Review • Channel: Global Feed</div>
      </div>
      <main class="content">
<h1>Global Feed</h1><div class="toolbar"><div><span class="pill">Review Queue</span></div><div><a href="/admin/review/channels">Back</a></div></div><div class="section"><div class="section-title">Channel</div><div>Global Feed <span style="opacity:.7">#29</span></div></div><p>No pending videos.</p>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T21:32:07+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review/channels`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review • Channels</title>
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
        <div class="topbar-title">Review • Channels</div>
      </div>
      <main class="content">
<h1>Channels</h1><div class="toolbar"><div><span class="pill">Review List</span></div><div><a href="/admin/review">All queues</a></div></div><form method="GET" action="/admin/review/channels" class="section" style="margin:12px 0"><div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end"><label style="display:flex; flex-direction:column; gap:6px; min-width:260px; flex: 1 1 260px"><span style="font-size:12px; opacity:.85">Search</span><input name="q" value="" placeholder="Channel name or slug" /></label><input type="hidden" name="limit" value="50" /><button type="submit">Search</button></div></form><table><thead><tr><th>Channel</th><th>Pending</th></tr></thead><tbody><tr><td><a href="/admin/review/channels/17">Test Channel</a><div style="opacity:.7; font-size:.9rem">test-channel <span style="opacity:.7">#17</span></div></td><td>0</td></tr><tr><td><a href="/admin/review/channels/19">Test Channel 2</a><div style="opacity:.7; font-size:.9rem">test-channel-2 <span style="opacity:.7">#19</span></div></td><td>0</td></tr></tbody></table>
      </main>
    </div>
  </body>
</html>
```

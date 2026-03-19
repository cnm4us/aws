
### 2025-12-28T21:40:00+00:00


### 2025-12-28T21:25:29+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review</title>
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
        <div class="topbar-title">Review</div>
      </div>
      <main class="content">
<h1>Review</h1><div class="toolbar"><div><span class="pill">Review</span></div><div></div></div><div class="section"><div class="section-title">Queues</div><div style="display:grid; grid-template-columns: repeat(auto-fit, minmax(220px, 1fr)); gap: 12px"><div class="section" style="margin:0"><div class="section-title">Global Feed</div><div style="opacity:.85; margin-bottom:10px">Global Feed</div><a class="btn" href="/admin/review/global">Open Queue</a></div><div class="section" style="margin:0"><div class="section-title">Personal Spaces</div><div style="opacity:.85; margin-bottom:10px">Coming next (Plan 16 Step 7)</div><a class="btn" href="/admin/review/personal">Open List</a></div><div class="section" style="margin:0"><div class="section-title">Groups</div><div style="opacity:.85; margin-bottom:10px">Coming next (Plan 16 Step 8)</div><a class="btn" href="/admin/review/groups">Open List</a></div><div class="section" style="margin:0"><div class="section-title">Channels</div><div style="opacity:.85; margin-bottom:10px">Coming next (Plan 16 Step 8)</div><a class="btn" href="/admin/review/channels">Open List</a></div></div></div>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T21:25:29+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/review/global`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Review • Global Feed</title>
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
        <div class="topbar-title">Review • Global Feed</div>
      </div>
      <main class="content">
<h1>Global Feed</h1><div class="toolbar"><div><span class="pill">Review Queue</span></div><div><a href="/admin/review">All queues</a></div></div><div class="section"><div class="section-title">Space</div><div>Global Feed <span style="opacity:.7">#29</span></div></div><p>No pending videos.</p>
      </main>
    </div>
  </body>
</html>
```

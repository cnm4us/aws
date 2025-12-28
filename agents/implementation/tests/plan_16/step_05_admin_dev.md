
### 2025-12-28T21:24:00+00:00


### 2025-12-28T21:18:07+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/dev`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Dev</title>
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
        <div class="topbar-title">Dev</div>
      </div>
      <main class="content">
<h1>Dev</h1><div class="toolbar"><div><span class="pill">Dev</span></div><div></div></div><div class="section"><div class="section-title">Stats</div><table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody><tr><td>Uploads</td><td>45</td></tr><tr><td>Productions</td><td>57</td></tr><tr><td>Space Publications</td><td>144</td></tr><tr><td>Publication Events</td><td>214</td></tr></tbody></table></div><div class="section"><div class="section-title">Danger Zone</div><p class="field-hint">Truncate deletes content tables (uploads, productions, publications). Use only in local/dev.</p><form method="POST" action="/admin/dev/truncate"><input type="hidden" name="csrf" value="<redacted>" /><label>Confirmation<input type="text" name="confirm" value="" placeholder="Type TRUNCATE to confirm" /></label><div class="actions"><button class="danger" type="submit">Truncate Content</button></div></form></div>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T21:18:14+00:00
- Profile: `super`
- Request: `POST http://localhost:3300/admin/dev/truncate (confirm=NOPE)`
- Status: `302`

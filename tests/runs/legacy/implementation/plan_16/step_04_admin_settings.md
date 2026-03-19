
### 2025-12-28T21:18:00+00:00


### 2025-12-28T21:11:35+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/settings`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Settings</title>
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
        <div class="topbar-title">Settings</div>
      </div>
      <main class="content">
<h1>Settings</h1><div class="section"><div class="section-title">Coming Soon</div><p>This admin page is not implemented yet.</p><p class="field-hint">We are keeping site_admin tooling out of the user SPA bundle; settings will return here when we decide what is still used and what should be editable.</p></div>
      </main>
    </div>
  </body>
</html>
```

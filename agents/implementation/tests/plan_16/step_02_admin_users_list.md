
### 2025-12-28T20:13:00+00:00


### 2025-12-28T20:49:55+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/users`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Users</title>
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
        <div class="topbar-title">Users</div>
      </div>
      <main class="content">
<h1>Users</h1><div class="toolbar"><div><span class="pill">Users</span></div><div><a href="/admin/users/new">New user</a></div></div><form method="GET" action="/admin/users" class="section" style="margin:12px 0"><div style="display:flex; gap:10px; flex-wrap:wrap; align-items:flex-end"><label style="display:flex; flex-direction:column; gap:6px; min-width:260px; flex: 1 1 260px"><span style="font-size:12px; opacity:.85">Search</span><input name="q" value="" placeholder="Email or display name" /></label><label style="display:flex; gap:8px; align-items:center; padding:6px 0"><input type="checkbox" name="includeDeleted" value="1"  /><span>Include deleted</span></label><input type="hidden" name="limit" value="50" /><button type="submit">Search</button></div></form><table><thead><tr><th>ID</th><th>Email</th><th>Display Name</th><th>Site Roles</th><th>Created</th><th>Deleted</th></tr></thead><tbody><tr><td>6</td><td><a href="/admin/users/6">tester_02@cnm4us.com</a></td><td>Tester 02</td><td></td><td>2025-10-23 05:22:22</td><td></td></tr><tr><td>5</td><td><a href="/admin/users/5">tester_01@cnm4us.com</a></td><td>Dr. Smith</td><td></td><td>2025-10-22 04:55:00</td><td></td></tr><tr><td>1</td><td><a href="/admin/users/1">michael@bayareacreativeservices.com</a></td><td>Admin</td><td>site_admin</td><td>2025-10-16 16:26:34</td><td></td></tr></tbody></table>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T20:49:56+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/admin/users`
- Status: `302`
```
Found. Redirecting to /forbidden?from=%2Fadmin%2Fusers
```

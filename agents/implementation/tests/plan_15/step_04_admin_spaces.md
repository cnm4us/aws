
### 2025-12-28T17:49:00+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/groups`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Groups</title>
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
        <a href="/admin/groups" class="active">Groups</a><a href="/admin/channels" class="">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="">Pages</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">Groups</div>
      </div>
      <main class="content">
<h1>Groups</h1><div class="toolbar"><div><span class="pill">Groups</span></div><div><a href="/admin/groups/new">New group</a></div></div><table><thead><tr><th>Name</th><th>Slug</th><th>Review</th><th>Cultures</th><th>Owner</th></tr></thead><tbody><tr><td><a href="/admin/groups/28">maybe</a></td><td>maybe</td><td>No</td><td>1</td><td>Admin</td></tr><tr><td><a href="/admin/groups/16">Test Group</a></td><td>test-group</td><td>No</td><td>0</td><td>Admin</td></tr><tr><td><a href="/admin/groups/18">Test Group 2</a></td><td>test-group-2</td><td>No</td><td>1</td><td>Admin</td></tr><tr><td><a href="/admin/groups/21">Test Group 3</a></td><td>test-group-3</td><td>No</td><td>0</td><td>Admin</td></tr></tbody></table>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T17:49:00+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/channels`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Channels</title>
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
        <a href="/admin/groups" class="">Groups</a><a href="/admin/channels" class="active">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="">Pages</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">Channels</div>
      </div>
      <main class="content">
<h1>Channels</h1><div class="toolbar"><div><span class="pill">Channels</span></div><div><a href="/admin/channels/new">New channel</a></div></div><table><thead><tr><th>Name</th><th>Slug</th><th>Review</th><th>Cultures</th><th>Owner</th></tr></thead><tbody><tr><td><a href="/admin/channels/29">Global Feed</a></td><td>global-feed</td><td>No</td><td>1</td><td>Admin</td></tr><tr><td><a href="/admin/channels/17">Test Channel</a></td><td>test-channel</td><td>Yes</td><td>0</td><td>Admin</td></tr><tr><td><a href="/admin/channels/19">Test Channel 2</a></td><td>test-channel-2</td><td>Yes</td><td>0</td><td>Admin</td></tr></tbody></table>
      </main>
    </div>
  </body>
</html>
```

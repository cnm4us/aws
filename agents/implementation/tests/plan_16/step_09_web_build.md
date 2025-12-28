
### 2025-12-28T22:20:00+00:00


### 2025-12-28T21:39:44+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/users/new`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>New User</title>
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
        <div class="topbar-title">New User</div>
      </div>
      <main class="content">
<h1>New User</h1><div class="section"><div class="section-title">Coming Soon</div><p>User creation will move here once we migrate the admin UI fully off the SPA bundle.</p><div class="actions"><a class="btn" href="/admin/users">Back to Users</a></div></div>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T21:39:44+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/moderation/groups`
- Status: `302`
```
Found. Redirecting to /admin/review/groups
```

### 2025-12-28T21:39:46+00:00

### 2025-12-28T21:40:06+00:00
- Command: `npm run web:build`
- Result: success

### 2025-12-28T21:40:06+00:00
- Command: `rg -n "AdminUsers|AdminSiteSettings" public/app/assets -S`
- Expected: no matches
- Result:
```
```

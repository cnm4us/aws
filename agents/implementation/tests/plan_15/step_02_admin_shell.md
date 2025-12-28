
### 2025-12-28T17:32:27+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/pages`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Pages</title>
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
        <a href="/admin/groups" class="">Groups</a><a href="/admin/channels" class="">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="active">Pages</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">Pages</div>
      </div>
      <main class="content">
<h1>Pages</h1><div class="toolbar"><div><span class="pill">Pages</span></div><div><a href="/admin/pages/new">New page</a></div></div><table><thead><tr><th>Slug</th><th>Title</th><th>Visibility</th><th>Updated</th></tr></thead><tbody><tr><td><a href="/admin/pages/2">docs</a></td><td>Docs</td><td>public</td><td>2025-12-23 19:39:50</td></tr><tr><td><a href="/admin/pages/4">docs/cats</a></td><td>Cats</td><td>public</td><td>2025-12-23 19:53:43</td></tr><tr><td><a href="/admin/pages/3">docs/faq</a></td><td>FAQ</td><td>public</td><td>2025-12-23 19:39:51</td></tr><tr><td><a href="/admin/pages/1">home</a></td><td>Public Social Media</td><td>public</td><td>2025-12-23 18:17:14</td></tr><tr><td><a href="/admin/pages/5">maybe</a></td><td>Maybe</td><td>public</td><td>2025-12-24 05:51:53</td></tr></tbody></table>
      </main>
    </div>
  </body>
</html>
```


### 2025-12-28T17:39:50+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/categories`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Categories</title>
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
        <a href="/admin/groups" class="">Groups</a><a href="/admin/channels" class="">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="active">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="">Pages</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">Categories</div>
      </div>
      <main class="content">
<h1>Categories</h1><div class="toolbar"><div><span class="pill">Categories</span></div><div><a href="/admin/categories/new">New category</a></div></div><table><thead><tr><th>Name</th><th>Cultures</th><th>Rules</th><th>Updated</th></tr></thead><tbody><tr><td><a href="/admin/categories/1">Civility &amp; Tone</a></td><td>1</td><td>3</td><td>2025-12-24 05:20:21</td></tr><tr><td><a href="/admin/categories/5">Fraud &amp; Deception</a></td><td>1</td><td>0</td><td>2025-12-26 22:24:45</td></tr><tr><td><a href="/admin/categories/2">Privacy &amp; Identity Abuse</a></td><td>2</td><td>3</td><td>2025-12-24 19:00:13</td></tr><tr><td><a href="/admin/categories/3">Safety &amp; Severe Harm</a></td><td>1</td><td>3</td><td>2025-12-25 00:51:01</td></tr><tr><td><a href="/admin/categories/4">Sexual Exploitation</a></td><td>1</td><td>3</td><td>2025-12-26 22:24:45</td></tr></tbody></table>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T17:39:50+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/categories/new`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>New Category</title>
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
        <a href="/admin/groups" class="">Groups</a><a href="/admin/channels" class="">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="active">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="">Pages</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">New Category</div>
      </div>
      <main class="content">
<h1>New Category</h1><div class="toolbar"><div><a href="/admin/categories">← Back to categories</a></div></div><form method="post" action="/admin/categories"><input type="hidden" name="csrf" value="<redacted>" /><label>Name
    <input type="text" name="name" value="" />
    <div class="field-hint">Unique label for this category (used by cultures and rules).</div>
  </label><label>Description
    <textarea name="description" style="min-height: 120px"></textarea>
  </label><div class="actions">
    <button type="submit">Create category</button>
  </div></form>
      </main>
    </div>
  </body>
</html>
```

### 2025-12-28T17:39:51+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/admin/categories`
- Status: `302`
```
Found. Redirecting to /forbidden?from=%2Fadmin%2Fcategories
```

# Plan 40 – Step 3: Admin UI (lower third templates)

Date: 2026-01-05

## Login + load pages

```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super login
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /admin/lower-thirds
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /admin/lower-thirds/new
```

Expected: `HTTP 200` and HTML contains `Lower Thirds` / `New Lower Third Template`.

### 2026-01-05T06:38:02+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/lower-thirds`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Lower Thirds</title>
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
        <a href="/admin/review" class="">Review</a><a href="/admin/users" class="">Users</a><a href="/admin/groups" class="">Groups</a><a href="/admin/channels" class="">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="">Pages</a><a href="/admin/audio" class="">Audio</a><a href="/admin/lower-thirds" class="active">Lower Thirds</a><a href="/admin/audio-configs" class="">Audio Configs</a><a href="/admin/media-jobs" class="">Media Jobs</a><a href="/admin/settings" class="">Settings</a><a href="/admin/dev" class="">Dev</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">Lower Thirds</div>
      </div>
      <main class="content">
<h1>Lower Thirds</h1><div class="toolbar"><div><span class="pill">System Templates</span></div><div><a href="/admin/lower-thirds/new">New template</a></div></div><div class="section"><div class="section-title">Templates</div><p class="field-hint">System-managed SVG templates. Versioned and immutable once created.</p><p>No lower third templates yet.</p></div>
      </main>
    </div>
  </body>
</html>
```

### 2026-01-05T06:38:08+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/lower-thirds/new`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>New Lower Third</title>
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
        <a href="/admin/review" class="">Review</a><a href="/admin/users" class="">Users</a><a href="/admin/groups" class="">Groups</a><a href="/admin/channels" class="">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="">Pages</a><a href="/admin/audio" class="">Audio</a><a href="/admin/lower-thirds" class="active">Lower Thirds</a><a href="/admin/audio-configs" class="">Audio Configs</a><a href="/admin/media-jobs" class="">Media Jobs</a><a href="/admin/settings" class="">Settings</a><a href="/admin/dev" class="">Dev</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">New Lower Third</div>
      </div>
      <main class="content">
<h1>New Lower Third Template</h1><div class="toolbar"><div><a href="/admin/lower-thirds">← Back to lower thirds</a></div><div></div></div><p class="field-hint">Templates are immutable once created. To change an existing template, create a new version.</p><form method="post" action="/admin/lower-thirds"><input type="hidden" name="csrf" value="<redacted>" /><label>Template Key
    <input type="text" name="template_key" value="" placeholder="lt_modern_gradient_01" />
    <div class="field-hint">Stable identifier (letters/numbers/_/-). Each change requires a new version.</div>
  </label><label>Version
    <input type="number" name="version" value="1" min="1" step="1" />
    <div class="field-hint">Recommended: use the next version for this key.</div>
  </label><label>Label
    <input type="text" name="label" value="" />
  </label><label>Category
    <input type="text" name="category" value="" placeholder="clean" />
    <div class="field-hint">Optional grouping for later.</div>
  </label><label>SVG Markup
    <textarea name="svg_markup" style="min-height: 220px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">&lt;svg xmlns=&quot;http://www.w3.org/2000/svg&quot; viewBox=&quot;0 0 1920 200&quot;&gt;
  &lt;rect id=&quot;baseBg&quot; x=&quot;0&quot; y=&quot;0&quot; width=&quot;1920&quot; height=&quot;200&quot; fill=&quot;#111111&quot;/&gt;
  &lt;rect id=&quot;gradientOverlay&quot; x=&quot;0&quot; y=&quot;0&quot; width=&quot;1920&quot; height=&quot;200&quot; fill=&quot;#000000&quot; opacity=&quot;0.0&quot;/&gt;
  &lt;text id=&quot;primaryText&quot; x=&quot;90&quot; y=&quot;110&quot; fill=&quot;#ffffff&quot; font-family=&quot;system-ui, -apple-system, Segoe UI, sans-serif&quot; font-size=&quot;72&quot; font-weight=&quot;700&quot;&gt;Primary&lt;/text&gt;
  &lt;text id=&quot;secondaryText&quot; x=&quot;90&quot; y=&quot;165&quot; fill=&quot;#ffffff&quot; opacity=&quot;0.85&quot; font-family=&quot;system-ui, -apple-system, Segoe UI, sans-serif&quot; font-size=&quot;44&quot; font-weight=&quot;500&quot;&gt;Secondary&lt;/text&gt;
&lt;/svg&gt;
</textarea>
    <div class="field-hint">Must be renderer-safe: no scripts/foreignObject/images/hrefs; editable elements must have stable IDs.</div>
  </label><label>Descriptor JSON
    <textarea name="descriptor_json" style="min-height: 180px; font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, 'Liberation Mono', 'Courier New', monospace;">{
  &quot;fields&quot;: [
    {
      &quot;id&quot;: &quot;primaryText&quot;,
      &quot;label&quot;: &quot;Name&quot;,
      &quot;type&quot;: &quot;text&quot;,
      &quot;maxLength&quot;: 40
    },
    {
      &quot;id&quot;: &quot;secondaryText&quot;,
      &quot;label&quot;: &quot;Title&quot;,
      &quot;type&quot;: &quot;text&quot;,
      &quot;maxLength&quot;: 60
    }
  ],
  &quot;colors&quot;: [
    {
      &quot;id&quot;: &quot;baseBg&quot;,
      &quot;label&quot;: &quot;Background Color&quot;
    },
    {
      &quot;id&quot;: &quot;gradientOverlay&quot;,
      &quot;label&quot;: &quot;Fade Color&quot;
    }
  ],
  &quot;defaults&quot;: {
    &quot;primaryText&quot;: &quot;Jane Doe&quot;,
    &quot;secondaryText&quot;: &quot;Senior Correspondent&quot;,
    &quot;baseBg&quot;: &quot;#111111&quot;,
    &quot;gradientOverlay&quot;: &quot;#000000&quot;
  }
}</textarea>
    <div class="field-hint">Defines editable fields/colors and defaults (drives UI + validation).</div>
  </label><div class="actions">
    <button type="submit">Create template</button>
  </div></form>
      </main>
    </div>
  </body>
</html>
```

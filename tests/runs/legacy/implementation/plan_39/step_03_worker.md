# Plan 39 – Step 3: media_jobs upload_thumb_v1

Date: 2026-01-04


### 2026-01-04T18:26:48+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/uploads/45/thumb`
- Status: `404`
```
not_found
```
{"jobId":31,"uploadId":45}
1 200

### 2026-01-04T18:27:18+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/media-jobs/31`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Media Job #31</title>
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
        <a href="/admin/review" class="">Review</a><a href="/admin/users" class="">Users</a><a href="/admin/groups" class="">Groups</a><a href="/admin/channels" class="">Channels</a><a href="/admin/rules" class="">Rules</a><a href="/admin/categories" class="">Categories</a><a href="/admin/cultures" class="">Cultures</a><a href="/admin/pages" class="">Pages</a><a href="/admin/audio" class="">Audio</a><a href="/admin/audio-configs" class="">Audio Configs</a><a href="/admin/media-jobs" class="active">Media Jobs</a><a href="/admin/settings" class="">Settings</a><a href="/admin/dev" class="">Dev</a>
      </nav>
    </aside>
    <label for="adminNavToggle" class="admin-nav-overlay" aria-hidden="true"></label>
    <div class="main">
      <div class="topbar">
        <label for="adminNavToggle" class="sidebar-open" aria-label="Open navigation">Menu</label>
        <div class="topbar-title">Media Job #31</div>
      </div>
      <main class="content">
<h1>Media Job #31</h1><div class="toolbar"><div><a href="/admin/media-jobs">← Back</a></div><div style="display:flex; gap:10px; align-items:center">
      <form method="post" action="/admin/media-jobs/31/retry" onsubmit="return confirm('Retry media job #31?');">
        <input type="hidden" name="csrf" value="<redacted>" />
        <button type="submit" class="btn">Retry</button>
      </form>
      <form method="post" action="/admin/media-jobs/31/purge" onsubmit="return confirm('Purge logs/artifacts for media job #31?');">
        <input type="hidden" name="csrf" value="<redacted>" />
        <button type="submit" class="btn danger">Purge logs</button>
      </form>
    </div></div><div class="section"><div class="section-title">Summary</div><p>Status: <strong>completed</strong></p><p>Type: <strong>upload_thumb_v1</strong></p><p>Attempts: <strong>1/3</strong></p></div><div class="section"><div class="section-title">Attempts</div><table><thead><tr><th>#</th><th>Started</th><th>Finished</th><th>Exit</th><th>Logs</th></tr></thead><tbody><tr><td>1</td><td>2026-01-04 18:27:05</td><td>2026-01-04 18:27:06</td><td>0</td><td><a href="/admin/media-jobs/31/attempts/31/stdout">stdout</a> &nbsp; <a href="/admin/media-jobs/31/attempts/31/stderr">stderr</a></td></tr></tbody></table></div><div class="section"><div class="section-title">Input JSON</div><pre style="white-space:pre-wrap; word-break:break-word">{
  &quot;uploadId&quot;: 45,
  &quot;userId&quot;: 1,
  &quot;video&quot;: {
    &quot;bucket&quot;: &quot;bacs-mc-uploads&quot;,
    &quot;key&quot;: &quot;2025-12/23/97cbfde0-3ea7-4aea-a282-fd4051a6f034/video.mp4&quot;
  },
  &quot;outputBucket&quot;: &quot;bacs-mc-uploads&quot;,
  &quot;outputKey&quot;: &quot;thumbs/uploads/45/thumb.jpg&quot;,
  &quot;longEdgePx&quot;: 640
}</pre></div><div class="section"><div class="section-title">Result JSON</div><pre style="white-space:pre-wrap; word-break:break-word">{
  &quot;output&quot;: {
    &quot;bucket&quot;: &quot;bacs-mc-uploads&quot;,
    &quot;key&quot;: &quot;thumbs/uploads/45/thumb.jpg&quot;,
    &quot;s3Url&quot;: &quot;s3://bacs-mc-uploads/thumbs/uploads/45/thumb.jpg&quot;
  }
}</pre></div>
      </main>
    </div>
  </body>
</html>
```

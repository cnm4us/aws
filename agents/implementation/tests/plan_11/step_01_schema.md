# Step 01 — Schema: split guidance fields

Date: 2025-12-26

Goal:
- Add new guidance columns for moderators/agents on `rule_versions` + `rule_drafts`.
- Backfill legacy `guidance_*` into moderators guidance columns.

Notes:
- This file is appended to by `scripts/auth_curl.sh` via `AUTH_LOG_FILE` (it never logs Set-Cookie values).


### 2025-12-26T15:18:01+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/rules`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Rules</title>
    <style>
      html, body { margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #05070a; color: #f5f5f5; }
      a { color: #9cf; }
      main { max-width: 880px; margin: 0 auto; padding: 20px 16px 40px; line-height: 1.5; }
      h1 { font-size: 1.7rem; margin-bottom: 0.5rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
      th, td { border-bottom: 1px solid rgba(255,255,255,0.15); padding: 6px 4px; text-align: left; }
      th { font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.8; }
      input[type="text"], textarea, select {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.3);
        background: rgba(0,0,0,0.6);
        color: #f5f5f5;
        font-family: inherit;
        font-size: 0.95rem;
      }
      textarea { min-height: 220px; resize: vertical; }
      label { display: block; margin-top: 10px; font-size: 0.9rem; }
      .field-hint { font-size: 0.8rem; opacity: 0.7; margin-top: 2px; }
      .actions { margin-top: 14px; display: flex; gap: 10px; align-items: center; }
      button {
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.35);
        background: #1976d2;
        color: #fff;
        cursor: pointer;
        font-size: 0.9rem;
      }
      button.danger {
        background: #b71c1c;
        border-color: rgba(255,255,255,0.35);
      }
      button.danger:hover { background: #c62828; }
      .error { margin-top: 8px; color: #ffb3b3; font-size: 0.85rem; }
      .success { margin-top: 8px; color: #b3ffd2; font-size: 0.85rem; }
      .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; }
      .toolbar a { font-size: 0.9rem; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.25); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.85; }
    </style>
  </head>
  <body>
    <main>
<h1>Rules</h1><div class="toolbar"><div><span class="pill">Rules</span></div><div><a href="/admin/rules/new">New rule</a></div></div><div class="toolbar" style="margin-top: 10px"><div><label style="display:flex; gap:10px; align-items:center; margin:0"><span style="opacity:0.85">Category</span><select name="categoryId" onchange="(function(sel){const qs=new URLSearchParams(window.location.search); if(sel.value){qs.set('categoryId', sel.value)} else {qs.delete('categoryId')} window.location.search=qs.toString()})(this)"><option value="" selected>All</option><option value="1">Civility &amp; Tone</option><option value="2">Privacy &amp; Identity Abuse</option><option value="3">Safety &amp; Severe Harm</option></select></label></div></div><table><thead><tr>
      <th><a href="/admin/rules?sort=slug&amp;dir=desc">Slug ▲</a></th>
      <th><a href="/admin/rules?sort=category&amp;dir=asc">Category</a></th>
      <th><a href="/admin/rules?sort=title&amp;dir=asc">Title</a></th>
      <th><a href="/admin/rules?sort=visibility&amp;dir=asc">Visibility</a></th>
      <th><a href="/admin/rules?sort=version&amp;dir=asc">Current Version</a></th>
      <th><a href="/admin/rules?sort=draft&amp;dir=asc">Draft</a></th>
      <th><a href="/admin/rules?sort=updated&amp;dir=asc">Updated</a></th>
      <th></th>
    </tr></thead><tbody><tr><td><a href="/admin/rules/14">doxxing</a></td><td>Privacy &amp; Identity Abuse</td><td>Doxxing</td><td>public</td><td>2</td><td><span class="pill">Draft pending</span></td><td>2025-12-24 19:23:16</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/14/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/14/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \'doxxing\'? This cannot be undone.');"><input type="hidden" name="csrf" value="<redacted>" /><button type="submit" class="danger">Delete</button></form></td></tr><tr><td><a href="/admin/rules/12">hostile-profanity-toward-others</a></td><td>Civility &amp; Tone</td><td>Hostile Profanity Toward Others</td><td>public</td><td>1</td><td></td><td>2025-12-24 18:38:14</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/12/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/12/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \'hostile-profanity-toward-others\'? This cannot be undone.');"><input type="hidden" name="csrf" value="<redacted>" /><button type="submit" class="danger">Delete</button></form></td></tr><tr><td><a href="/admin/rules/15">impersonation</a></td><td>Privacy &amp; Identity Abuse</td><td>Impersonation</td><td>public</td><td>1</td><td></td><td>2025-12-24 19:22:44</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/15/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/15/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \'impersonation\'? This cannot be undone.');"><input type="hidden" name="csrf" value="<redacted>" /><button type="submit" class="danger">Delete</button></form></td></tr><tr><td><a href="/admin/rules/17">incitement-of-harm</a></td><td>Safety &amp; Severe Harm</td><td>Incitement or endorsement of harm</td><td>public</td><td>1</td><td></td><td>2025-12-25 01:07:34</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/17/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/17/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \'incitement-of-harm\'? This cannot be undone.');"><input type="hidden" name="csrf" value="<redacted>" /><button type="submit" class="danger">Delete</button></form></td></tr><tr><td><a href="/admin/rules/11">mockery-of-individuals</a></td><td>Civility &amp; Tone</td><td>Mockery of Individuals</td><td>public</td><td>1</td><td><span class="pill">Draft pending</span></td><td>2025-12-24 18:32:40</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/11/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/11/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \'mockery-of-individuals\'? This cannot be undone.');"><input type="hidden" name="csrf" value="<redacted>" /><button type="submit" class="danger">Delete</button></form></td></tr><tr><td><a href="/admin/rules/13">non-consensual-exposure-personal-information</a></td><td>Privacy &amp; Identity Abuse</td><td>Non-Consensual Exposure of Personal Information</td><td>public</td><td>1</td><td></td><td>2025-12-24 19:05:20</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/13/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/13/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \'non-consensual-exposure-personal-information\'? This cannot be undone.');"><input type="hidden" name="csrf" value="<redacted>" /><button type="submit" class="danger">Delete</button></form></td></tr><tr><td><a href="/admin/rules/7">personal-attacks</a></td><td>Civility &amp; Tone</td><td>Personal Attacks</td><td>public</td><td>3</td><td><span class="pill">Draft pending</span></td><td>2025-12-24 18:16:59</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/7/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/7/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \'personal-attacks\'? This cannot be undone.');"><input type="hidden" name="csrf" value="<redacted>" /><button type="submit" class="danger">Delete</button></form></td></tr><tr><td><a href="/admin/rules/18">terrorism</a></td><td>Safety &amp; Severe Harm</td><td>Terrorism or Mass-Casualty Advocacy</td><td>public</td><td>1</td><td></td><td>2025-12-25 01:14:39</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/18/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/18/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \'terrorism\'? This cannot be undone.');"><input type="hidden" name="csrf" value="<redacted>" /><button type="submit" class="danger">Delete</button></form></td></tr><tr><td><a href="/admin/rules/16">threats-of-violence</a></td><td>Safety &amp; Severe Harm</td><td>Threats of Violence</td><td>public</td><td>1</td><td></td><td>2025-12-25 00:54:36</td><td style="text-align: right; white-space: nowrap"><a href="/admin/rules/16/edit" style="margin-right: 10px">Edit Draft</a><form method="post" action="/admin/rules/16/delete" style="margin:0; display:inline" onsubmit="return confirm('Delete rule \'threats-of-violence\'? This cannot be undone.');"><input type="hidden" name="csrf" value="<redacted>" /><button type="submit" class="danger">Delete</button></form></td></tr></tbody></table>
    </main>
  </body>
</html>
```

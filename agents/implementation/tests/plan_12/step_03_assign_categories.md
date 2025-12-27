# Step 03 — Culture detail + category assignment

Date: 2025-12-27

Goal:
- `GET /admin/cultures/:id` renders editable name/description and category assignment checkboxes.
- `POST /admin/cultures/:id` updates culture and assignments (0..N categories).

Notes:
- This file is appended to by `scripts/auth_curl.sh` via `AUTH_LOG_FILE` (it never logs Set-Cookie values).
- Any CSRF hidden-field values in HTML are redacted.

### 2025-12-27T17:46:13+00:00
- Profile: `super`
- Request: `POST http://localhost:3300/admin/cultures`
- Status: `400`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>New Culture</title>
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
<h1>New Culture</h1><div class="toolbar"><div><a href="/admin/cultures">← Back to cultures</a></div></div><div class="error">Name is required.</div><form method="post" action="/admin/cultures"><input type="hidden" name="csrf" value="<redacted>" /><label>Name
    <input type="text" name="name" value="" />
    <div class="field-hint">Unique label for this culture (used by admins; not currently shown to end users).</div>
  </label><label>Description
    <textarea name="description" style="min-height: 120px"></textarea>
  </label><div class="actions">
    <button type="submit">Create culture</button>
  </div></form>
    </main>
  </body>
</html>
```

### 2025-12-27T17:47:02+00:00
- Profile: `super`
- Request: `POST http://localhost:3300/admin/cultures`
- Status: `302`
```
Found. Redirecting to /admin/cultures?notice=Culture%20created.
```

### 2025-12-27T17:47:02+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/cultures/1`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Culture</title>
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
<h1>Culture: plan_12_test_20251227_174702</h1><div class="toolbar"><div><a href="/admin/cultures">← Back to cultures</a></div></div><form method="post" action="/admin/cultures/1"><input type="hidden" name="csrf" value="<redacted>" /><label>Name
    <input type="text" name="name" value="plan_12_test_20251227_174702" />
  </label><label>Description
    <textarea name="description" style="min-height: 120px">Temporary culture for plan_12 step_03</textarea>
  </label><div class="section" style="margin-top: 14px"><div class="section-title">Categories</div><div class="field-hint">Select which rule categories are included in this culture. Users will only see rules from these categories once cultures are attached to spaces.</div><div style="margin-top: 10px"><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="1" style="margin-top: 3px" /><div><div>Civility &amp; Tone</div></div></label><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="5" style="margin-top: 3px" /><div><div>Fraud &amp; Deception</div></div></label><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="2" style="margin-top: 3px" /><div><div>Privacy &amp; Identity Abuse</div></div></label><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="3" style="margin-top: 3px" /><div><div>Safety &amp; Severe Harm</div></div></label><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="4" style="margin-top: 3px" /><div><div>Sexual Exploitation</div></div></label></div></div><div class="actions">
    <button type="submit">Save</button>
  </div></form>
    </main>
  </body>
</html>
```

### 2025-12-27T17:47:02+00:00
- Profile: `super`
- Request: `POST http://localhost:3300/admin/cultures/1`
- Status: `302`
```
Found. Redirecting to /admin/cultures/1?notice=Saved.
```

### 2025-12-27T17:47:02+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/cultures/1`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Culture</title>
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
<h1>Culture: plan_12_test_20251227_174702</h1><div class="toolbar"><div><a href="/admin/cultures">← Back to cultures</a></div></div><form method="post" action="/admin/cultures/1"><input type="hidden" name="csrf" value="<redacted>" /><label>Name
    <input type="text" name="name" value="plan_12_test_20251227_174702" />
  </label><label>Description
    <textarea name="description" style="min-height: 120px">Temporary culture for plan_12 step_03</textarea>
  </label><div class="section" style="margin-top: 14px"><div class="section-title">Categories</div><div class="field-hint">Select which rule categories are included in this culture. Users will only see rules from these categories once cultures are attached to spaces.</div><div style="margin-top: 10px"><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="1" checked style="margin-top: 3px" /><div><div>Civility &amp; Tone</div></div></label><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="5" style="margin-top: 3px" /><div><div>Fraud &amp; Deception</div></div></label><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="2" checked style="margin-top: 3px" /><div><div>Privacy &amp; Identity Abuse</div></div></label><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="3" style="margin-top: 3px" /><div><div>Safety &amp; Severe Harm</div></div></label><label style="display:flex; gap:10px; align-items:flex-start; margin-top: 8px"><input type="checkbox" name="categoryIds" value="4" style="margin-top: 3px" /><div><div>Sexual Exploitation</div></div></label></div></div><div class="actions">
    <button type="submit">Save</button>
  </div></form>
    </main>
  </body>
</html>
```

# Step 07 — TOC behavior (/pages/docs)

Date: 2025-12-23

BASE_URL: `http://localhost:3300` (local dev)

## Setup (create docs pages if missing)

Commands:
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super login

# Create /pages/docs (if it already exists, the admin page will return an error message)
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super post /admin/pages \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "slug=docs&title=Docs&visibility=public&markdown=%23%20Docs%0A%0AWelcome%20to%20Docs."

# Create /pages/docs/faq
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super post /admin/pages \
  -H "Content-Type: application/x-www-form-urlencoded" \
  --data "slug=docs%2Ffaq&title=FAQ&visibility=public&markdown=%23%20FAQ%0A%0ACommon%20questions."
```

## Verify API returns children

Commands:
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get /api/pages/docs
```

Expected:
- `HTTP 200`
- JSON includes `children[]` containing an entry with `slug="docs/faq"` and `url="/pages/docs/faq"`.

Actual:
```text
HTTP 200
{"slug":"docs","title":"Docs","html":"<h1 id=\"docs\">Docs</h1>\n<p>Welcome to Docs.</p>","visibility":"public","layout":"default","updatedAt":"2025-12-23T19:39:50.000Z","children":[{"slug":"docs/faq","title":"FAQ","url":"/pages/docs/faq"}]}
```

## Verify SPA shell routes

Commands:
```bash
curl -sS http://localhost:3300/pages/docs | rg -n 'id="root"'
curl -sS http://localhost:3300/pages/docs/faq | rg -n 'id="root"'
```

Actual:
```text
24:    <div id="root"></div>
24:    <div id="root"></div>
```

# Step 05 — Publish Version (draft → new immutable version)

Date: 2025-12-24

BASE_URL: `https://aws.bawebtech.com`

Test rule slug: `tmp-publish-1766597973`
Rule id: `9`

## Create a fresh rule (published v1)

Command:
```bash
BASE_URL="https://aws.bawebtech.com"
SLUG="tmp-publish-1766597973"

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super post /admin/rules \
  --data "slug=${SLUG}&title=Publish%20Test&categoryId=&visibility=public&shortDescription=Short%20v1&markdown=%23%20Long%20v1%0A%0AInitial%20content.&allowedExamples=-%20Allowed%20v1&disallowedExamples=-%20Disallowed%20v1&guidance=Guidance%20v1&changeSummary=initial" \
  | head -n 3
```

Actual:
```text
HTTP 302
Found. Redirecting to /admin/rules
```

## Verify latest API shows v1 before publishing

Command:
```bash
BASE_URL="https://aws.bawebtech.com"
SLUG="tmp-publish-1766597973"

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super get "/api/rules/${SLUG}" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  s=s.replace(/^HTTP \\d+\\r?\\n/,"");
  const j=JSON.parse(s);
  console.log("before_version="+(j.currentVersion?.version??""));
  console.log("before_title="+(j.title??""));
  console.log("before_html_prefix="+String(j.html||"").slice(0,60).replace(/\\n/g,"\\\\n"));
});'
```

Actual:
```text
before_version=1
before_title=Publish Test
before_html_prefix=<h1 id="long-v1">Long v1</h1>\n<p>Initial content.</p>
```

## Publish a new version (v2)

Command:
```bash
BASE_URL="https://aws.bawebtech.com"
RULE_ID="9"

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super post "/admin/rules/${RULE_ID}/edit" \
  --data "action=publish&title=Publish%20Test%20(UPDATED)&categoryId=&shortDescription=Short%20draft&markdown=%23%20Long%20v2%0A%0APublished%20content.&allowedExamples=-%20Allowed%20v2&disallowedExamples=-%20Disallowed%20v2&guidance=Guidance%20v2&changeSummary=publish%20v2" \
  | head -n 3
```

Actual:
```text
HTTP 302
Found. Redirecting to /admin/rules/9/edit?notice=Published%20v2.
```

## Verify latest API now shows v2

Command:
```bash
BASE_URL="https://aws.bawebtech.com"
SLUG="tmp-publish-1766597973"

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super get "/api/rules/${SLUG}" | node -e '
let s="";process.stdin.on("data",d=>s+=d);process.stdin.on("end",()=>{
  s=s.replace(/^HTTP \\d+\\r?\\n/,"");
  const j=JSON.parse(s);
  console.log("after_version="+(j.currentVersion?.version??""));
  console.log("after_title="+(j.title??""));
  console.log("after_html_prefix="+String(j.html||"").slice(0,60).replace(/\\n/g,"\\\\n"));
});'
```

Actual:
```text
after_version=2
after_title=Publish Test (UPDATED)
after_html_prefix=<h1 id="long-v2">Long v2</h1>\n<p>Published content.</p>
```

## Verify historical permalinks differ

Command:
```bash
BASE_URL="https://aws.bawebtech.com"
SLUG="tmp-publish-1766597973"

V1=$(curl -sS "$BASE_URL/rules/$SLUG/v:1" | rg -o "Long v1|Long v2" | head -n 1 || true)
V2=$(curl -sS "$BASE_URL/rules/$SLUG/v:2" | rg -o "Long v1|Long v2" | head -n 1 || true)
echo "v1_page_contains=$V1"
echo "v2_page_contains=$V2"
```

Actual:
```text
v1_page_contains=Long v1
v2_page_contains=Long v2
```


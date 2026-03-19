# Step 06 — Draft indicator (admin list + detail)

Date: 2025-12-24

BASE_URL: `https://aws.bawebtech.com`

Test rule slug: `tmp-draft-indicator-1766598793`
Rule id: `10`

## Save draft → list + detail show “Draft pending”

Command:
```bash
BASE_URL="https://aws.bawebtech.com"
RULE_ID="10"

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super post "/admin/rules/${RULE_ID}/edit" \
  --data "action=save&title=Draft%20Indicator%20Test&categoryId=&shortDescription=Short%20draft&markdown=%23%20Long%20DRAFT%0A%0AUnpublished%20draft%20content.&allowedExamples=&disallowedExamples=&guidance=" \
  | head -n 3
```

Actual:
```text
HTTP 302
Found. Redirecting to /admin/rules/10/edit?notice=Draft%20saved.
```

Command (checks):
```bash
BASE_URL="https://aws.bawebtech.com"
SLUG="tmp-draft-indicator-1766598793"
RULE_ID="10"

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super get /admin/rules > /tmp/plan10_step06_rules_after_save.txt
node - <<'NODE'
const fs = require('fs');
const slug = process.env.SLUG;
let s = fs.readFileSync('/tmp/plan10_step06_rules_after_save.txt','utf8');
s = s.replace(/^HTTP \\d+\\r?\\n/,'');
const idx = s.indexOf(slug);
const window = idx>=0 ? s.slice(Math.max(0, idx-250), Math.min(s.length, idx+500)) : '';
console.log('list_has_draft_pending=' + (idx>=0 && window.includes('Draft pending') ? 'yes' : 'no'));
NODE

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super get "/admin/rules/${RULE_ID}" > /tmp/plan10_step06_detail_after_save_full.txt
node - <<'NODE'
const fs = require('fs');
let s = fs.readFileSync('/tmp/plan10_step06_detail_after_save_full.txt','utf8');
s = s.replace(/^HTTP \\d+\\r?\\n/,'');
console.log('detail_has_draft_pending=' + (s.includes('Draft pending') ? 'yes' : 'no'));
NODE
```

Actual:
```text
list_has_draft_pending=yes
detail_has_draft_pending=yes
```

## Publish → list + detail clear “Draft pending”

Command:
```bash
BASE_URL="https://aws.bawebtech.com"
RULE_ID="10"

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super post "/admin/rules/${RULE_ID}/edit" \
  --data "action=publish&title=Draft%20Indicator%20Test&categoryId=&shortDescription=Short%20draft&markdown=%23%20Long%20v2%0A%0APublished%20content.&allowedExamples=&disallowedExamples=&guidance=&changeSummary=publish%20v2" \
  | head -n 3
```

Actual:
```text
HTTP 302
Found. Redirecting to /admin/rules/10/edit?notice=Published%20v2.
```

Command (checks):
```bash
BASE_URL="https://aws.bawebtech.com"
SLUG="tmp-draft-indicator-1766598793"
RULE_ID="10"

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super get /admin/rules > /tmp/plan10_step06_rules_after_publish.txt
node - <<'NODE'
const fs = require('fs');
const slug = process.env.SLUG;
let s = fs.readFileSync('/tmp/plan10_step06_rules_after_publish.txt','utf8');
s = s.replace(/^HTTP \\d+\\r?\\n/,'');
const idx = s.indexOf(slug);
const window = idx>=0 ? s.slice(Math.max(0, idx-250), Math.min(s.length, idx+500)) : '';
console.log('list_cleared_draft_pending=' + (idx>=0 && !window.includes('Draft pending') ? 'yes' : 'no'));
NODE

BASE_URL="$BASE_URL" ./scripts/auth_curl.sh --profile super get "/admin/rules/${RULE_ID}" > /tmp/plan10_step06_detail_after_publish_full.txt
node - <<'NODE'
const fs = require('fs');
let s = fs.readFileSync('/tmp/plan10_step06_detail_after_publish_full.txt','utf8');
s = s.replace(/^HTTP \\d+\\r?\\n/,'');
console.log('detail_cleared_draft_pending=' + (s.includes('Draft pending') ? 'no' : 'yes'));
NODE
```

Actual:
```text
list_cleared_draft_pending=yes
detail_cleared_draft_pending=yes
```


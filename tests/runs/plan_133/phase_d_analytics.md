# Plan 133 — Phase D Canonical Analytics Rename

Date: `2026-03-18T23:11:14+00:00`  
Base URL: `http://localhost:3300`

## Auth Setup

Command:
```bash
BASE_URL=http://localhost:3300 ./scripts/auth_curl.sh --profile super login
```

Result:
```text
HTTP 200
{"ok":true,"userId":1}
```

## Canonical Event Contract

Command:
```bash
node - <<'NODE'
const { buildCanonicalAnalyticsEvent } = require('./dist/features/analytics-events/contract.js')
const base = {
  occurredAt: new Date('2026-03-18T23:30:00Z'),
  surface: 'global_feed',
  viewerState: 'anonymous',
  sessionId: 'plan133session',
  messageId: 4,
  meta: { message_campaign_key: 'plan_133' },
}
try {
  const ok = buildCanonicalAnalyticsEvent({ ...base, eventName: 'message_impression' })
  console.log('new_event_ok', ok.eventName, ok.messageId)
} catch (err) {
  console.log('new_event_fail', err && err.code || err && err.message)
}
try {
  buildCanonicalAnalyticsEvent({ ...base, eventName: 'prompt_impression' })
  console.log('old_event_unexpected_ok')
} catch (err) {
  console.log('old_event_fail', err && err.code || err && err.message)
}
NODE
```

Result:
```text
new_event_ok message_impression 4
old_event_fail invalid_analytics_event_name
```

## Feed Decision / Event API

Synthetic session used:
```text
plan133-1773875431
```

### Before report snapshot

Command:
```bash
BASE_URL=http://localhost:3300 ./scripts/auth_curl.sh --profile super get "/api/admin/message-analytics?from=2026-03-18&to=2026-03-18&message_id=4"
```

Result excerpt:
```json
{
  "kpis": {
    "totals": {
      "impressions": 28,
      "clicksPrimary": 0,
      "dismiss": 21,
      "authStart": 0,
      "authComplete": 0
    }
  }
}
```

### Message-first decision request accepted

Command:
```bash
curl -sS -X POST 'http://localhost:3300/api/feed/message-decision' \
  -H 'Content-Type: application/json' \
  --data '{"surface":"global_feed","message_session_id":"plan133-1773875431","slides_viewed":10,"watch_seconds":120,"messages_shown_this_session":0,"slides_since_last_message":99,"last_message_id":null}'
```

Result:
```json
{"should_insert":true,"message_id":4,"insert_after_index":null,"reason_code":"eligible","session_id":"plan133-1773875431"}
```

### Legacy decision keys rejected

Command:
```bash
curl -sS -i -X POST 'http://localhost:3300/api/feed/message-decision' \
  -H 'Content-Type: application/json' \
  --data '{"surface":"global_feed","session_id":"plan133-1773875431","prompts_shown_this_session":0}'
```

Result excerpt:
```text
HTTP/1.1 400 Bad Request
{"error":"legacy_prompt_wire_keys_not_supported"}
```

### Message-first event ingestion accepted

Commands:
```bash
curl -sS -X POST 'http://localhost:3300/api/feed/message-events' \
  -H 'Content-Type: application/json' \
  --data '{"event":"impression","surface":"global_feed","message_id":4,"message_campaign_key":"register_prompt_x","message_session_id":"plan133-1773875431"}'

curl -sS -X POST 'http://localhost:3300/api/feed/message-events' \
  -H 'Content-Type: application/json' \
  --data '{"event":"click","surface":"global_feed","message_id":4,"message_campaign_key":"register_prompt_x","message_session_id":"plan133-1773875431","message_cta_kind":"primary"}'

curl -sS -X POST 'http://localhost:3300/api/feed/message-events' \
  -H 'Content-Type: application/json' \
  --data '{"event":"pass_through","surface":"global_feed","message_id":4,"message_campaign_key":"register_prompt_x","message_session_id":"plan133-1773875431"}'

curl -sS -X POST 'http://localhost:3300/api/feed/message-events' \
  -H 'Content-Type: application/json' \
  --data '{"event":"auth_start","surface":"global_feed","message_id":4,"message_campaign_key":"register_prompt_x","message_session_id":"plan133-1773875431"}'

curl -sS -X POST 'http://localhost:3300/api/feed/message-events' \
  -H 'Content-Type: application/json' \
  --data '{"event":"auth_complete","surface":"global_feed","message_id":4,"message_campaign_key":"register_prompt_x","message_session_id":"plan133-1773875431"}'
```

Results:
```json
{"ok":true,"deduped":false,"counted":true,"attributed":true}
{"ok":true,"deduped":false,"counted":true,"attributed":true}
{"ok":true,"deduped":false,"counted":true,"attributed":true}
{"ok":true,"deduped":false,"counted":true,"attributed":true}
{"ok":true,"deduped":false,"counted":true,"attributed":true}
```

### Legacy event keys rejected

Command:
```bash
curl -sS -i -X POST 'http://localhost:3300/api/feed/message-events' \
  -H 'Content-Type: application/json' \
  --data '{"event":"impression","surface":"global_feed","prompt_id":4,"message_session_id":"plan133-1773875431"}'
```

Result excerpt:
```text
HTTP/1.1 400 Bad Request
{"error":"legacy_prompt_wire_keys_not_supported"}
```

### After report snapshot

Command:
```bash
BASE_URL=http://localhost:3300 ./scripts/auth_curl.sh --profile super get "/api/admin/message-analytics?from=2026-03-18&to=2026-03-18&message_id=4"
```

Result excerpt:
```json
{
  "kpis": {
    "totals": {
      "impressions": 29,
      "clicksPrimary": 1,
      "dismiss": 22,
      "authStart": 1,
      "authComplete": 1
    },
    "uniqueSessions": {
      "impressions": 8,
      "clicksTotal": 1,
      "dismiss": 6,
      "authStart": 1,
      "authComplete": 1
    }
  }
}
```

Observed deltas from the synthetic session:
- `impressions`: `28 -> 29`
- `clicksPrimary`: `0 -> 1`
- `dismiss`: `21 -> 22`
- `authStart`: `0 -> 1`
- `authComplete`: `0 -> 1`

## Admin Analytics CSV

Command:
```bash
BASE_URL=http://localhost:3300 INCLUDE_HEADERS=1 ./scripts/auth_curl.sh --profile super get '/api/admin/message-analytics.csv?from=2026-03-18&to=2026-03-18&message_id=4'
```

Result excerpt:
```text
Content-Disposition: attachment; filename="message-analytics-2026-03-18_to_2026-03-18.csv"

message_id,message_name,message_type,message_campaign_key,impressions,clicks_primary,clicks_secondary,clicks_total,dismiss,auth_start,auth_complete,...
```

Observed:
- filename is message-first
- CSV headers are message-first

## Admin Analytics Legacy Query Rejection

Command:
```bash
BASE_URL=http://localhost:3300 ./scripts/auth_curl.sh --profile super get '/api/admin/message-analytics?prompt_id=4'
```

Result:
```text
HTTP 400
{"error":"legacy_prompt_wire_keys_not_supported"}
```

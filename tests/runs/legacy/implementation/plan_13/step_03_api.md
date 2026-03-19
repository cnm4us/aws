# Step 03 — Admin APIs: cultures + space cultureIds

Date: 2025-12-27

Goal:
- Add `/api/admin/cultures`.
- Extend `/api/admin/spaces/:id` to include `cultureIds` and accept `cultureIds` on update.

Notes:
- This file is appended to by `scripts/auth_curl.sh` via `AUTH_LOG_FILE` (it never logs Set-Cookie values).


### 2025-12-27T19:43:47+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/admin/cultures`
- Status: `200`
```
{"cultures":[{"id":3,"name":"Global","description":"Site wide moderation rules to protect the rights of all users.","categoryCount":4},{"id":1,"name":"plan_12_test_20251227_174702","description":"Temporary culture for plan_12 step_03","categoryCount":2}]}
```

### 2025-12-27T19:43:52+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/admin/spaces?type=group`
- Status: `200`
```
{"spaces":[{"id":28,"type":"group","name":"maybe","slug":"maybe","ownerUserId":1,"ownerDisplayName":"Admin"},{"id":16,"type":"group","name":"Test Group","slug":"test-group","ownerUserId":1,"ownerDisplayName":"Admin"},{"id":18,"type":"group","name":"Test Group 2","slug":"test-group-2","ownerUserId":1,"ownerDisplayName":"Admin"},{"id":21,"type":"group","name":"Test Group 3","slug":"test-group-3","ownerUserId":1,"ownerDisplayName":"Admin"}]}
```

### 2025-12-27T19:43:56+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/admin/spaces/16`
- Status: `200`
```
{"id":16,"type":"group","ownerUserId":1,"name":"Test Group","slug":"test-group","settings":{"visibility":"private","membership":"invite","publishing":{"requireApproval":false,"targets":["space"]},"limits":{}},"cultureIds":[]}
```

### 2025-12-27T19:44:02+00:00
- Profile: `super`
- Request: `PUT http://localhost:3300/api/admin/spaces/16`
- Status: `200`
```
{"ok":true}
```

### 2025-12-27T19:44:05+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/admin/spaces/16`
- Status: `200`
```
{"id":16,"type":"group","ownerUserId":1,"name":"Test Group","slug":"test-group","settings":{"visibility":"private","membership":"invite","publishing":{"requireApproval":false,"targets":["space"]},"limits":{}},"cultureIds":[3]}
```

### 2025-12-27T19:44:08+00:00
- Profile: `super`
- Request: `PUT http://localhost:3300/api/admin/spaces/16`
- Status: `200`
```
{"ok":true}
```

### 2025-12-27T19:44:11+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/admin/spaces/16`
- Status: `200`
```
{"id":16,"type":"group","ownerUserId":1,"name":"Test Group","slug":"test-group","settings":{"visibility":"private","membership":"invite","publishing":{"requireApproval":false,"targets":["space"]},"limits":{}},"cultureIds":[]}
```

### 2025-12-27T19:44:16+00:00
- Profile: `super`
- Request: `PUT http://localhost:3300/api/admin/spaces/16`
- Status: `400`
```
{"error":"unknown_culture_ids","detail":"unknown_culture_ids"}
```

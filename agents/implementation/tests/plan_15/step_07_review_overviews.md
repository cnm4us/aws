
### 2025-12-28T18:38:25+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/api/space/review/groups`
- Status: `200`
```
{"items":[{"id":21,"name":"Test Group 3","slug":"test-group-3","pending":0}]}
```

### 2025-12-28T18:38:25+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/api/space/review/channels`
- Status: `200`
```
{"items":[{"id":19,"name":"Test Channel 2","slug":"test-channel-2","pending":0}]}
```

### 2025-12-28T18:38:47+00:00
- Request: `GET http://localhost:3300/api/space/review/groups` (no cookies)
- Status: `401`
```
{"error":"unauthorized"}
```

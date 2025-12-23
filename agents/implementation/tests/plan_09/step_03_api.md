# Step 03 — pages/rules JSON APIs (execution log)

Date: 2025-12-23

BASE_URL: `http://localhost:3300` (local dev)

Run commands with:
- `AUTH_LOG_FILE="agents/implementation/tests/plan_09/step_03_api.md" BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh ...`


### 2025-12-23T18:32:14+00:00
- Profile: `default`
- Request: `GET http://localhost:3300/api/pages/home`
- Status: `200`
```
{"slug":"home","title":"Public Social Media","html":"<h1 id=\"welcome\">Welcome</h1>\n<h2 id=\"global-feed-https-aws-bawebtech-com-channels-global-feed\"><a href=\"https://aws.bawebtech.com/channels/global-feed\" rel=\"noopener noreferrer nofollow\">Global Feed</a></h2>","visibility":"public","layout":"default","updatedAt":"2025-12-23T18:17:14.000Z"}
```

### 2025-12-23T18:32:14+00:00
- Profile: `default`
- Request: `GET http://localhost:3300/api/pages/does-not-exist`
- Status: `404`
```
{"error":"page_not_found"}
```

### 2025-12-23T18:32:14+00:00
- Profile: `default`
- Request: `GET http://localhost:3300/api/rules/community-guidelines`
- Status: `200`
```
{"slug":"community-guidelines","title":"Community Guidelines","html":"<h1 id=\"welcome\">Welcome</h1>\n<ul>\n<li>No ad hominem attacks. Do not assert or suggest that people with whom you are engaging have insufficient intelligence, or malicious intent.</li>\n</ul>","visibility":"public","currentVersion":{"version":2,"url":"/rules/community-guidelines/v:2","createdAt":"2025-12-22T22:18:48.000Z","changeSummary":"Added fist detail"},"versions":[{"version":2,"url":"/rules/community-guidelines/v:2","createdAt":"2025-12-22T22:18:48.000Z","changeSummary":"Added fist detail"},{"version":1,"url":"/rules/community-guidelines/v:1","createdAt":"2025-12-22T22:09:07.000Z","changeSummary":"initial version"}]}
```

### 2025-12-23T18:32:15+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/pages/home`
- Status: `200`
```
{"slug":"home","title":"Public Social Media","html":"<h1 id=\"welcome\">Welcome</h1>\n<h2 id=\"global-feed-https-aws-bawebtech-com-channels-global-feed\"><a href=\"https://aws.bawebtech.com/channels/global-feed\" rel=\"noopener noreferrer nofollow\">Global Feed</a></h2>","visibility":"public","layout":"default","updatedAt":"2025-12-23T18:17:14.000Z"}
```

### 2025-12-23T18:32:15+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/pages/docs`
- Status: `404`
```
{"error":"page_not_found"}
```

### 2025-12-23T18:32:15+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/rules/community-guidelines`
- Status: `200`
```
{"slug":"community-guidelines","title":"Community Guidelines","html":"<h1 id=\"welcome\">Welcome</h1>\n<ul>\n<li>No ad hominem attacks. Do not assert or suggest that people with whom you are engaging have insufficient intelligence, or malicious intent.</li>\n</ul>","visibility":"public","currentVersion":{"version":2,"url":"/rules/community-guidelines/v:2","createdAt":"2025-12-22T22:18:48.000Z","changeSummary":"Added fist detail"},"versions":[{"version":2,"url":"/rules/community-guidelines/v:2","createdAt":"2025-12-22T22:18:48.000Z","changeSummary":"Added fist detail"},{"version":1,"url":"/rules/community-guidelines/v:1","createdAt":"2025-12-22T22:09:07.000Z","changeSummary":"initial version"}]}
```

### 2025-12-23T18:32:15+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/api/pages/home`
- Status: `200`
```
{"slug":"home","title":"Public Social Media","html":"<h1 id=\"welcome\">Welcome</h1>\n<h2 id=\"global-feed-https-aws-bawebtech-com-channels-global-feed\"><a href=\"https://aws.bawebtech.com/channels/global-feed\" rel=\"noopener noreferrer nofollow\">Global Feed</a></h2>","visibility":"public","layout":"default","updatedAt":"2025-12-23T18:17:14.000Z"}
```

### 2025-12-23T18:33:43+00:00
- Profile: `default`
- Request: `GET http://localhost:3300/api/pages/1`
- Status: `400`
```
{"error":"bad_slug"}
```

### 2025-12-23T18:33:43+00:00
- Profile: `default`
- Request: `GET http://localhost:3300/api/rules/does-not-exist`
- Status: `404`
```
{"error":"rule_not_found"}
```

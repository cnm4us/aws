
### 2025-12-28T18:24:27+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/api/me`
- Status: `200`
```
{"userId":6,"email":"tester_02@cnm4us.com","displayName":"Tester 02","roles":["site_member"],"isSiteAdmin":false,"spaceRoles":{"19":["space_admin","space_member","space_poster"],"21":["space_admin","space_member","space_poster"]},"personalSpace":{"id":20,"slug":"tester-02"}}
```
\n[chosen spaceId: 19]

### 2025-12-28T18:24:27+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3300/api/spaces/19/review/queue`
- Status: `200`
```
{"items":[]}
```

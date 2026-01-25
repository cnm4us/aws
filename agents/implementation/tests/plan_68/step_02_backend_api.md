# Plan 68 — Step 2 (Backend: Multi-Project Create Video API)

Date: 2026-01-25

## Commands / Results

All requests via:
```bash
BASE_URL=http://localhost:3300 ./scripts/auth_curl.sh --profile super <cmd> <path> ...
```

### List projects
```bash
./scripts/auth_curl.sh --profile super get /api/create-video/projects
```
Result: `200`

### Create project
```bash
./scripts/auth_curl.sh --profile super post /api/create-video/projects -H 'Content-Type: application/json' --data '{"name":"Test Timeline"}'
```
Result: `201`

### Get project
```bash
./scripts/auth_curl.sh --profile super get /api/create-video/projects/2
```
Result: `200`

### Rename project
```bash
./scripts/auth_curl.sh --profile super patch /api/create-video/projects/2 -H 'Content-Type: application/json' --data '{"name":"Test Timeline Renamed"}'
```
Result: `200`

### Update timeline (empty OK)
```bash
./scripts/auth_curl.sh --profile super patch /api/create-video/projects/2/timeline -H 'Content-Type: application/json' --data '{"timeline":{"version":"create_video_v1","clips":[],"stills":[],"graphics":[],"guidelines":[],"logos":[],"lowerThirds":[],"screenTitles":[],"narration":[],"audioSegments":[],"audioTrack":null}}'
```
Result: `200`

### Archive project
```bash
./scripts/auth_curl.sh --profile super post /api/create-video/projects/2/archive
```
Result: `200`


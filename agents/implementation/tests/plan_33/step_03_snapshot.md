
### 2026-01-01T20:25:45+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3314/api/audio-configs`
- Status: `200`
```
{"items":[{"id":1,"name":"Mix (Quiet)","mode":"mix","videoGainDb":0,"musicGainDb":-24,"duckingEnabled":false,"duckingAmountDb":12,"createdAt":"2026-01-01 20:20:33","updatedAt":"2026-01-01 20:20:33","archivedAt":null},{"id":2,"name":"Mix (Medium)","mode":"mix","videoGainDb":0,"musicGainDb":-18,"duckingEnabled":false,"duckingAmountDb":12,"createdAt":"2026-01-01 20:20:33","updatedAt":"2026-01-01 20:20:33","archivedAt":null},{"id":3,"name":"Mix (Loud)","mode":"mix","videoGainDb":0,"musicGainDb":-12,"duckingEnabled":false,"duckingAmountDb":12,"createdAt":"2026-01-01 20:20:33","updatedAt":"2026-01-01 20:20:33","archivedAt":null},{"id":4,"name":"Mix (Medium) + Ducking","mode":"mix","videoGainDb":0,"musicGainDb":-18,"duckingEnabled":true,"duckingAmountDb":12,"createdAt":"2026-01-01 20:20:33","updatedAt":"2026-01-01 20:20:33","archivedAt":null},{"id":8,"name":"Mix Test","mode":"mix","videoGainDb":0,"musicGainDb":-18,"duckingEnabled":true,"duckingAmountDb":12,"createdAt":"2026-01-01 20:20:33","updatedAt":"2026-01-01 20:20:33","archivedAt":null}]}
```
\n--- server log (tail)
Uploader server listening on http://localhost:3314
HTTP server closed.
Error closing DB pool Error: Can't add new command when connection is in closed state
    at PromisePool.end (/home/ubuntu/aws/node_modules/mysql2/lib/promise/pool.js:72:22)
    at gracefulStop (/home/ubuntu/aws/dist/server.js:219:18)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5) {
  code: undefined,
  errno: undefined,
  sqlState: undefined,
  sqlMessage: undefined
}
Shutdown complete (SIGTERM).
### 2026-01-01T20:26:49+00:00
- Inserted test upload id: 59
- s3_key: 2026-01/01/1dcf6d9f-b376-4714-8cc3-523fe8129808/video.mp4

#### POST /api/productions (expected to fail before/at MediaConvert)
```
HTTP 500
{"error":"internal_error","detail":"The security token included in the request is invalid."}
```

#### Verify snapshot stored in DB
```
{
  "productionId": 81,
  "audioConfigId": 1,
  "audioConfigSnapshot": {
    "id": 1,
    "name": "Mix (Quiet)",
    "mode": "mix",
    "videoGainDb": 0,
    "musicGainDb": -24,
    "duckingEnabled": false,
    "duckingAmountDb": 12
  }
}

#### Cleanup (delete test production + upload rows)
```
ok
```

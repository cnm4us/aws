
### 2026-01-01T19:59:44+00:00
- Profile: `space_admin`
- Request: `GET http://localhost:3310/api/audio-configs`
- Status: `200`
```
{"items":[]}
```
\n--- server log (tail)
Uploader server listening on http://localhost:3310
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

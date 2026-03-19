# Plan 133 — Phase C Debug Cleanup

Date: `2026-03-18T23:11:14+00:00`

## Legacy Debug Token Removal

Command:
```bash
rg -n "prompt:debug|feed:prompt-debug|sequence_prompt_inserted" frontend/src agents/tools/debugging.md -S
```

Result:
```text
no matches
```

## Message-First Debug Tokens Present

Command:
```bash
rg -n "message:debug|feed:message-debug|sequence_message_inserted" frontend/src agents/tools/debugging.md -S
```

Result:
```text
agents/tools/debugging.md:97:localStorage.setItem('message:debug', '1')
agents/tools/debugging.md:105:localStorage.removeItem('message:debug')
agents/tools/debugging.md:127:- `sequence_message_inserted`
agents/tools/debugging.md:142:- `feed:message-debug`
agents/tools/debugging.md:203:localStorage.setItem('message:debug', '1')
frontend/src/app/Feed.tsx:96:    storageKey: 'message:debug',
frontend/src/app/Feed.tsx:103:  dispatchClientDebugDomEvent('feed:message-debug', name, detail, {
frontend/src/app/Feed.tsx:160:  | 'sequence_message_inserted'
frontend/src/app/Feed.tsx:984:      emitSequenceHook('sequence_message_inserted', {
frontend/src/app/Feed.tsx:1079:        { domEventName: 'feed:message-debug', category: 'message' },
```

Observed:
- legacy browser debug shim names are removed from active frontend/docs
- message-first debug names remain in code and docs

Note:
- This log covers CLI-verifiable contract cleanup.
- Browser-runtime debug emission was not re-run headlessly here.

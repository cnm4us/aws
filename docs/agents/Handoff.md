Thread Continuity Procedures (Handoff Files)

Goal
- Ensure maximal cross‑thread coherence by carrying forward decisions, context, and machine‑readable metadata. This file defines how to find the latest handoff and how to seed/update the next one.

Locate Latest
1) List files matching docs/agents/Handoff_*.md.
2) Pick the greatest N (numeric sort). Zero‑padding is common but not required.
3) Read that Handoff_N.md fully. Extract Decisions (carry forward), Open Items, and any prepared Commit Messages.

Create Next
1) Set M = N + 1.
2) Create docs/agents/Handoff_{M}.md.
3) Populate it using the template below. Copy forward Decisions (still in effect) and migrate relevant Open Items. Keep it updated throughout the thread.

Update During Thread
- Semantic (validated) updates:
  - Prefer updating the handoff after a change/decision is confirmed effective
    (e.g., page renders correctly, API returns expected data, tests pass),
    rather than continuously during exploration. This reduces context drag and
    preserves in‑thread coherence while keeping cross‑thread cohesion strong.
- Append new Decisions promptly once validated.
- Record Changes Since Last with precise file paths and routes when the change
  is functionally in place.
- Keep Commit Messages prepared (subject/body/meta) for each logical change as
  soon as it’s ready to land.
- Maintain Open Items / Next Actions as a living checklist; exploratory notes
  can be captured in Work Log (mark as [provisional]) and migrated once settled.

Finish Thread
- Ensure Commit Messages reflect the final state.
- Ensure Open Items includes carry‑overs for the next thread.

Template — docs/agents/Handoff_{N}.md
```
Handoff {N}

Summary
- One paragraph framing what changed and why (agent‑oriented; terse).

Decisions (carried + new)
- Durable policies and approvals that remain in effect.

Changes Since Last
- Affects: <semicolon‑separated files>
- Routes: <semicolon‑separated routes>
- DB: <schema change? none>
- Flags: <feature flags? none>

Commit Messages (ready to paste)
<repeat per logical change>
Subject: type(scope): concise summary

Context:
- Why the change is needed.

Approach:
- How implemented (high‑level); mention guards, routes, UI files.

Impact:
- Behavior/perf/compat; user‑visible notes.

Tests:
- E2E/API notes; files/specs added or updated.

References:
- Links/paths (e.g., docs, issues, prior handoffs).

Meta:
- Affects: a;b;c
- Routes: x;y
- DB: none
- Flags: none

Commit:
- <commit-hash>
- Committed: <ISO8601 timestamp> (optional)

Git Commands (used when committing)
- git add <paths>
- git commit -m "<subject>" -m "<body>" -m "Meta: Affects: …" -m "Meta: Routes: …" -m "Meta: DB: …" -m "Meta: Flags: …"

Open Items / Next Actions
- [ ] Task …
- [ ] Task …

Work Log (optional, terse; reverse‑chronological)
- 2025‑MM‑DD HH:MMZ — Short note; files touched.
- 2025‑MM‑DD HH:MMZ — [provisional] Exploratory idea/attempt; outcome TBD.

Artifacts (optional)
- Report: reports/<suite_timestamp>/
- Screens: playwright-report/ (local only; not in Git)
```

Operational Notes
- Keep “Affects/Routes/DB/Flags” entries precise; these are optimized for machine parsing in later threads.
- Prefer multiple small Commit Messages over one large message covering unrelated changes.
- Use buffered semantic updates (post‑validation) to minimize context switching; during debugging, prefer the Work Log and migrate outcomes when validated.
- Do not commit from the agent by default; per AGENTS.md, provide the message + commands.

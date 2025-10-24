Start Here — Agent Bootstrap (Every New Thread)

Purpose
- Provide a single entry point so you (the agent) load the right operating rules and the most recent handoff, then create a new handoff for this thread. Cross‑thread coherence is the priority.

Step 1 — Load Operating Rules
- Read docs/agents/AGENTS.md
  - Permissions: local Git history (log/show/diff/blame) allowed; no destructive or remote Git ops without approval.
  - Commit policy: produce a multi‑line commit message (Conventional Commits + Meta), and list exact git add/commit commands instead of committing by default.
  - Testing practice: e2e/ structure, artifacts ignored, stable selectors.

Step 2 — Load Thread Continuity Rules
- Read docs/agents/Handoff.md (procedures for locating the latest handoff and creating the next one). Follow it literally.

Step 3 — Locate Latest Handoff_N and Create Handoff_{N+1}
- Find the highest N file in docs/agents/ named Handoff_*.md (zero‑padded numbers are common).
- Read it carefully for decisions, open items, and prepared commit messages.
- Create a new file docs/agents/Handoff_{N+1}.md using the template in Handoff.md.
- Keep Handoff_{N+1}.md up‑to‑date during this thread (decisions, changes, prepared commits, open items).

Notes
- Coherence first: Prefer capturing concise, machine‑scannable details (files, routes, DB notes, flags, commit message Meta) over human prose.
- Scope: Only touch files pertinent to the current task. Mention unrelated issues in Handoff_{N+1}.md Open Items if needed.
- Output: When you finish a task, include in Handoff_{N+1}.md a ready‑to‑paste commit message and explicit git commands, per AGENTS.md.
- Continuous doc refinement: If we find gaps or ambiguous phrasing in docs/agents/* during a thread, I will propose concrete edits and we will update those documents together to keep the operating rules clear and current.

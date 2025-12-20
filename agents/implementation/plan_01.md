# Implementation Plan: Refine Agent Workflow Docs

## 1. Overview
Goal: Refine the agent-facing instructions (handoff, implementation planning, git, DB access, and README maintenance) so they are consistent, low-friction, and aligned with the current Codex/CLI environment.

In scope:
- Updating agent entry-point behavior and triggers in `agents/README.md`.
- Clarifying and standardizing the handoff protocol and file naming.
- Streamlining implementation plan guidance and its interaction with Execution Mode.
- Completing and tightening the git + README update flow.
- Introducing explicit DB access guidance for agents.

Out of scope:
- Changing application code behavior (Node/TypeScript, DB migrations, etc.).
- Rewriting human-facing docs in `docs/` beyond what’s required to reflect agent-doc updates.
- Editing production infrastructure or deployment processes.

## 2. Step-by-Step Plan

1. Adjust entry-point reread behavior and triggers in `agents/README.md`  
   Status: Completed  
   Testing: After edits, reread `agents/README.md` and confirm that (a) it clearly distinguishes “new thread” vs “new user request” behavior, and (b) the Quick Trigger Index remains accurate and minimal.  
   Checkpoint: Wait for developer review/approval before proceeding.

2. Clarify handoff protocol and naming, including backlog pattern  
   Status: Completed  
   Testing: After updating `agents/README.md` and `agents/handoff_process.md`, verify that (a) instructions explicitly say “create the new handoff file at thread start, then only update on defined triggers,” (b) naming conventions for `Handoff_nn.md` are consistent across docs and directory, and (c) the “Priority Backlog” pattern (copied forward between handoff files) is briefly documented.  
   Checkpoint: Wait for developer review/approval before proceeding.

3. Streamline implementation plan guidance and align Execution Mode behavior  
   Status: Completed  
   Testing: Update `agents/implementation_planning.md` and, if needed, `agents/README.md` so that (a) there is a short TL;DR section summarizing how to create and track plans, (b) Execution Mode guidance matches the current environment (one step at a time, but with flexibility around pausing when the user or host requires), and (c) any mention of external plan-tracking tools (like `update_plan`) is clearly optional and kept in sync with on-disk plans.  
   Checkpoint: Wait for developer review/approval before proceeding.

4. Complete git instructions and connect them to README maintenance  
   Status: Completed  
   Testing: Extend `agents/git.md` so that (a) the “Trigger: Update Developer Documentation (README.md)” section explicitly points to `agents/readme_maintenance.md` with a concise checklist, and (b) commit behavior is documented as simple, standard Git usage (clear subject + optional short description) that aligns with the developer’s preference for the agent to create commits when explicitly requested, and (c) the commit + post-commit flow (handoff, plan status, README evaluation) is fully described end-to-end.  
   Checkpoint: Wait for developer review/approval before proceeding.

5. Add explicit DB access guidance and triggers for agents  
   Status: Completed  
   Testing: Create `agents/db_access.md` (or equivalent) and add a corresponding trigger in `agents/README.md` such that (a) agents know when to consult DB access guidance (migrations, schema changes, bulk data operations), (b) the guidance emphasizes non-production safety, idempotent migrations, and coordination with `/README.md` updates, and (c) the doc references any key existing DB design docs where appropriate (e.g., feeds/RBAC DB docs) without overloading the agent.  
   Checkpoint: Wait for developer review/approval before proceeding.

6. Tighten integration around developer README updates  
   Status: Completed  
   Testing: Review `agents/readme_maintenance.md`, `agents/git.md`, `agents/README.md`, and the root `README.md` to ensure that (a) the trigger chain after a commit clearly leads agents through README evaluation, (b) `/README.md` remains developer-facing and free of agent-internal process, and (c) no conflicting guidance exists about when or how to update the README.  
   Checkpoint: Wait for developer review/approval before proceeding.

## 3. Progress Tracking Notes

- Step 1 — Status: Completed (entry behavior and Quick Trigger usage updated in `agents/README.md`; “New thread” definition clarified).  
- Step 2 — Status: Completed (handoff naming standardized to `Handoff_nn.md`, create-vs-update rules clarified in `agents/README.md` and `agents/handoff_process.md`, and Priority Backlog pattern documented).  
- Step 3 — Status: Completed (TL;DR added to `agents/implementation_planning.md`, Execution Mode behavior aligned with host environment, and external plan tools documented as optional mirrors with the on-disk plan as source of truth).  
- Step 4 — Status: Completed (Git instructions simplified to standard subject/body commits, explicit “user requests commit” trigger added, and README update checklist wired into the post-commit flow referencing `agents/readme_maintenance.md`; Handoff template paths and commit-related notes aligned with this behavior).  
- Step 5 — Status: Completed (created `agents/db_access.md` documenting non-production assumptions, destructive vs allowed operations, migration workflow via `src/db.ts`, and mysql CLI guidelines; added DB access triggers to `agents/README.md` so agents consult this doc when changing schema or running significant SQL).  
- Step 6 — Status: Completed (verified that `agents/git.md` routes post-commit behavior through `agents/readme_maintenance.md`, `agents/README.md` references that flow via its Quick Trigger Index, and the root `README.md` remains purely developer-facing with no agent-internal process, with no conflicting guidance about when or how to update it).

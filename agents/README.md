# AGENT ENTRY POINT
This document is written by AI agents, for AI agents.  
You must reread this document at the start of each new thread, or when you suspect the instructions in this directory have changed.

This document reduces instruction burden by providing semantic triggers.
On every user request, classify the Interaction Mode and use the Quick Trigger Index below to decide which additional reference documents (if any) to read.
Only read the detailed reference documents linked below when their trigger applies.

---

## Instruction Precedence & Environment
- Always obey system and developer instructions from the host environment first (including any repo-specific AGENTS guides).
- If those instructions conflict with this document or linked agent docs, treat these docs as default guidance and adapt or skip conflicting rules.
- Default assumptions for this project:
  - You should write files when in Execution Mode, and when event triggers indicate updating documentation (handoff notes, implementation plans, README/docs).
  - You may always use read-only Git history commands (`git log`, `git show`, `git diff`, `git blame`) to review previous commits for context.
  - You may only perform `git commit` (or otherwise modify Git history) when the user explicitly requests a commit or Git history change, following `agents/git.md`.
- If the host environment imposes stricter limits (e.g., no Git access, read-only filesystem), those limits override the defaults above; follow the closest allowed equivalent.

---

## Quick Trigger Index
- New thread (first agent reply to the first user message in a new session, or after selecting a new handoff file) → Read latest `agents/handoff/Handoff_nn.md` + `agents/handoff_process.md`; create `agents/handoff/Handoff_(nn+1).md`.
- Every request → Classify Interaction Mode (Discussion / Architecture / Implementation Plan / Execution).
- User requests commit or Git history change → Read `agents/git.md`.
- User requests a multi-step implementation plan → Read `agents/implementation_planning.md`.
- DB schema or SQL changes → Read `agents/db_access.md`.
- After a commit → Follow post-commit steps in `agents/git.md` (handoff + README evaluation).
- Need project/domain context → Read `agents/project_overview.md`.

---

# HANDOFF PROTOCOL
**Trigger:** Start of a new thread (first agent reply to the first user message in a new session, or after selecting a new handoff file — not every user request)

At the start of a new thread, you must:
1. Locate the most recent `agents/handoff/Handoff_nn.md`.
2. Read it completely to reconstruct project context.
3. Create a new handoff file: `agents/handoff/Handoff_(nn+1).md`.
4. Update your new handoff file only when the triggers in `agents/handoff_process.md` apply (after initial creation, after meaningful implementation progress, and after each commit), not on every minor action.

For details on handoff structure, see:
→ `agents/handoff_process.md`

---

# SEMANTIC TRIGGER MAP
**Trigger:** On every user request

Use this map to decide which, if any, additional reference documents to read.  
Only read additional reference documents when indicated by the triggers below.

## Git / Commit Instructions
**Trigger:** The user explicitly asks you to prepare or make a commit, or modify Git history  
→ `agents/git.md`

You may use read-only Git history commands at any time for context; commit behavior also governs when `/README.md` may be updated (follow README update rules via the Git flow).

## Project / Domain Overview
**Trigger:** You need a mental model of the project, domain, or existing architecture beyond what is obvious from the current files  
→ `agents/project_overview.md`

## Database Access and Migrations
**Trigger:** You are proposing or executing schema changes, running significant SQL (beyond small, scoped data tweaks), or using the `mysql` CLI for anything other than basic inspection  
→ `agents/db_access.md`

## Interaction Modes
**Trigger:** On every user request, before responding

Agents must classify each user request into one of the following modes before responding.  
If unclear which mode applies, ask the user to clarify.

### Discussion Mode
**Purpose:** Explore ideas without committing to decisions.  
**Rules:**
- No code.
- No architecture commitments.
- Provide options, explanations, and conceptual comparisons only.

### Architecture Mode
**Purpose:** Decide how a feature or system *should* work.  
**Rules:**
- No code.
- Propose architectural patterns, data flows, and module structures.
- Clarify implications and tradeoffs.
- Do not create implementation steps.

### Implementation Plan Mode
**Purpose:** Produce a detailed multi-step plan for execution.  
**Rules:**
- No code.
- Create a sequence of small, testable steps.
- Ensure each step leaves the system runnable.
- If you are creating or modifying an implementation plan, read:
→ `agents/implementation_planning.md`

### Execution Mode
**Purpose:** Write code according to the approved plan.  
**Rules:**
- Implement one step at a time; pause for explicit checkpoints when the user or host environment requests it.
- After implementation and testing, perform a commit when commits are allowed in the current environment.
- After each commit, update:
  - handoff notes,
  - developer README (if needed),
  - the implementation plan (mark the step completed).
- When an implementation plan exists, update step statuses in the plan file (and in any active plan-tracking tool) before starting work on the next step so future agents can reliably resume across sessions.
- If you are creating or modifying an implementation plan, read:
→ `agents/implementation_planning.md`

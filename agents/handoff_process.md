# Handoff Process Guide  
This document describes how AI agents should create, update, and maintain
handoff files (`Handoff_nn.md`) to preserve project coherence across threads.
Handoff files are written for AI agents, not for the human developer.

---

# 1. Purpose of Handoff Notes  
Handoff notes are a private workspace for the agent.  
They should:

- Capture only the information needed for the next threadself.
- Omit user-facing explanations.
- Preserve decisions, outcomes, and reasoning that would otherwise be lost at the end of a thread.
- Provide continuity without overwhelming future agents with excess detail.

# 2. Creating and Updating Handoff Files  

## 2.1 Creating a New Handoff File (start of thread)
- At the start of a new thread (first agent reply to the first user message in a new session, or after selecting a new handoff file), you must:
  - Locate the most recent `Handoff_nn.md` in `agents/handoff/`.
  - Create the next file `Handoff_{n+1}.md` using the template in `agents/handoff/Handoff.md`.
  - Copy forward the Priority Backlog and any durable Decisions/Open Items from the previous handoff.

## 2.2 When to Update an Existing Handoff File  
You should update your current handoff file only during specific events:

### Update Trigger A: After Creating the File (start of thread)
Record:
- Thread purpose or focus.
- Relevant system state.
- Known issues carried over from previous threads.

### Update Trigger B: After Meaningful Implementation Progress
Add notes only when **real changes have been made to the project**, such as:
- Code added, modified, or refactored.
- Database schema updates.
- Architectural decisions that have been implemented.

### Update Trigger C: After Each Commit  
After executing a git commit, follow the post-commit checklist in `agents/git.md`
(see "Trigger: After a Commit").

When you update the handoff file as part of that checklist, ensure you:
- Append a brief summary of what changed and why.
- Include commit type, scope, and any relevant keywords.

Do **not** update the handoff file during:
- Ideation  
- Planning  
- Architectural brainstorming  
- High-level discussion  
- User clarifications  
- Testing steps before the final confirmed implementation  

---

# 3. Priority Backlog Pattern  

Each `Handoff_nn.md` file should begin with a Priority Backlog section that
captures durable refactor objectives and thread-spanning work items.

Priority Backlog:
- Lives at the top of every `Handoff_nn.md`.
- Is copied forward from `Handoff_n.md` to `Handoff_{n+1}.md` at the start of a new thread.
- Uses three tiers:
  - P1 (foundation, highest impact)
  - P2 (high-value follow-ups)
  - P3 (structural polish / future ideas)
- Contains concise checkbox items under each tier.

When maintaining the backlog:
- Update checkbox statuses as items are completed or re-scoped.
- Add new items sparingly and keep descriptions short.
- Use the backlog as the source for the “Thread Plan” subset inside each `Handoff_nn.md`.

---

# 4. Structure of Handoff Notes  
Each handoff file should contain:

## 3.1 Thread Summary  
- What this thread is doing.  
- Why it matters.  
- What was inherited from the previous handoff.

## 3.2 Implementation Notes  
Updates added only after actual changes or commits:
- What was modified.  
- Why it was modified.  
- Any follow-up tasks needed.  

## 3.3 Open Questions / Deferred Tasks  
List items that were raised in this thread but not resolved.

## 3.4 Suggestions for Next Threadself  
Concrete next steps, brief and actionable.

---

# 4. Writing Style  
Handoff notes should be:

- Concise  
- Bullet-oriented  
- Non-narrative  
- Machine-readable  
- Focused on continuity  

Avoid long paragraphs. Prioritize clarity over completeness.

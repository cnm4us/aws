# Developer README Maintenance Guide

This guide describes how to update the root `/README.md` for human developers.

## 1. When to Update `/README.md`

Update only after confirmed implementation changes that affect developer workflows:
- Added/changed/removed feature behavior developers must operate.
- API route behavior, parameters, or response shape changes.
- New endpoints.
- Build/start commands or environment variables.
- New scripts, tools, or operational workflows.
- DB changes developers need to understand.

Do not update `/README.md` for planning, ideation, or agent-only workflow changes.

## 2. Trigger: After a Commit

After a commit:
1. Review committed behavior.
2. Decide if `/README.md` is now outdated.
3. If yes, update only affected sections.
4. Keep updates concise and factual.

## 3. Writing Style

Prefer:
- concise bullets
- short command examples
- concrete route/env changes

Avoid:
- speculative content
- internal agent process commentary
- broad stylistic rewrites

## 4. Structure Rules

- Preserve existing heading structure unless a real structural change is needed.
- Add sections only for genuinely new operational functionality.
- Do not delete sections unless functionality was removed.

## 5. Coordination with Implementation Plans

- `/README.md` is for human developers.
- `agents/implementation/plan_NN.md` is for execution continuity.
- Keep both aligned, without duplicating long prose.

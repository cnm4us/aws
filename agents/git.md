# Git Commit Instructions

Within this project:
- You may always use read-only Git history commands (`git log`, `git show`, `git diff`, `git blame`) for context.
- You may only perform `git commit` (or otherwise modify Git history) when the user explicitly requests it.
- Do not run `git push`; the developer reviews and pushes.

## Trigger: When the User Requests a Commit

1. Review changes
- Inspect `git status` and `git diff` to confirm scope.

2. Stage files
- Add only files that belong to this logical commit.

3. Create commit
- Use `git commit -m "clear subject" [-m "short body"]`.

4. Report back
- Provide commit hash and included files.

## Trigger: After a Commit

Immediately after committing:

1. Update implementation continuity
- Update the active `agents/implementation/plan_NN.md`:
  - phase/step status
  - change log entry with commit SHA
  - validation notes and next action

2. Evaluate developer README updates
- Reread `agents/readme_maintenance.md`.
- Update `/README.md` only if developer-facing behavior/workflow changed.

Only confirmed, implemented behavior belongs in plan files and developer docs.

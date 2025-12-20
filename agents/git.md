# Git Commit Instructions

Within this project:
- You may always use read-only Git history commands (`git log`, `git show`,
  `git diff`, `git blame`) to review previous commits for context.
- You may only perform `git commit` (or otherwise modify Git history) when the
  user explicitly requests a commit or Git history change, as described in
  `agents/README.md`.

Commits should use a clear, concise subject line and, when helpful, a short
description in the body. Standard `git commit -m "subject" [-m "short body"]`
is sufficient; no custom Git commit template is required.

## Trigger: When the User Requests a Commit

When the developer says the project is ready for a commit or explicitly asks
you to create a commit:

1. Review changes
   - Inspect the current diff and status (for example, using `git status` and `git diff`) to understand which files belong in this logical commit.
2. Stage files
   - Add the appropriate files for this commit using `git add`.
3. Create the commit
   - Run `git commit -m "clear subject" [-m "short description of what changed and why"]`.
4. Report back
   - Inform the developer which files were included and provide the new commit hash.
5. Leave push to the developer
   - Do not run `git push`; the developer will review and push the commit.

## Trigger: After a Commit

Immediately after performing a commit, follow this post-commit checklist:

1. Handoff notes (and plan status)
   - Reread `agents/handoff_process.md`.
   - Update your current handoff file in `agents/handoff/` with:
     - A brief summary of what was committed
     - Why the change was made
     - Any follow-up tasks required
   - If there is an active implementation plan in `agents/implementation/plan_nn.md`,
     update the relevant step's status to reflect the completed work.

2. Developer README evaluation
   - Reread `agents/readme_maintenance.md`.
   - Decide whether the committed changes affect any information in `/README.md`.
   - If an update is required, edit `/README.md` following the guidance in `agents/readme_maintenance.md`.


Only implemented, confirmed changes should be recorded in handoff files,
implementation plans, and developer documentation. Planning, discussion, or
speculative ideas must NOT be added.

## Trigger: Update Developer Documentation (README.md)

When changes are committed that may affect developer-facing workflows,
environment setup, or APIs:

1. Reread `agents/readme_maintenance.md`.
2. Review the recent changes (and any associated handoff notes or plan updates).
3. Decide whether `/README.md` needs to be updated.
4. If it does, update `/README.md` concisely to reflect the current behavior,
   without rewriting unrelated sections.

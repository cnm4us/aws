# DB Access and Migrations Guide
This document explains how AI agents should interact with the database in this project, with an emphasis on safety, non‑production defaults, and repeatable migrations.

---

## 1. Scope and Environment Assumptions

- Assume the database is **non‑production** unless the developer explicitly states otherwise.
- Database connectivity and schema management are primarily handled via code in `src/db.ts` (for example, the `ensureSchema` function).
- The `schema_backups/` directory is **read-only reference**:
  - Do not apply SQL dumps from this folder or run `mysql < backup.sql` / `SOURCE backup.sql` unless the developer explicitly asks you to.
  - These backups exist for the developer to restore manually if needed.

---

## 2. When to Read This Document

Consult this guide when:
- Proposing or implementing **schema changes** (tables, columns, indexes, constraints).
- Drafting implementation plan steps that modify schema or perform bulk data operations.
- Running SQL that writes or deletes data beyond small, clearly scoped changes.
- Investigating DB issues where you might consider using the `mysql` CLI or altering schema.

---

## 3. Allowed Operations During Development

The following operations are generally safe during development, subject to the current implementation plan and user instructions:

- **Read-only inspection**
  - `SELECT`, `EXPLAIN`, `SHOW TABLES`, `DESCRIBE <table>`, `SHOW INDEX FROM <table>`.
- **Small, scoped data changes**
  - `INSERT`, `UPDATE`, `DELETE` with tight `WHERE` clauses and clearly limited impact (for example, seeding or adjusting a small set of rows).
- **Code-based migrations**
  - Additive, idempotent migrations expressed in `src/db.ts` (for example, `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`).

All such changes should be:
- Captured as steps in an implementation plan when they are part of a feature or refactor.
- Verified with targeted tests or manual checks where appropriate.

---

## 4. Destructive Operations (Require Explicit Approval)

The following categories are considered **destructive** and must not be executed without explicit confirmation from the developer, even if they appear in an implementation plan step:

- Dropping or truncating structures
  - `DROP DATABASE`, `DROP TABLE`, `DROP INDEX`
  - `ALTER TABLE ... DROP COLUMN`
  - `TRUNCATE TABLE`
- Broad data modifications
  - `DELETE FROM ...` without a tight `WHERE` clause
  - `UPDATE ...` without a tight `WHERE` clause
  - Any statement that can affect many rows unintentionally
- Applying backups or large scripts
  - `mysql < backup.sql`, `SOURCE backup.sql`

When a destructive change is needed:
- Include the exact SQL and rationale in the implementation plan step.
- Before executing, show the SQL to the developer and ask for a clear “yes, run this now” approval.

---

## 5. Schema Changes and Migrations (`src/db.ts`)

For schema evolution, prefer **code-based, idempotent migrations**:

- Use `src/db.ts` (for example, `ensureSchema`) as the canonical place for ongoing schema changes when feasible:
  - Add columns with `ALTER TABLE ... ADD COLUMN IF NOT EXISTS`.
  - Add indexes with `CREATE INDEX IF NOT EXISTS` or guarded `CREATE INDEX` inside `try/catch`.
  - Create new tables with `CREATE TABLE IF NOT EXISTS`.
- Avoid editing SQL dumps in `schema_backups/` to drive schema changes.

Workflow for schema changes:
- During **Implementation Plan Mode**:
  - Describe the intended schema changes in a dedicated step (DDL statements, expected impact, and testing plan).
- During **Execution Mode**:
  - Implement the changes in `src/db.ts` where possible, preserving idempotency.
  - Run the application (or a focused script) to apply `ensureSchema` and verify the resulting schema.
  - Use `mysql` CLI for verification (`DESCRIBE`, `SHOW CREATE TABLE`, targeted `SELECT`s), and only for direct DDL when code-based migration is not appropriate and the developer has approved.

Destructive schema changes (drop/truncate) always require explicit developer approval as described in Section 4.

---

## 6. Using the `mysql` CLI

During development, you may use the `mysql` CLI (for example, via `sudo mysql`) with these guidelines:

- Prefer read-only commands for inspection and debugging:
  - `SHOW DATABASES`, `SHOW TABLES`, `DESCRIBE`, `SELECT`, `EXPLAIN`.
- For data-modifying statements:
  - Ensure they are part of an approved implementation plan step.
  - Keep them narrowly scoped and clearly justified.
- For schema changes:
  - Prefer to apply them via `src/db.ts` as described above.
  - Only run DDL directly in `mysql` when the developer has explicitly approved the exact statements.

---

## 7. References

For deeper schema and domain details, consult:
- `docs/FeedsRBAC_DB.md` — RBAC and feed-related schema design and performance notes.
- `docs/RBAC_Implementation_Plan.md` — RBAC migration and rollout plan.
- `docs/Production_ULID_Implementation_Plan.md` — production ID/ULID migration considerations.
- `schema_backups/` — schema/data backups for manual restore by the developer (read-only for agents).


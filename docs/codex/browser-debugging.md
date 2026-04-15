# Codex Browser Debugging

This document describes the recommended setup for browser-driven debugging with Codex using the Chrome DevTools MCP server on the EC2 host.

## What This Enables

With Chromium plus the Chrome DevTools MCP server configured on the remote host, Codex can:

- launch a browser session on EC2
- open pages and navigate flows
- inspect console errors
- inspect network requests and responses
- inspect cookies, local storage, and session storage
- inspect rendered DOM state
- take screenshots during debugging

This is useful for:

- UI bugs
- failed form submissions
- JavaScript runtime errors
- request payload and response debugging
- state mismatch between frontend and backend

## Important Architecture Note

In this environment, Codex runs on the EC2 host through VS Code Remote SSH.

That means:

- VS Code runs on Windows
- the repo lives on EC2
- Codex runs on EC2
- Chromium for Codex debugging also runs on EC2

Codex does not inspect your personal Windows Chrome session. It controls a separate browser session on the EC2 host.

For most debugging work, that is the correct setup.

## Current Host Setup

The EC2 host is configured with:

- `chromium-browser`
- `chrome-devtools-mcp`
- Codex MCP server registration:
  - `chrome-devtools`

The installed MCP registration can be checked with:

```bash
codex mcp list
```

## Typical Workflow

When you want Codex to use the browser, ask explicitly. Start the prompt with language like:

- `Use Chrome DevTools to open https://aws.bawebtech.com and inspect the console.`
- `Use Chrome DevTools to reproduce the report modal submission bug.`
- `Use Chrome DevTools to log in as the moderation admin and inspect the failed POST request.`

The more specific the prompt, the faster the debugging loop.

## Recommended Input to Give Codex

For best results, provide:

- starting URL
- account to use
- exact flow to perform
- expected result
- actual result

Example:

```text
Use Chrome DevTools to debug the report flow.
Start at https://aws.bawebtech.com/login
Log in as the admin test user.
Open publication 130.
Click the report flag.
Expand the relevant user group.
Submit the report.
Expected: report succeeds.
Actual: UI shows submit failed.
```

## Test Accounts

Use dedicated non-production test accounts for browser debugging.

Recommended rules:

- do not use real user accounts
- do not commit passwords into git
- do not rely on personal accounts for repeatable debugging

Good options:

- seeded dev accounts with known passwords
- an untracked local credentials file
- a documented reset script for test users

Recommended untracked file pattern:

- `.codex-local/test-users.json`

Example structure:

```json
{
  "admin": {
    "email": "codex-admin@example.test",
    "password": "dev-only-password"
  },
  "moderator": {
    "email": "codex-moderator@example.test",
    "password": "dev-only-password"
  },
  "member": {
    "email": "codex-member@example.test",
    "password": "dev-only-password"
  }
}
```

Do not commit this file. If needed, commit only an example file such as:

- `.codex-local/test-users.example.json`

## UI Markup Guidance

You do not need to add special DOM IDs just so Codex can click things.

Codex can usually interact with pages using:

- button text
- input labels
- placeholders
- accessible names
- page structure

What helps most is good accessible UI:

- labels correctly associated with inputs
- buttons with visible text
- links with meaningful names
- consistent headings and page structure

## When `data-testid` Helps

Add `data-testid` only for difficult or ambiguous controls, such as:

- repeated icon-only buttons
- deeply nested identical controls
- dynamic controls with no stable label
- UI that changes text based on state

Do not add blanket test IDs everywhere by default.

## Authentication Guidance

Browser debugging works best when test accounts avoid friction such as:

- MFA
- email OTP
- CAPTCHA
- SSO-only login
- magic-link-only login

If any of those exist, a good dev/test setup usually provides one of:

- dedicated non-MFA test accounts
- a password login path for non-production
- a dev-only auth shortcut
- seeded cookies or sessions

## Data Setup Guidance

Repeatable browser debugging is much easier when:

- test data is seeded
- IDs or slugs are stable
- known spaces, publications, and moderation objects exist
- test users have predictable permissions

If a workflow depends on special state, document it near the feature or seed it automatically.

## Good Prompts for Browser Debugging

Examples:

```text
Use Chrome DevTools to open https://aws.bawebtech.com/admin/moderation/reports and check the console.
```

```text
Use Chrome DevTools to log in as the admin test user and inspect why the moderation signal save form is failing.
```

```text
Use Chrome DevTools to reproduce the report modal bug on publication 130 and inspect the failing network request.
```

## Limitations

Remember the browser runs on EC2, not on your local Windows machine.

So this setup will not automatically reproduce issues tied specifically to:

- your personal Chrome extensions
- your local Windows browser profile
- local desktop-only OS behavior
- a manually prepared local browser session

If a bug depends on one of those, document that explicitly in the request.

## Fast Checklist

Before asking Codex to debug in-browser, confirm:

- `codex mcp list` shows `chrome-devtools`
- the app is reachable from the EC2 host
- a test account exists
- the flow is described clearly
- expected and actual behavior are stated


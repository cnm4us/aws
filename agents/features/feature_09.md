High-Level Plan: Editable Pages & Versioned Rules System
1. Goals & Constraints
Primary Goals

Provide a simple, editor-friendly content system using a constrained Markdown format.

Convert Markdown to safe, server-rendered HTML.

Support permissions and visibility rules (public, authenticated, role-based).

Allow living documents (especially rules) with:

Immutable historical versions

Permanent links to specific versions

Accurate citation for moderation/sanctions

Constraints

Do not bloat the main SPA.

Pages system should be separable and evolvable.

URLs must remain stable and predictable.

Avoid future namespace collisions with application routes.

2. System Overview

The solution consists of two closely related but distinct subsystems:

Editable Pages System

Marketing, informational, and policy pages

Markdown-based editing

Server-rendered HTML

URL routing via /pages/* (with / as a special case)

Versioned Rules System

Rule documents treated as authoritative records

Explicit versioning

Immutable historical access

Permanent, citation-friendly URLs

Both systems share:

Markdown → HTML pipeline

Permissions model

Admin/editor UI patterns

3. Markdown Rendering Strategy
Markdown Characteristics

Intentionally limited and well-defined

Supports:

Headings

Lists

Links

Emphasis

Code blocks (optional)

No arbitrary HTML input from editors

Rendering Pipeline

Use a Node.js Markdown processor to:

Parse Markdown

Transform to HTML

Optionally sanitize output

Store:

Raw Markdown (source of truth)

Rendered HTML (for fast serving)

This allows:

Simple editing UX

Deterministic rendering

Future extensibility (plugins, annotations, anchors)

4. Editable Pages System
URL Strategy

/ → editable Home page (special reserved slug)

/pages/:slug → all other CMS-managed pages

Reserved Routes (Hard-Blocked)

Pages system must never allow slugs that collide with:

global-feed

channels

groups

users

admin

api

auth

login

logout

assets

static

Page Capabilities

Each page supports:

Slug (URL)

Title

Visibility:

Public

Authenticated users

Role-restricted

Layout type (static, marketing, SPA-embed)

Markdown content

Rendered HTML

Metadata (created, updated, editor)

Rendering Model

Server checks permissions before rendering

Pages are served as HTML

SPA is only loaded if explicitly required by layout

5. Rules & Living Documents System
Conceptual Model

Rules are authoritative documents that evolve over time but must remain citable exactly as they existed at a given moment.

Data Separation

Rule (master record)

Stable identity (slug)

Pointer to current version

Rule Version

Immutable snapshot

Incrementing version number

Markdown content

Rendered HTML

Creation metadata

URL Strategy

/rules/:slug → latest version

/rules/:slug/v:version → specific historical version

Key Properties

Historical versions are immutable

Sanctions reference rule + version

Old citations never break

Current rules can evolve safely

6. Versioning Workflow
Editing Rules

Editors never modify an existing version

Every change creates a new version

Version number auto-increments

Optional change summary / release note

Publishing

Latest version becomes the default

Previous versions remain accessible indefinitely

Rollback is implemented by pointing “current” to an older version (not deletion)

7. Admin / Editor UI (Shared Pattern)
Core Capabilities

Markdown editor with live preview

Metadata controls (visibility, roles, title)

Version history view (rules)

Read-only access to historical versions

Explicit creation of new versions

UX Philosophy

Small surface area

No WYSIWYG complexity

Markdown is the contract

Editors understand exactly what is being published

8. Permissions Model

Permissions are enforced server-side and apply uniformly to:

Pages

Rules

Rule versions

Visibility checks occur:

On request

Before rendering

Before serving HTML

No reliance on client-side guards for access control.

9. Non-Goals (Explicitly Out of Scope)

Full CMS with themes, plugins, or drag-and-drop builders

Client-side routing for pages

Inline arbitrary HTML editing

SPA hydration for static content

10. Expected Outcomes

This system should result in:

Clean separation between app and content

Stable, citation-safe rules enforcement

Minimal JavaScript footprint

Easy editorial updates

Long-term architectural flexibility
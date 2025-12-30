📄 Codex Instructions — Logo Configuration Page
Purpose

Design and implement a Logo Configuration feature that defines how a logo is applied to videos during production.
Logo configurations are reusable behavior presets, separate from logo assets and video assets.

This page must support:

Clear UX for non-technical users

Stable, reusable configuration objects

Clean mapping to AWS MediaConvert overlay parameters

Future extensibility (without schema regret)

Conceptual Model (Do Not Collapse These)

Codex must treat the following as distinct entities:

Logo (asset)

Image file only (PNG/JPG)

No positioning, timing, or behavior baked in

Logo Configuration (behavior)

Defines how a logo behaves when applied to a video

Reusable across many productions

Editable without modifying past productions

Production (composition)

Selects:

video

music (if any)

logo

logo configuration

Must not permanently override logo configuration defaults

Logo Configuration Page — UX Requirements
Core UX Goals

Users should understand this as “branding presets”

No exposure of MediaConvert terminology

No pixel math in the default UI

Visual preview is required (mock or simulated is acceptable)

Required Fields

Each logo configuration must include:

Name

Human-readable (e.g. “Standard watermark”, “Promo intro logo”)

Position

Top-left

Top-right

Bottom-left

Bottom-right

Center

Size

Relative size as percentage of video width

UX labels (e.g. Tiny / Small / Medium / Large)

Store numeric value

Opacity

0–100%

Default around 30–40%

Timing Rule

Entire video

Start after X seconds

First X seconds only

Last X seconds only

Fade Behavior

None

Fade in

Fade out

Fade in + out

UX Constraints

No raw pixel coordinates

No codec-level settings

No per-video permanent overrides on this page

Defaults must be pre-filled

Presets & Defaults

On first logo upload, automatically generate at least one configuration:

“Standard watermark”

Bottom-right

Small

~35% opacity

Entire video

No fade

Users may duplicate and edit configurations.

Data & Persistence Requirements
Logo Configuration Object

Must:

Belong to a user or channel

Be independently versionable in the future

Be safe to reuse across many productions

Not mutate automatically from production overrides

Codex should propose:

Table structure

Relationships to logos and productions

Soft delete or archival strategy

Production Integration Requirements

During video production, users must be able to:

Select:

1 logo

1 logo configuration

Preview the combined result

Override settings ephemerally (if allowed)

Overrides must not write back to the configuration

MediaConvert Mapping (High-Level Only)

Codex should:

Define a translation layer from logo configuration → MediaConvert input

Keep MediaConvert JSON isolated from UI logic

Avoid leaking MediaConvert field names into the database schema

Deliverables Codex Should Produce Next

Codex should respond with:

UX flow

Page layout

Interaction model

Preview behavior

DB schema

Tables

Key fields

Relationships

Backend logic

CRUD operations

Validation rules

Mapping layer to MediaConvert

Frontend component plan

Major components

State ownership

Reusability considerations

Non-Goals (Explicitly Out of Scope)

Multi-logo overlays

Animated logos

Video-specific permanent branding rules

DRM or forensic watermarking
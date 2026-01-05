📽️ Lower Thirds System — High-Level Implementation Plan
1. Objective

Implement a system-managed, SVG-based Lower Thirds feature that allows users to:

Select from predefined lower third templates

Customize text and colors via a dynamic UI

See a live, in-browser preview of the lower third

Attach the configured lower third to a video for server-side rendering (FFmpeg pipeline handled elsewhere)

The system must be:

Parametric

Resolution-independent

Deterministic (preview == render)

Easily extensible with new templates

2. Core Design Principle

Each Lower Third Template is defined by two canonical assets:

SVG Markup

Defines visual structure only

No baked-in content

Uses stable element IDs

Declarative, renderer-safe SVG

Configuration Descriptor (JSON)

Defines what is editable

Drives UI generation

Provides defaults & constraints

Acts as the contract between UI and SVG

The SVG describes what exists.
The descriptor describes what can change.

3. Data Model (System Lower Third Record)

Each system lower third record includes:

{
  "id": "lt_modern_gradient_01",
  "label": "Modern Gradient",
  "category": "clean",
  "svgMarkup": "<svg>...</svg>",
  "configDescriptor": { ... },
  "version": 1
}

Notes

SVG and descriptor are versioned together

Existing rendered videos always reference a specific version

SVG IDs referenced in the descriptor must remain stable per version

4. SVG Authoring Rules (Critical)

All SVG templates must follow these rules:

Structure

Fixed viewBox (e.g. 0 0 1920 200)

No embedded JavaScript

No external font URLs at runtime

No complex filters or masks

Editability via IDs

Editable elements must have IDs matching descriptor keys:

<text id="primaryText" />
<text id="secondaryText" />
<rect id="baseBg" />
<rect id="gradientOverlay" />

Gradient Pattern (Standardized)

Use a two-layer approach:

Solid base rectangle

Single-color → transparent gradient overlay

This enables:

Simple UI (two color pickers)

Rich visual effect

Renderer-safe output

5. Configuration Descriptor Specification

The configuration descriptor defines editable controls.

Example Descriptor
{
  "fields": [
    { "id": "primaryText", "label": "Name", "type": "text", "maxLength": 40 },
    { "id": "secondaryText", "label": "Title", "type": "text", "maxLength": 60 }
  ],
  "colors": [
    { "id": "baseBg", "label": "Background Color" },
    { "id": "gradientColor", "label": "Fade Color" }
  ],
  "defaults": {
    "primaryText": "Jane Doe",
    "secondaryText": "Senior Correspondent",
    "baseBg": "#111111",
    "gradientColor": "#ffcc00"
  }
}

Purpose

Drives dynamic form generation

Enforces validation and limits

Allows different templates to expose different controls

Keeps UI logic generic and reusable

6. Frontend Architecture (Live Preview)
Rendering Strategy

SVGs are rendered inline in the DOM, inside a React-controlled <div>

React does not manage SVG internals

SVG is treated as an opaque payload string

<div dangerouslySetInnerHTML={{ __html: svgMarkup }} />

Update Flow

Load SVG markup as string

Parse with DOMParser

Apply user parameters:

Update text node contents

Update fill, stop-color, font-family, etc.

Serialize SVG back to string

Re-inject into preview container

Preview SVG must be the same SVG used for final render.

7. Dynamic UI Generation

The UI must be schema-driven, not template-specific.

Behavior

When a template is selected:

Read its configuration descriptor

Generate inputs dynamically:

Text fields

Color pickers

(Optional) font selectors

Bind inputs directly to parameter state

Any change triggers a preview re-render

React must support:

Different numbers of fields per template

Templates with no text or no colors

Future extensibility without UI refactors

8. Preview Environment

Preview is shown in a video-aspect container (e.g. 16:9)

SVG is positioned as if overlaid on video

Optional CSS animation may simulate entry/exit

Preview-only

No coupling to FFmpeg timing

9. Backend Responsibilities (Non-FFmpeg)

The Node.js backend provides:

List of available lower third templates

SVG + descriptor payloads

Validation of submitted configurations

Generation of a finalized SVG (with parameters applied) for rendering

FFmpeg orchestration occurs downstream and consumes:

Fully resolved SVG

Timing metadata (handled elsewhere)

10. Versioning & Immutability Rules

Once a lower third version is used to render a video:

SVG and descriptor are immutable

Changes require:

New template version

New ID or version number

This guarantees:

Render reproducibility

Preview/render fidelity

No breaking changes to existing videos

11. Future-Ready Extensions (Out of Scope, Supported)

This architecture supports:

Premium template packs

User-uploaded templates (with validation)

Preset saving

Profile-driven auto-fill

Animated lower thirds

Marketplace distribution

No structural changes required.

12. Success Criteria

Users can configure and preview lower thirds in real time

Preview output matches final rendered video

Adding a new lower third requires:

SVG + descriptor only

No UI code changes for new templates

SVGs render reliably through the video pipeline
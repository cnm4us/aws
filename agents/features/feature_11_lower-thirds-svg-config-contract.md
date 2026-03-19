Lower Thirds System — SVG + Config Contract (Codex Summary)
Purpose

This system defines a parametric lower-thirds pipeline using:

SVG templates (visual + structural truth)

JSON config files (user intent + editability)

A generic renderer that applies config → SVG via selectors

The goal is to support:

Arbitrary lower-third designs

Dynamic UI generation

Live preview and deterministic video rendering

Zero template-specific code in the renderer

Core Design Principles (Do Not Violate)

SVG describes structure, not UI

Config describes user intent, not SVG internals

Renderer is generic and selector-based

Defaults are layered
user value → config default → SVG fallback

Never mutate <style> at runtime

Never hard-code SVG IDs in renderer logic

1️⃣ SVG Authoring Rules
1. Text Content

All editable text MUST have a unique id

Text is edited via textContent

<text id="headlineText">HEADLINE</text>
<text id="showNameText">SHOW NAME</text>
<text id="dateTimeText">DATE</text>

2. Configurable Colors

Configurable colors MUST be expressed as element attributes

Not inside <style>

<polygon
  id="backgroundColor"
  fill="#d62222"
/>

3. Semantic Grouping (Critical)

Use data-role for semantic intent

Renderer binds using CSS selectors, not IDs

<linearGradient id="fadeOverlay" data-role="fade">
  <stop offset="0%" stop-color="#000" stop-opacity="1"/>
  <stop offset="25%" stop-color="#000" stop-opacity="0"/>
  <stop offset="75%" stop-color="#000" stop-opacity="0"/>
  <stop offset="100%" stop-color="#000" stop-opacity="1"/>
</linearGradient>

<polygon
  data-role="fadeOverlay"
  fill="url(#fadeOverlay)"
/>


Meaning:

One conceptual fade color

Any number of gradient stops

Opacity is structural; color is configurable

4. <style> Block Rules

Allowed:

Font family

Font weight

Baseline font sizes

Not allowed:

User-editable colors

Runtime-mutated values

Semantic meaning

.st0, .st1 {
  font-family: ArialNarrow-Bold, Arial;
  font-weight: 700;
}

2️⃣ Config File Format

Each SVG has a matching JSON config that defines:

User-visible parameters

Defaults

How parameters bind to SVG nodes

Example: lower-third.config.json
{
  "templateId": "lower-third-gradient-banner-v1",
  "version": 1,

  "params": {
    "headlineText": {
      "type": "text",
      "label": "Headline",
      "maxLength": 140,
      "default": "HEADLINE GOES HERE"
    },
    "showNameText": {
      "type": "text",
      "label": "Show Name",
      "maxLength": 40,
      "default": "SHOW NAME"
    },
    "dateTimeText": {
      "type": "text",
      "label": "Date",
      "maxLength": 30,
      "default": "January 1, 2026"
    },
    "backgroundColor": {
      "type": "color",
      "label": "Background Color",
      "default": "#d62222"
    },
    "fadeColor": {
      "type": "color",
      "label": "Fade Color",
      "default": "#000000"
    }
  },

  "bindings": [
    {
      "param": "headlineText",
      "selector": "#headLineText",
      "attributes": {
        "textContent": "{value}"
      }
    },
    {
      "param": "showNameText",
      "selector": "#showNameText",
      "attributes": {
        "textContent": "{value}"
      }
    },
    {
      "param": "dateTimeText",
      "selector": "#dateTimeText",
      "attributes": {
        "textContent": "{value}"
      }
    },
    {
      "param": "backgroundColor",
      "selector": "#backgroundColor",
      "attributes": {
        "fill": "{value}"
      }
    },
    {
      "param": "fadeColor",
      "selector": "linearGradient[data-role='fade'] stop",
      "attributes": {
        "stop-color": "{value}"
      }
    }
  ]
}

3️⃣ Binding Semantics (Renderer Contract)

Bindings are declarative.

Each binding says:

“Take the value of param,
find all nodes matching selector,
and apply these attribute mutations.”

Renderer behavior (pseudocode)
for (const binding of config.bindings) {
  const value =
    userParams[binding.param] ??
    config.params[binding.param]?.default;

  if (value == null) continue;

  svg.querySelectorAll(binding.selector).forEach(node => {
    for (const [attr, template] of Object.entries(binding.attributes)) {
      if (attr === "textContent") {
        node.textContent = value;
      } else {
        node.setAttribute(attr, template.replace("{value}", value));
      }
    }
  });
}

4️⃣ Default & Fallback Rules

SVG must always render standalone

All attributes required for rendering must exist

Config defaults override SVG

User input overrides config

Never rely on “missing attributes” behaving well.

5️⃣ Explicit Non-Goals (Do NOT Implement)

❌ Editing <style> at runtime

❌ Encoding arrays or structure in SVG IDs

❌ Hard-coding IDs in renderer

❌ One-off template logic

❌ CSS parsing or mutation

6️⃣ What This Enables

With this contract, the system supports:

Arbitrary SVG layouts

Different numbers of fields per template

Rich gradients with simple UI

Safe live previews

Deterministic FFmpeg rendering

Adding templates without code changes

Final Note for Codex

Treat SVGs as declarative layout + structure.
Treat configs as intent + mapping.
Renderer logic must remain dumb, generic, and reusable.

If a new template follows these rules, no renderer changes should be required.

# EXAMPLE TEMPLATE IN SYSTEM


<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" version="1.1" xmlns:xlink="http://www.w3.org/1999/xlink" viewBox="0 0 880 300">
  <!-- Generator: Adobe Illustrator 29.8.4, SVG Export Plug-In . SVG Version: 2.1.1 Build 6)  -->
  <defs>
    <style>

      .st0, .st1, .st2 {
        font-family: ArialNarrow-Bold, Arial;
        font-weight: 700;
      }
    </style>
    <linearGradient id="fadeOverlay" data-role="fade" x1="453.47" y1="180.87" x2="453.47" y2="75.53" gradientUnits="userSpaceOnUse">
	  <stop offset="0" stop-color="#000"  stop-opacity="1"/>
      <stop offset=".1" stop-color="#000"  stop-opacity=".5"/>
	  <stop offset=".25" stop-color="#000" stop-opacity="0"/>
      <stop offset=".75" stop-color="#000" stop-opacity="0"/>
      <stop offset=".9" stop-color="#000" stop-opacity=".5"/>
	  <stop offset="1" stop-color="#000" stop-opacity="1"/>
    </linearGradient>
  </defs>
  <g id="BackgroundColor">
    <polygon id="backgroundColor" label="Background Color" fill="#d62222" points="783.39 180.87 34.55 180.87 123.55 75.53 872.39 75.53 783.39 180.87"/>
  </g>
  <g>
    <polygon data-role="fadeOverlay"  fill="url(#fadeOverlay)" points="783.39 180.87 34.55 180.87 123.55 75.53 872.39 75.53 783.39 180.87"/>
  </g>
  <g>
    <polygon points="272.71 94.2 34.55 94.2 65.55 56.86 303.71 56.86 272.71 94.2"/>
  </g>
  <g>
    <text id="showNameText" label="Show Name" fill="#fff" font-size="18px" class="st1" transform="translate(73.56 84.8)">JUSTICE MATTERS</text>
  </g>
  <g>
    <polygon points="841.39 199.54 603.24 199.54 634.24 162.2 872.39 162.2 841.39 199.54"/>
  </g>
  <g>
    <text id="dateTimeText" label="Date" font-size="18px" fill="#969696" class="st2" transform="translate(658.31 189.02)">January 5, 2026</text>
  </g>
  <g>
    <text id="headLineText" fill="#fff" font-size="22px" label="Headline Text" class="st0" transform="translate(123.1 134.82)">Trump Kidnaps Maduro and wife, seizing Venezuelan Oil Industry</text>
  </g>
</svg>

# EXAMPLE CONFIG FILE IN SYSTEM

{
  "params": {
    "headlineText": {
      "type": "text",
      "label": "Headline",
      "maxLength": 140,
      "default": "HEADLINE GOES HERE"
    },
    "showNameText": {
      "type": "text",
      "label": "Show Name",
      "maxLength": 40,
      "default": "SHOW NAME"
    },
    "dateTimeText": {
      "type": "text",
      "label": "Date",
      "maxLength": 30,
      "default": "January 1, 2026"
    },

    "backgroundColor": {
      "type": "color",
      "label": "Background Color",
      "default": "#d62222"
    },

    "fadeColor": {
      "type": "color",
      "label": "Fade Color",
      "default": "#000000"
    }
  },

  "bindings": [
    {
      "param": "headlineText",
      "selector": "#headLineText",
      "attributes": {
        "textContent": "{value}"
      }
    },
    {
      "param": "showNameText",
      "selector": "#showNameText",
      "attributes": {
        "textContent": "{value}"
      }
    },
    {
      "param": "dateTimeText",
      "selector": "#dateTimeText",
      "attributes": {
        "textContent": "{value}"
      }
    },

    {
      "param": "backgroundColor",
      "selector": "#backgroundColor",
      "attributes": {
        "fill": "{value}"
      }
    },

    {
      "param": "fadeColor",
      "selector": "linearGradient[data-role='fade'] stop",
      "attributes": {
        "stop-color": "{value}"
      }
    }
  ]
}

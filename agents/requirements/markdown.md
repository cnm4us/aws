o ambiguity.

Markdown Feature Contract (Pages & Rules System)
Supported Markdown Features
Headings

Syntax: #, ##, ###

Allowed levels: H1–H3 only

H1: document title

H2–H3: sections and subsections

Automatic, stable anchor IDs generated from heading text

Paragraphs

Plain text paragraphs

Standard Markdown line break behavior

No inline HTML

Lists

Unordered lists using - or *

Ordered lists using 1., 2., etc.

Nested lists allowed (reasonable depth)

Emphasis

Italic: *text*

Bold: **text**

No underline or strikethrough

Links

Syntax: [label](url)

URLs must be absolute (https://…) or site-relative

Rendered links must include:

rel="noopener noreferrer nofollow"

Raw HTML links are not allowed

Blockquotes

Syntax: > quoted text

Intended for clarifications, notes, or non-binding commentary

Code Blocks

Fenced code blocks only using triple backticks

Optional language tag allowed

Inline code allowed using single backticks

No HTML execution or scripting

Horizontal Rules

Syntax: ---

Used to visually separate major sections

Tables (Optional / Controlled)

GitHub-flavored Markdown tables

Simple row/column structure only

No nested content inside cells

Enabled only if explicitly configured

Rendering Behavior

Markdown is parsed server-side

HTML output is sanitized

Raw HTML in Markdown input is stripped or rejected

Both raw Markdown and rendered HTML are stored

Rendering output must be deterministic

Disallowed Features

Raw HTML (<div>, <img>, <script>, etc.)

Inline styles or CSS

Images

Iframes or embeds

JavaScript execution

Emoji shortcodes

Footnotes

Custom Markdown extensions beyond those listed

Usage Scope

This Markdown feature set applies to:

CMS-managed pages

Rules and policy documents

All versioned rule content

Any content outside this contract must be implemented via:

Layout logic

Application code

Explicit feature extensions (not ad hoc Markdown)
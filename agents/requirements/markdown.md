# Markdown Requirement

This document defines the allowed Markdown feature set for pages and rules content.

## Supported Features
- Headings: `#`, `##`, `###` (H1-H3 only).
- Paragraphs: standard Markdown paragraphs.
- Lists: ordered and unordered; nested lists allowed with reasonable depth.
- Emphasis: italic (`*text*`) and bold (`**text**`).
- Links: `[label](url)` with absolute `https://...` or site-relative targets.
- Blockquotes: `> quote`.
- Code: fenced code blocks and inline code.
- Horizontal rule: `---`.
- Tables: GitHub-flavored tables only when explicitly enabled.

## Rendering Rules
- Markdown is parsed server-side.
- Output HTML is sanitized.
- Raw HTML in Markdown input is stripped or rejected.
- Both source Markdown and rendered HTML are stored.
- Rendering must be deterministic.

## Link Safety
- Rendered links must include `rel="noopener noreferrer nofollow"`.

## Disallowed Features
- Raw HTML (`<div>`, `<img>`, `<script>`, etc.).
- Inline CSS/styles.
- Images via Markdown syntax.
- Iframes/embeds.
- JavaScript execution.
- Emoji shortcodes.
- Footnotes.
- Custom Markdown extensions not listed above.

## Scope
- CMS-managed pages.
- Rules and policy documents.
- Versioned rule content.

Anything outside this contract must be implemented in application code, not via ad-hoc Markdown extensions.

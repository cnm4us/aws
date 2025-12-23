// Markdown rendering utility for Pages & Rules system.
// Implements the restricted feature set defined in agents/requirements/markdown.md.

export type RenderedHeading = {
  level: 1 | 2 | 3;
  text: string;
  id: string;
};

export type MarkdownRenderResult = {
  html: string;
  headings: RenderedHeading[];
};

type RenderState = {
  inCodeBlock: boolean;
  codeLang: string | null;
  inUl: boolean;
  inOl: boolean;
  inBlockquote: boolean;
  pendingListClose: string | null;
};

function escapeHtml(text: string): string {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function slugifyHeading(text: string): string {
  const base = text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return base || 'section';
}

function isAllowedLinkHref(href: string): boolean {
  if (!href) return false;
  if (href.startsWith('https://')) return true;
  if (href.startsWith('/')) return true;
  return false;
}

function renderInline(text: string): string {
  // Process inline code first
  const parts: string[] = [];
  let i = 0;
  let inCode = false;
  let buf = '';

  const flush = () => {
    if (!buf) return;
    if (inCode) {
      parts.push('<code>' + escapeHtml(buf) + '</code>');
    } else {
      parts.push(renderInlineNonCode(buf));
    }
    buf = '';
  };

  while (i < text.length) {
    const ch = text[i];
    if (ch === '`') {
      flush();
      inCode = !inCode;
      i += 1;
      continue;
    }
    buf += ch;
    i += 1;
  }
  flush();

  // If we ended while "inCode" is true, treat backticks as literal
  if (inCode) {
    return escapeHtml(text);
  }

  return parts.join('');
}

function renderInlineNonCode(text: string): string {
  // Escape first; we will unwrap portions for emphasis/links via re-escaping.
  let working = escapeHtml(text);

  // Links: [label](url)
  working = working.replace(
    /\[([^\]]+)]\(([^)]+)\)/g,
    (_m, label: string, href: string) => {
      const cleanHref = href.trim();
      if (!isAllowedLinkHref(cleanHref)) {
        // Fallback to plain text
        return escapeHtml(label) + ' (' + escapeHtml(cleanHref) + ')';
      }
      return `<a href="${escapeHtml(cleanHref)}" rel="noopener noreferrer nofollow">${escapeHtml(label)}</a>`;
    }
  );

  // Bold: **text**
  working = working.replace(
    /\*\*([^*]+)\*\*/g,
    (_m, inner: string) => `<strong>${inner}</strong>`
  );

  // Italic: *text*
  working = working.replace(
    /(^|[\s(])\*([^*]+)\*([)\s.,!?]|$)/g,
    (m: string, before: string, inner: string, after: string) =>
      `${before}<em>${inner}</em>${after}`
  );

  return working;
}

export function renderMarkdown(source: string): MarkdownRenderResult {
  const lines = String(source || '').replace(/\r\n/g, '\n').split('\n');
  const out: string[] = [];
  const headings: RenderedHeading[] = [];
  const headingIdCounts: Record<string, number> = {};

  const state: RenderState = {
    inCodeBlock: false,
    codeLang: null,
    inUl: false,
    inOl: false,
    inBlockquote: false,
    pendingListClose: null,
  };

  const closeLists = () => {
    if (state.inUl) {
      out.push('</ul>');
      state.inUl = false;
    }
    if (state.inOl) {
      out.push('</ol>');
      state.inOl = false;
    }
    state.pendingListClose = null;
  };

  const closeBlockquote = () => {
    if (state.inBlockquote) {
      out.push('</blockquote>');
      state.inBlockquote = false;
    }
  };

  for (let idx = 0; idx < lines.length; idx += 1) {
    const rawLine = lines[idx];

    // Code fences
    if (/^```/.test(rawLine)) {
      if (!state.inCodeBlock) {
        closeLists();
        closeBlockquote();
        const m = rawLine.match(/^```(\w+)?/);
        state.inCodeBlock = true;
        state.codeLang = m && m[1] ? m[1] : null;
        const cls = state.codeLang ? ` class="lang-${escapeHtml(state.codeLang)}"` : '';
        out.push(`<pre><code${cls}>`);
      } else {
        out.push('</code></pre>');
        state.inCodeBlock = false;
        state.codeLang = null;
      }
      continue;
    }

    if (state.inCodeBlock) {
      out.push(escapeHtml(rawLine) + '\n');
      continue;
    }

    const line = rawLine.replace(/\s+$/, '');

    // Horizontal rule
    if (/^-{3,}\s*$/.test(line)) {
      closeLists();
      closeBlockquote();
      out.push('<hr />');
      continue;
    }

    // Headings
    const hMatch = line.match(/^(#{1,3})\s+(.*)$/);
    if (hMatch) {
      closeLists();
      closeBlockquote();
      const level = hMatch[1].length as 1 | 2 | 3;
      const text = hMatch[2].trim();
      const baseId = slugifyHeading(text);
      const count = headingIdCounts[baseId] || 0;
      headingIdCounts[baseId] = count + 1;
      const id = count === 0 ? baseId : `${baseId}-${count + 1}`;
      headings.push({ level, text, id });
      out.push(`<h${level} id="${id}">${renderInline(text)}</h${level}>`);
      continue;
    }

    // Blockquotes
    if (/^>\s?/.test(line)) {
      closeLists();
      if (!state.inBlockquote) {
        state.inBlockquote = true;
        out.push('<blockquote>');
      }
      const content = line.replace(/^>\s?/, '');
      out.push(`<p>${renderInline(content)}</p>`);
      continue;
    } else {
      closeBlockquote();
    }

    // Lists
    const ulMatch = line.match(/^(\s*)[-*]\s+(.*)$/);
    const olMatch = line.match(/^(\s*)\d+\.\s+(.*)$/);
    if (ulMatch || olMatch) {
      const isOrdered = !!olMatch;
      const content = isOrdered ? olMatch![2] : ulMatch![2];
      if (isOrdered) {
        if (!state.inOl) {
          closeLists();
          state.inOl = true;
          out.push('<ol>');
        }
      } else {
        if (!state.inUl) {
          closeLists();
          state.inUl = true;
          out.push('<ul>');
        }
      }
      out.push(`<li>${renderInline(content)}</li>`);
      continue;
    } else {
      closeLists();
    }

    // Blank line → paragraph break
    if (!line.trim()) {
      // explicit paragraph breaks handled implicitly by closing blocks; nothing to emit
      continue;
    }

    // Paragraph
    out.push(`<p>${renderInline(line)}</p>`);
  }

  // Close any remaining blocks
  if (state.inCodeBlock) {
    out.push('</code></pre>');
  }
  closeLists();
  closeBlockquote();

  return { html: out.join('\n'), headings };
}


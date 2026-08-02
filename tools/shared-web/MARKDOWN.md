# Shared Markdown Renderer

`browser/markdown.js` is the authoritative Markdown renderer for Session Browser and Task Browser.

```js
import { renderMarkdown } from '/shared/browser/markdown.js';

const html = renderMarkdown(markdown, {
  headingOffset: 0,
  renderCodeBlock: ({ languageHtml, codeHtml }) => `<pre><code>${codeHtml}</code></pre>`,
});
```

The renderer is pure and key-free: its output depends only on its arguments, and it emits no IDs or state keys. `headingOffset` lets a containing UI preserve its document hierarchy. The optional code-block adapter receives escaped strings so a tool can add presentation such as Session Browser's copy control without owning fence parsing or handling untrusted source text.

## Supported subset

- ATX headings
- paragraphs and hard line breaks within a prose block
- strong text, emphasis, and inline code
- HTTP(S) links opened with `noreferrer`
- unordered and ordered lists, including indented continuation lines
- blockquotes
- fenced code blocks, including indented fences whose container indentation is removed while deeper code indentation is preserved
- horizontal rules
- tables with column alignment and pipes inside inline code

Raw HTML remains text. Non-HTTP(S) Markdown links remain text. This is intentionally a bounded repository renderer, not a CommonMark or GFM implementation.

Shared structural CSS lives in `markdown.css`; each tool keeps its color, spacing, and typography overrides scoped under `.markdown-body`.

## Version decision

This extraction ships in framework `0.21.0`, Session Browser `1.8.0`, and Task Browser `1.6.0`, matching the release's existing version decisions. The public framework `VERSION` and README badge already read `0.21.0`, so they require no further bump.

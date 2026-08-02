import { renderMarkdown as renderSharedMarkdown } from '/shared/browser/markdown.js';

export function renderMarkdown(markdown) {
  return renderSharedMarkdown(markdown, {
    renderCodeBlock: ({ languageHtml, codeHtml }) => `
      <div class="code-block">
        <div class="code-block-header"><span>${languageHtml || 'code'}</span><button type="button" class="copy-code">Copy</button></div>
        <pre><code>${codeHtml}</code></pre>
      </div>
    `,
  });
}

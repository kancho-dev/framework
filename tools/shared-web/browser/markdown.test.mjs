import assert from 'node:assert/strict';
import test from 'node:test';
import { renderMarkdown } from './markdown.js';

test('escapes raw HTML and only activates HTTP(S) links', () => {
  const html = renderMarkdown('<img src=x onerror=alert(1)> [bad](javascript:alert(1)) [good](https://example.com?a=1&b=2)');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.match(html, /\[bad\]\(javascript:alert\(1\)\)/);
  assert.match(html, /href="https:\/\/example\.com\?a=1&amp;b=2"/);
  assert.doesNotMatch(html, /<img|href="javascript:/);
});

test('renders headings and inline formatting with a configurable heading offset', () => {
  assert.equal(renderMarkdown('# A **bold** _word_ and `code`', { headingOffset: 1 }), '<h2>A <strong>bold</strong> <em>word</em> and <code>code</code></h2>');
});

test('separates adjacent prose, lists, headings, rules, and indented continuations', () => {
  const html = renderMarkdown('Intro\n- first\n  continued\n- second\n## Next\n---\nDone');
  assert.equal(html, '<p>Intro</p><ul><li>first continued</li><li>second</li></ul><h2>Next</h2><hr><p>Done</p>');
});

test('renders ordered lists and blockquotes', () => {
  assert.equal(renderMarkdown('1. one\n2) two\n\n> quoted\n> again'), '<ol><li>one</li><li>two</li></ol><blockquote>quoted<br>again</blockquote>');
});

test('keeps mixed nested lists inside one ordered sequence', () => {
  const source = '1. Prepare\n   - first check\n   - second check\n1. Execute\n   - verify result\n1. Finish';
  assert.equal(
    renderMarkdown(source),
    '<ol><li>Prepare<ul><li>first check</li><li>second check</li></ul></li><li>Execute<ul><li>verify result</li></ul></li><li>Finish</li></ol>',
  );
});

test('keeps a loose mixed list in one ordered sequence', () => {
  const source = '1. Remove unused helpers:\n   - first helper\n   - second helper\n\n2. Add independent tests for:\n   - bookmark\n   - tags\n   - saved topics';
  assert.equal(
    renderMarkdown(source),
    '<ol><li>Remove unused helpers:<ul><li>first helper</li><li>second helper</li></ul></li><li>Add independent tests for:<ul><li>bookmark</li><li>tags</li><li>saved topics</li></ul></li></ol>',
  );
});

test('renders fenced code safely, including indented fences, and supports a presentation adapter', () => {
  const source = '```js\nconst value = "<unsafe>";\n```';
  assert.equal(renderMarkdown(source), '<pre><code>const value = &quot;&lt;unsafe&gt;&quot;;</code></pre>');
  assert.equal(renderMarkdown('  ```js\n  aligned();\n    deliberatelyIndented();\n  ```'), '<pre><code>aligned();\n  deliberatelyIndented();</code></pre>');
  assert.equal(renderMarkdown(source, { renderCodeBlock: ({ languageHtml, codeHtml }) => `[${languageHtml}:${codeHtml}]` }), '[js:const value = &quot;&lt;unsafe&gt;&quot;;]');
});

test('renders aligned tables and preserves pipes inside inline code', () => {
  const html = renderMarkdown('| Name | Value | End |\n| :--- | :---: | ---: |\n| A | `x | y` | 2 |');
  assert.match(html, /<th class="align-left">Name<\/th>/);
  assert.match(html, /<th class="align-center">Value<\/th>/);
  assert.match(html, /<td class="align-center"><code>x \| y<\/code><\/td>/);
  assert.match(html, /<td class="align-right">2<\/td>/);
});

test('handles malformed and empty input without producing active content', () => {
  assert.equal(renderMarkdown(''), '');
  assert.equal(renderMarkdown(null), '');
  assert.equal(renderMarkdown('```\n<open fence>'), '<pre><code>&lt;open fence&gt;</code></pre>');
  assert.equal(renderMarkdown('| not | a table |\n| -- | nope |'), '<p>| not | a table |<br>| -- | nope |</p>');
});

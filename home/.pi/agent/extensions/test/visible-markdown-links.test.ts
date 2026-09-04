import assert from "node:assert/strict";
import test from "node:test";
import { showMarkdownLinkUrls } from "../visible-markdown-links.ts";

test("shows the URL after a labeled external link", () => {
  assert.equal(
    showMarkdownLinkUrls("Read [Pi documentation](https://pi.dev/docs)."),
    "Read [Pi documentation](https://pi.dev/docs) (<https://pi.dev/docs>).",
  );
});

test("does not duplicate a URL used as the label", () => {
  assert.equal(showMarkdownLinkUrls("[https://pi.dev](https://pi.dev)"), "[https://pi.dev](https://pi.dev)");
  assert.equal(
    showMarkdownLinkUrls("[**https://pi.dev**](https://pi.dev)"),
    "[**https://pi.dev**](https://pi.dev)",
  );
});

test("preserves titles and punctuation in destinations", () => {
  assert.equal(
    showMarkdownLinkUrls('[example](https://example.com/a_(b) "title with )")'),
    '[example](https://example.com/a_(b) "title with )") (<https://example.com/a_(b)>)',
  );
  assert.equal(
    showMarkdownLinkUrls("[article](https://example.com/what's-new)"),
    "[article](https://example.com/what's-new) (<https://example.com/what's-new>)",
  );
});

test("does not change images, inline code, fenced code, or incomplete streaming links", () => {
  const markdown = [
    "![logo](https://example.com/logo.png)",
    "`[inline](https://example.com/inline)`",
    "```markdown",
    "[fenced](https://example.com/fenced)",
    "```not-a-closing-fence",
    "[still fenced](https://example.com/still-fenced)",
    "```",
    "> ```markdown",
    "> [quoted fence](https://example.com/quoted)",
    "> ```",
    "- ```markdown",
    "  [list fence](https://example.com/list)",
    "  ```",
    "[partial](https://example.com",
  ].join("\n");

  assert.equal(showMarkdownLinkUrls(markdown), markdown);
});

test("maps repeated link text to occurrences outside code", () => {
  const source = [
    "- ```markdown",
    "  [same](https://example.com/same)",
    "  ```",
    "`[same](https://example.com/same)`",
    "[same](https://example.com/same)",
  ].join("\n");
  const expected = [
    "- ```markdown",
    "  [same](https://example.com/same)",
    "  ```",
    "`[same](https://example.com/same)`",
    "[same](https://example.com/same) (<https://example.com/same>)",
  ].join("\n");
  assert.equal(showMarkdownLinkUrls(source), expected);
});

test("ends an unclosed list fence when its list container ends", () => {
  const source = "- ```markdown\n  code\n\noutside [link](https://example.com)";
  assert.equal(
    showMarkdownLinkUrls(source),
    "- ```markdown\n  code\n\noutside [link](https://example.com) (<https://example.com>)",
  );
});

test("does not treat a fence marker in indented code as an opening fence", () => {
  const source = [
    "    ```markdown",
    "    [same](https://example.com/same)",
    "[same](https://example.com/same)",
  ].join("\n");
  const expected = [
    "    ```markdown",
    "    [same](https://example.com/same)",
    "[same](https://example.com/same) (<https://example.com/same>)",
  ].join("\n");
  assert.equal(showMarkdownLinkUrls(source), expected);
});

test("shows full, collapsed, and shortcut reference link URLs", () => {
  const source = [
    "[full][pi] [collapsed][] [shortcut]",
    "",
    "[pi]: https://pi.dev/docs",
    "[collapsed]: <https://example.com/collapsed>",
    "[shortcut]: https://example.com/shortcut \"title\"",
  ].join("\n");
  const expected = [
    "[full][pi] (<https://pi.dev/docs>) [collapsed][] (<https://example.com/collapsed>) [shortcut] (<https://example.com/shortcut>)",
    "",
    "[pi]: https://pi.dev/docs",
    "[collapsed]: <https://example.com/collapsed>",
    "[shortcut]: https://example.com/shortcut \"title\"",
  ].join("\n");

  assert.equal(showMarkdownLinkUrls(source), expected);
});

test("uses the first duplicate reference definition", () => {
  const source = [
    "[link][id]",
    "",
    "[id]: https://first.example",
    "[id]: https://second.example",
  ].join("\n");
  assert.equal(
    showMarkdownLinkUrls(source),
    "[link][id] (<https://first.example>)\n\n[id]: https://first.example\n[id]: https://second.example",
  );
});

test("shows reference links inside block quotes", () => {
  const source = "> [link][id]\n>\n> [id]: https://example.com";
  assert.equal(
    showMarkdownLinkUrls(source),
    "> [link][id] (<https://example.com>)\n>\n> [id]: https://example.com",
  );
});

test("shows the URL for a multiline labeled link", () => {
  assert.equal(
    showMarkdownLinkUrls("[Pi\n documentation](https://pi.dev/docs)"),
    "[Pi\n documentation](https://pi.dev/docs) (<https://pi.dev/docs>)",
  );
});

test("does not add mailto targets to visible email autolinks", () => {
  assert.equal(
    showMarkdownLinkUrls("<person@example.com> and person@example.com"),
    "<person@example.com> and person@example.com",
  );
});

test("does not modify link-like text in LaTeX", () => {
  const source = [
    "$\\text{[docs](https://example.com)}$",
    "$$\n\\text{[block](https://example.com/block)}\n$$",
  ].join("\n");
  assert.equal(showMarkdownLinkUrls(source), source);
});

test("does not modify link-like text in container LaTeX blocks", () => {
  for (const source of [
    "> $$\n> \\text{[docs](https://example.com)}\n> $$",
    "- $$\n  \\text{[docs](https://example.com)}\n  $$",
  ]) {
    assert.equal(showMarkdownLinkUrls(source), source);
  }
});

test("shows links inside dollar text that Pi rejects as LaTeX", () => {
  assert.equal(
    showMarkdownLinkUrls("$[docs](https://example.com)$2"),
    "$[docs](https://example.com) (<https://example.com>)$2",
  );
  assert.equal(
    showMarkdownLinkUrls("text $$\n[docs](https://example.com)\n$$"),
    "text $$\n[docs](https://example.com) (<https://example.com>)\n$$",
  );
});

test("does not modify a nested link in image alt text", () => {
  const source = "![[same](https://example.com)](https://img.example/image.png)";
  assert.equal(showMarkdownLinkUrls(source), source);
});

test("treats a link after an escaped image marker as a link", () => {
  assert.equal(
    showMarkdownLinkUrls("\\![link](https://example.com)"),
    "\\![link](https://example.com) (<https://example.com>)",
  );
});

test("supports multiple links and remains idempotent", () => {
  const source = "[one](https://one.example) and [two](mailto:two@example.com)";
  const expected =
    "[one](https://one.example) (<https://one.example>) and [two](mailto:two@example.com) (<mailto:two@example.com>)";
  assert.equal(showMarkdownLinkUrls(source), expected);
  assert.equal(showMarkdownLinkUrls(expected), expected);
});

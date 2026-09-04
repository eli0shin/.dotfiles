import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Marked, type Token, type Tokens } from "marked";

const EXTERNAL_URL = /^[A-Za-z][A-Za-z\d+.-]*:/;
const markdownParser = new Marked();

type Fence = {
  marker: string;
  length: number;
  quoteDepth: number;
  continuationIndent: number;
};

type LinkToken = Tokens.Link & { raw: string };

type Range = { start: number; end: number };

function isEscaped(text: string, index: number): boolean {
  let backslashes = 0;
  for (let cursor = index - 1; cursor >= 0 && text[cursor] === "\\"; cursor -= 1) backslashes += 1;
  return backslashes % 2 === 1;
}

function stripBlockQuotePrefix(line: string, count?: number): { content: string; depth: number } {
  let content = line;
  let depth = 0;
  while (count === undefined || depth < count) {
    const match = /^ {0,3}>[ \t]?/.exec(content);
    if (!match) break;
    content = content.slice(match[0].length);
    depth += 1;
  }
  return { content, depth };
}

function stripContinuationIndent(line: string, width: number): string | undefined {
  let columns = 0;
  let index = 0;
  while (index < line.length && columns < width) {
    if (line[index] === " ") columns += 1;
    else if (line[index] === "\t") columns += 4 - (columns % 4);
    else break;
    index += 1;
  }
  return columns >= width ? line.slice(index) : undefined;
}

function findFenceOpening(line: string): Omit<Fence, "quoteDepth"> | undefined {
  const topLevel = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line);
  const listItem = /^( {0,3})(?:[-+*]|\d{1,9}[.)])([ \t]+)( {0,3})(`{3,}|~{3,})(.*)$/.exec(line);
  const markerRun = topLevel?.[1] ?? listItem?.[4];
  const info = topLevel?.[2] ?? listItem?.[5];
  if (!markerRun || info === undefined) return undefined;
  if (markerRun[0] === "`" && info.includes("`")) return undefined;
  return {
    marker: markerRun[0],
    length: markerRun.length,
    continuationIndent: listItem ? listItem[0].indexOf(markerRun) : 0,
  };
}

function fencedCodeRanges(markdown: string): Range[] {
  const lines = markdown.split("\n");
  const ranges: Range[] = [];
  let fence: Fence | undefined;
  let fenceStart = 0;
  let offset = 0;

  for (const line of lines) {
    if (fence) {
      const quoted = stripBlockQuotePrefix(line, fence.quoteDepth);
      if (quoted.depth < fence.quoteDepth) {
        ranges.push({ start: fenceStart, end: offset });
        fence = undefined;
      } else {
        const content = stripContinuationIndent(quoted.content, fence.continuationIndent);
        if (content === undefined && quoted.content.trim()) {
          ranges.push({ start: fenceStart, end: offset });
          fence = undefined;
        } else {
          if (content !== undefined) {
            const close = new RegExp(`^ {0,3}${fence.marker}{${fence.length},}[ \\t]*$`);
            if (close.test(content)) {
              ranges.push({ start: fenceStart, end: offset + line.length });
              fence = undefined;
            }
          }
          offset += line.length + 1;
          continue;
        }
      }
    }

    const quoted = stripBlockQuotePrefix(line);
    const opening = findFenceOpening(quoted.content);
    if (opening) {
      fence = { ...opening, quoteDepth: quoted.depth };
      fenceStart = offset;
    }
    offset += line.length + 1;
  }

  if (fence) ranges.push({ start: fenceStart, end: markdown.length });
  return ranges;
}

function isInRange(index: number, ranges: readonly Range[]): boolean {
  return ranges.some((range) => index >= range.start && index < range.end);
}

function inlineCodeRanges(markdown: string, fencedRanges: readonly Range[]): Range[] {
  const ranges: Range[] = [];
  for (let index = 0; index < markdown.length; index += 1) {
    if (markdown[index] !== "`" || isInRange(index, fencedRanges)) continue;
    let length = 1;
    while (markdown[index + length] === "`") length += 1;
    const delimiter = "`".repeat(length);
    let close = markdown.indexOf(delimiter, index + length);
    while (close !== -1 && (markdown[close - 1] === "`" || markdown[close + length] === "`")) {
      close = markdown.indexOf(delimiter, close + length);
    }
    if (close === -1) {
      index += length - 1;
      continue;
    }
    ranges.push({ start: index, end: close + length });
    index = close + length - 1;
  }
  return ranges;
}

function latexRanges(markdown: string, protectedRanges: readonly Range[]): Range[] {
  const ranges: Range[] = [];
  const delimiters = [
    { open: "$$", close: "$$" },
    { open: "\\[", close: "\\]" },
    { open: "\\(", close: "\\)" },
    { open: "$", close: "$" },
  ];

  for (let index = 0; index < markdown.length; index += 1) {
    if (isInRange(index, protectedRanges)) continue;
    const delimiter = delimiters.find(({ open }) => markdown.startsWith(open, index));
    if (!delimiter || (delimiter.open === "$" && /\s/.test(markdown[index + 1] ?? ""))) continue;
    let close = markdown.indexOf(delimiter.close, index + delimiter.open.length);
    while (close !== -1 && isEscaped(markdown, close)) {
      close = markdown.indexOf(delimiter.close, close + delimiter.close.length);
    }
    if (close === -1) continue;
    const body = markdown.slice(index + delimiter.open.length, close);
    const after = markdown.slice(close + delimiter.close.length);
    const lineStart = markdown.lastIndexOf("\n", index - 1) + 1;
    const linePrefix = markdown.slice(lineStart, index);
    const blockContainer = /^(?: {0,3}>[ \t]?)*(?: {0,3}(?:[-+*]|\d{1,9}[.)])[ \t]+)? {0,3}$/;
    const isBlock =
      (delimiter.open === "$$" || delimiter.open === "\\[") &&
      blockContainer.test(linePrefix) &&
      /^[ \t]*(?:\n|$)/.test(after);
    const ambiguousDollar =
      delimiter.open === "$" &&
      (/\s$/.test(body) ||
        /^\d/.test(after) ||
        (/^[A-Z_][A-Z0-9_]*(?:[^A-Za-z0-9_\s])?$/.test(body) && /^[A-Za-z_][A-Za-z0-9_]*/.test(after)) ||
        body.includes("`"));
    if (!body || (body.includes("\n") && !isBlock) || ambiguousDollar) continue;
    ranges.push({ start: index, end: close + delimiter.close.length });
    index = close + delimiter.close.length - 1;
  }
  return ranges;
}

function collectLinkTokens(value: unknown, links: LinkToken[]): void {
  if (Array.isArray(value)) {
    for (const item of value) collectLinkTokens(item, links);
    return;
  }
  if (!value || typeof value !== "object") return;

  const token = value as Partial<Token> & Record<string, unknown>;
  if (token.type === "image") return;
  if (token.type === "link") {
    links.push(token as LinkToken);
    return;
  }
  for (const [key, child] of Object.entries(token)) {
    if (key !== "raw" && key !== "text") collectLinkTokens(child, links);
  }
}

function plainLinkText(tokens: readonly Token[]): string {
  let text = "";
  for (const token of tokens) {
    if ("tokens" in token && Array.isArray(token.tokens)) text += plainLinkText(token.tokens);
    else if (token.type === "br") text += "\n";
    else if ("text" in token && typeof token.text === "string") text += token.text;
  }
  return text;
}

function parseMarkdown(markdown: string): { links: LinkToken[]; indentedCode: Range[] } {
  const links: LinkToken[] = [];
  const indentedCode: Range[] = [];
  const tokens = markdownParser.lexer(markdown);
  let offset = 0;

  for (const token of tokens) {
    const position = markdown.indexOf(token.raw, offset);
    if (position === -1) continue;
    if (token.type === "code" && token.codeBlockStyle === "indented") {
      indentedCode.push({ start: position, end: position + token.raw.length });
    }
    offset = position + token.raw.length;
  }

  collectLinkTokens(tokens, links);
  return { links, indentedCode };
}

function findTokenPosition(
  markdown: string,
  raw: string,
  from: number,
  protectedRanges: readonly Range[],
): number | undefined {
  let position = markdown.indexOf(raw, from);
  while (position !== -1) {
    const isImage = markdown[position - 1] === "!" && !isEscaped(markdown, position - 1);
    if (!isImage && !isInRange(position, protectedRanges)) return position;
    position = markdown.indexOf(raw, position + 1);
  }
  return undefined;
}

function visibleUrlSuffix(url: string): string {
  return ` (<${url}>)`;
}

export function showMarkdownLinkUrls(markdown: string): string {
  let parsed: { links: LinkToken[]; indentedCode: Range[] };
  try {
    parsed = parseMarkdown(markdown);
  } catch {
    return markdown;
  }

  const fencedRanges = fencedCodeRanges(markdown);
  const codeRanges = [
    ...fencedRanges,
    ...parsed.indentedCode,
    ...inlineCodeRanges(markdown, fencedRanges),
  ];
  const protectedRanges = [...codeRanges, ...latexRanges(markdown, codeRanges)];
  let output = "";
  let sourceCursor = 0;

  for (const link of parsed.links) {
    const position = findTokenPosition(markdown, link.raw, sourceCursor, protectedRanges);
    if (position === undefined) continue;

    const end = position + link.raw.length;
    output += markdown.slice(sourceCursor, end);
    sourceCursor = end;

    const suffix = visibleUrlSuffix(link.href);
    const comparableHref = link.href.startsWith("mailto:") ? link.href.slice(7) : link.href;
    const label = plainLinkText(link.tokens ?? []);
    if (
      EXTERNAL_URL.test(link.href) &&
      label !== link.href &&
      label !== comparableHref &&
      !/[<>\s]/.test(link.href) &&
      !markdown.startsWith(suffix, sourceCursor)
    ) {
      output += suffix;
    }
  }

  return output + markdown.slice(sourceCursor);
}

export default function visibleMarkdownLinks(pi: ExtensionAPI): void {
  pi.registerMarkdownTransformer((markdown, { messageType }) =>
    messageType === "assistant" ? showMarkdownLinkUrls(markdown) : markdown,
  );
}

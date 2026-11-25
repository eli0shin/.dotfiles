// What a Cmd-click on a file path opens, kept free of the herdr module so
// tests can call it.
//
// Locally, Herdr resolves the clicked text before the handler sees it: a
// relative path against the live folder of what runs in the clicked pane, `~/`
// and `$HOME`. `path` is null when no such file exists here. A `:42`, `:42:7`,
// `:10-20` or `#L42` after the path becomes `link.line` and `link.column`
// (Herdr 0.1.18), even when `path` is null.
//
// In a pane on another machine `path` is always null, so the mod resolves the
// same spellings there itself (remoteLookup), against the folder the core
// reports for that pane.

// The files Neovim edits: ones without an extension (Makefile, Dockerfile,
// .gitignore), and the document types ~/.local/bin/install-neovim-app gives
// the Neovim app (CFBundleTypeExtensions). Everything else keeps the system's
// opener. tests/herdr-app-nvim-links.mjs keeps the two lists equal.
export const NEOVIM_EXTENSIONS = new Set([
  "txt", "text", "md", "markdown", "json", "jsonc", "yaml", "yml", "toml", "xml", "csv", "log",
  "conf", "config", "ini", "env", "c", "h", "cc", "cpp", "hpp", "m", "mm", "swift", "go", "rs",
  "py", "rb", "php", "java", "kt", "kts", "scala", "js", "jsx", "ts", "tsx", "vue", "svelte",
  "sh", "bash", "zsh", "fish", "lua", "vim", "sql", "html", "htm", "css", "scss", "sass", "less",
]);

/** Whether Neovim is the editor for the file at `path`: no extension, or one on the list. */
export function isNeovimFile(path) {
  // A leading dot starts a name (.gitignore), not an extension.
  const name = path.slice(path.lastIndexOf("/") + 1).replace(/^\.+/, "");
  const dot = name.lastIndexOf(".");
  return dot < 0 || NEOVIM_EXTENSIONS.has(name.slice(dot + 1).toLowerCase());
}

// `5`, `5-12` or `5-L12`, as Herdr reads a line range (links::line_range):
// the start parses as a Rust NonZeroU32 (an optional `+`, 1 to 4294967295),
// the end is digits after an optional `L`.
function isLineRange(text) {
  const dash = text.indexOf("-");
  const start = dash < 0 ? text : text.slice(0, dash);
  const end = dash < 0 ? "1" : text.slice(dash + 1).replace(/^L/, "");
  if (!/^\d+$/.test(end) || !/^\+?\d+$/.test(start)) return false;
  const n = Number(start.replace(/^\+/, ""));
  return n >= 1 && n <= 4294967295;
}

/** `raw` without the place after the path, as Herdr strips it for a remote click (links::without_suffix). */
export function bareSpelling(raw) {
  const text = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  const anchor = text.lastIndexOf("#L");
  if (anchor >= 0 && isLineRange(text.slice(anchor + 2))) return text.slice(0, anchor);
  const colon = text.lastIndexOf(":");
  if (colon >= 0 && text.slice(colon + 1).includes("-") && isLineRange(text.slice(colon + 1))) return text.slice(0, colon);
  let bare = text;
  for (let i = 0; i < 2; i++) {
    const m = bare.match(/:(\d+)$/);
    if (!m) break;
    bare = bare.slice(0, -m[0].length);
  }
  return bare;
}

/** The place Herdr read from the click, or null. */
function placeOf(link) {
  return link.line ? { line: link.line, ...(link.column ? { col: link.column } : {}) } : null;
}

function plan(path, place, pane) {
  if (!isNeovimFile(path)) return null;
  const at = !place ? [] : place.col ? [`+call cursor(${place.line}, ${place.col})`] : [`+${place.line}`];
  return { path, pane, argv: ["nvim", ...at, "--", path] };
}

/** `{path, pane, argv}` to open a local click in Neovim beside the clicked pane, or null to let Herdr open it. */
export function planOpen({ link, source }) {
  if (link.kind !== "file" || source.machine || !link.path) return null;
  return plan(link.path, placeOf(link), source.pane);
}

// Resolves each spelling as Herdr does locally and prints the first regular
// file: `<index>\t<path>`. A relative spelling needs the pane's folder.
// Never evaluates the clicked text: a leading `$NAME` is read with printenv.
const FIND = [
  'cwd=$1; shift; i=0',
  'for p in "$@"; do',
  '  case $p in',
  '    "~/"*) p="$HOME/${p#\\~/}" ;;',
  "    '$'*)",
  '      name=${p#?}; name=${name%%/*}; rest=${p#?"$name"}',
  '      case $name in',
  "        ''|[!A-Za-z_]*|*[!A-Za-z0-9_]*) p= ;;",
  '        PWD) p=${cwd:+$cwd$rest} ;;',
  '        *) value=$(printenv "$name") && [ -n "$value" ] && p=$value$rest || p= ;;',
  '      esac ;;',
  '    /*) ;;',
  '    *) p="${cwd:+$cwd/$p}" ;;',
  '  esac',
  `  if [ -n "$p" ] && [ -f "$p" ]; then printf '%s\\t%s\\n' "$i" "$p"; exit 0; fi`,
  '  i=$((i + 1))',
  'done',
  'exit 1',
].join("\n");

/**
 * For a click in a pane on another machine: `{machine, args, candidates}` to run
 * `sh` there with, or null when there's nothing to look up. `candidates[i]` is
 * the place in the file for the spelling at index i.
 */
export function remoteLookup({ link, source }) {
  if (link.kind !== "file" || !source.machine) return null;
  if (/^file:/i.test(link.raw)) {
    const path = fileUriPath(link.raw);
    return path && { machine: source.machine, args: ["-c", FIND, "sh", source.cwd ?? "", path], candidates: [null] };
  }
  // The literal spelling first: a file really named `notes:42` wins.
  const bare = bareSpelling(link.raw);
  const spellings = [link.raw];
  const places = [null];
  if (bare !== link.raw) {
    spellings.push(bare);
    places.push(placeOf(link));
  }
  return { machine: source.machine, args: ["-c", FIND, "sh", source.cwd ?? "", ...spellings], candidates: places };
}

/** The path a `file:` URI names on its own machine (no host, or localhost), as Herdr reads it; else null. */
export function fileUriPath(raw) {
  let rest = raw.slice("file:".length).split(/[?#]/)[0];
  if (rest.startsWith("//")) {
    const slash = rest.indexOf("/", 2);
    const host = rest.slice(2, slash < 0 ? rest.length : slash);
    if (host && host.toLowerCase() !== "localhost") return null;
    rest = slash < 0 ? "" : rest.slice(slash);
  }
  if (!rest.startsWith("/")) return null;
  try {
    return decodeURIComponent(rest);
  } catch {
    return null;
  }
}

/** What `sh` printed for a remoteLookup, as `{path, pane, argv}` or null. */
export function planRemote(click, lookup, stdout) {
  const m = stdout.match(/^(\d+)\t(.+)\n?$/);
  if (!m) return null;
  return plan(m[2], lookup.candidates[Number(m[1])] ?? null, click.source.pane);
}

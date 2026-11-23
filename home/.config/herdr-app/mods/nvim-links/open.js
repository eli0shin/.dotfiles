// What a Cmd-click on a file path opens, kept free of the herdr module so
// tests can call it.
//
// Locally, Herdr resolves the clicked text before the handler sees it: a
// relative path against the live folder of what runs in the clicked pane, `~/`
// and `$HOME`, and a `:42` or `:42:7` place in the file, which it drops from
// `path` but keeps in `raw`. `path` is null when no such file exists here.
//
// In a pane on another machine `path` is always null, so the mod resolves the
// same spellings there itself (remoteLookup), against the folder the core
// reports for that pane.

// Files Neovim shouldn't open: the system's opener (Preview, QuickTime) does better.
const NOT_TEXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|heic|svgz|pdf|mp[34]|m4[av]|mov|mkv|webm|avi|wav|flac|ogg|zip|t?gz|tar|bz2|xz|7z|dmg|pkg)$/i;

/** `raw` without a sentence's period and a `:42` or `:42:7` place, and that place (or null). */
export function splitPlace(raw) {
  const text = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  const m = text.match(/:(\d+)(?::(\d+))?$/);
  if (!m) return { bare: text, place: null };
  return { bare: text.slice(0, -m[0].length), place: { line: Number(m[1]), ...(m[2] ? { col: Number(m[2]) } : {}) } };
}

/** The place `raw` names in the file at `path`, or null when it's part of the file's name. */
export function placeIn(raw, path) {
  const { bare, place } = splitPlace(raw);
  if (!place || path.endsWith(raw.slice(bare.length).replace(/\.$/, ""))) return null;
  return place;
}

function plan(path, place, pane) {
  if (NOT_TEXT.test(path)) return null;
  const at = !place ? [] : place.col ? [`+call cursor(${place.line}, ${place.col})`] : [`+${place.line}`];
  return { path, pane, argv: ["nvim", ...at, "--", path] };
}

/** `{path, pane, argv}` to open a local click in Neovim beside the clicked pane, or null to let Herdr open it. */
export function planOpen({ link, source }) {
  if (link.kind !== "file" || source.machine || !link.path) return null;
  return plan(link.path, placeIn(link.raw, link.path), source.pane);
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
  const { bare, place } = splitPlace(link.raw);
  const spellings = [link.raw];
  const places = [null];
  if (bare !== link.raw) {
    spellings.push(bare);
    places.push(place);
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

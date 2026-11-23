// What a Cmd-click on a file path opens, kept free of the herdr module so
// tests can call it.
//
// Herdr resolves the clicked text before the handler sees it: a relative path
// against the live folder of what runs in the clicked pane, `~/` and `$HOME`,
// and a `:42` or `:42:7` place in the file, which it drops from `path` but
// keeps in `raw`. `path` is null when no such file exists here, or when the
// pane is on another machine.

// Files Neovim shouldn't open: macOS's own opener (Preview, QuickTime) does better.
const NOT_TEXT = /\.(png|jpe?g|gif|webp|bmp|tiff?|ico|heic|svgz|pdf|mp[34]|m4[av]|mov|mkv|webm|avi|wav|flac|ogg|zip|t?gz|tar|bz2|xz|7z|dmg|pkg)$/i;

/** The place `raw` names in the file: `{line, col?}`, or null. */
export function placeIn(raw, path) {
  const text = raw.endsWith(".") ? raw.slice(0, -1) : raw;
  const m = text.match(/:(\d+)(?::(\d+))?$/);
  // A file whose name really ends in `:42` keeps it in `path`.
  if (!m || path.endsWith(m[0])) return null;
  return { line: Number(m[1]), ...(m[2] ? { col: Number(m[2]) } : {}) };
}

/** `{path, pane, argv}` to open in Neovim beside the clicked pane, or null to let Herdr open it. */
export function planOpen({ link, source }) {
  if (link.kind !== "file" || source.machine || !link.path) return null;
  if (NOT_TEXT.test(link.path)) return null;
  const place = placeIn(link.raw, link.path);
  const at = !place ? [] : place.col ? [`+call cursor(${place.line}, ${place.col})`] : [`+${place.line}`];
  return { path: link.path, pane: source.pane, argv: ["nvim", ...at, "--", link.path] };
}

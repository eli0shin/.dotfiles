// Copy mode's state machine, kept free of the herdr module so tests can drive it.
//
// The mod keeps its own cursor and works every motion out itself: run() only
// queues a command, so its result can't be read back before the next key.
// Herdr's selection commands are predictable enough for that (checked against
// 0.1.16): moves stop silently at the edges, up/down keep the column,
// line_start/line_end go to the first and last column, home/end to the first
// and last cell, and adjust_selection scrolls the view to follow the moving end.
// ^ and $ need the row's text, which mods can't read: a line selection there
// (Ghostty's select-line trims leading and trailing blanks; a blank row selects
// nothing) gives where it starts and ends, so those keys ask main.js to measure.

const NAMED = new Set(["escape", "enter", "up", "down", "left", "right", "pageup", "pagedown", "home", "end", "space"]);

/** A key event as one name: "j", "G", "$", "ctrl-d", "escape". Null for keys copy mode ignores. */
export function keyName(e) {
  const m = e.modifiers ?? {};
  if (m.platform) return `cmd-${e.key}`;
  if (m.control) return `ctrl-${e.key}`;
  if (m.alt) return null;
  if (NAMED.has(e.key)) return e.key;
  return e.key_char || (m.shift ? e.key.toUpperCase() : e.key);
}

const MODES = { normal: "COPY", char: "VISUAL", line: "VISUAL LINE" };

/**
 * terminal: its address. run(name, args): herdr's run. geometry(): { cols, total,
 * offset, len, scrolls }: rows count from the oldest history row, as selections do.
 */
export function createCopyMode({ terminal, run, geometry }) {
  let mode = "normal";
  let pos = null; // the cursor: the selection's moving end
  let want = 0; // the column j/k aim for
  let end = null; // where the selection's moving end is now
  let anchor = null; // where a visual selection started

  const call = (name, args = {}) => run(name, { terminal, ...args });
  const adjust = (direction, times = 1) => {
    for (let i = 0; i < times; i++) call("terminal.adjust_selection", { direction });
  };

  // Moves the selection's end from `end` to `to`. Steps stay inside the grid,
  // so each one moves exactly one cell and `end` stays true.
  function moveEnd(to, g) {
    const rows = to.row - end.row;
    if (to.row === 0 && Math.abs(rows) > g.len) {
      adjust("home");
      end = { row: 0, col: 0 };
    } else if (to.row === g.total - 1 && Math.abs(rows) > g.len) {
      adjust("end");
      end = { row: g.total - 1, col: g.cols - 1 };
    } else {
      adjust(rows > 0 ? "down" : "up", Math.abs(rows));
      end = { row: to.row, col: end.col };
    }
    if (to.col === end.col) return;
    if (to.col === 0) adjust("line_start");
    else if (to.col === g.cols - 1) adjust("line_end");
    else if (Math.abs(to.col - end.col) <= Math.min(to.col, g.cols - 1 - to.col)) adjust(to.col > end.col ? "right" : "left", Math.abs(to.col - end.col));
    else if (to.col < g.cols - 1 - to.col) {
      adjust("line_start");
      adjust("right", to.col);
    } else {
      adjust("line_end");
      adjust("left", g.cols - 1 - to.col);
    }
    end = { ...to };
  }

  // The selection for the current mode, built from scratch.
  function rebuild(g) {
    if (mode === "normal") {
      call("terminal.select", { at: pos });
      end = { ...pos };
      follow(g);
    } else if (mode === "char") {
      call("terminal.select", { at: anchor });
      end = { ...anchor };
      moveEnd(pos, g);
    } else {
      const down = pos.row >= anchor.row;
      const from = { row: anchor.row, col: down ? 0 : g.cols - 1 };
      call("terminal.select", { at: from });
      end = from;
      moveEnd({ row: pos.row, col: down ? g.cols - 1 : 0 }, g);
    }
  }

  // select doesn't scroll the view; a step away and back does.
  function follow(g) {
    if (!g.scrolls || g.cols < 2) return;
    const [away, back] = pos.col > 0 ? ["left", "right"] : ["right", "left"];
    adjust(away);
    adjust(back);
  }

  function target(key, g) {
    const clampRow = (row) => Math.max(0, Math.min(row, g.total - 1));
    const col = (c) => Math.max(0, Math.min(c, g.cols - 1));
    const at = (row, c = want) => ({ row: clampRow(row), col: col(c) });
    const half = Math.max(1, Math.floor(g.len / 2));
    switch (key) {
      case "h": case "left": return (want = col(pos.col - 1)), at(pos.row);
      case "l": case "right": return (want = col(pos.col + 1)), at(pos.row);
      case "j": case "down": return at(pos.row + 1);
      case "k": case "up": return at(pos.row - 1);
      case "0": case "home": return (want = 0), at(pos.row);
      case "g": return (want = 0), at(0);
      case "G": return (want = 0), at(g.total - 1);
      case "H": return at(g.offset);
      case "M": return at(g.offset + Math.floor((g.len - 1) / 2));
      case "L": return at(g.offset + g.len - 1);
      case "ctrl-u": return at(pos.row - half);
      case "ctrl-d": return at(pos.row + half);
      case "ctrl-b": case "pageup": return at(pos.row - g.len);
      case "ctrl-f": case "pagedown": return at(pos.row + g.len);
      default: return null;
    }
  }

  // Moves the cursor to `to` and redraws the selection for the mode.
  function moveTo(to, g) {
    const crossed = mode === "line" && (to.row >= anchor.row) !== (pos.row >= anchor.row);
    pos = to;
    if (mode === "normal" || crossed) rebuild(g);
    else if (mode === "char") moveEnd(pos, g);
    else moveEnd({ row: pos.row, col: pos.row >= anchor.row ? g.cols - 1 : 0 }, g);
  }

  function setMode(next, g) {
    if (next === mode) next = "normal";
    if (mode === "normal") anchor = { ...pos };
    mode = next;
    rebuild(g);
  }

  return {
    /** Starts at the program's cursor, once its selection there can be read. */
    start(cursor) {
      pos = { ...cursor };
      want = pos.col;
      end = { ...pos };
    },
    state() { return { mode, label: MODES[mode], pos }; },
    /** Handles one key. null: not a copy-mode key. { exit, copy }: leave copy mode. */
    key(key) {
      if (!pos) return key === "escape" || key === "q" ? { exit: true, copy: false } : null;
      const g = geometry();
      if (key === "q" || key === "ctrl-c") return { exit: true, copy: false };
      if (key === "y" || key === "enter" || key === "cmd-c") return { exit: true, copy: mode !== "normal" };
      if (key === "escape") {
        if (mode === "normal") return { exit: true, copy: false };
        mode = "normal";
        rebuild(g);
        return {};
      }
      if (key === "v" || key === "space" || key === "V") {
        setMode(key === "V" ? "line" : "char", g);
        return {};
      }
      if (key === "^" || key === "$" || key === "end") {
        const edge = key === "^" ? "start" : "end";
        // A V selection covers whole rows, so the column changes nothing there.
        if (mode !== "line") return { measure: { row: pos.row, edge } };
        want = edge === "start" ? 0 : g.cols - 1;
        pos = { row: pos.row, col: want };
        return {};
      }
      const to = target(key, g);
      if (!to) return null;
      moveTo(to, g);
      return {};
    },
    /**
     * Finishes ^ or $ once main.js has run terminal.select {at: {row, col: 0}, mode: "line"}
     * and read the selection that left (null: a blank row). That replaced the
     * mode's selection, so it is drawn again from scratch.
     */
    measured({ row, edge }, line) {
      const g = geometry();
      let col = 0;
      if (line && edge === "start") col = line.start.row === row ? line.start.col : 0;
      // A line wrapped onto the next row ends past this one. One that ends on an
      // earlier row left only wrapped blanks here.
      else if (line) col = line.end.row > row ? g.cols - 1 : line.end.row === row ? line.end.col : 0;
      want = col;
      pos = { row, col };
      rebuild(g);
    },
  };
}

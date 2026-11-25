#!/usr/bin/env node
// Run: node tests/herdr-app-copy-mode.mjs
// Drives mods/copy-mode/copy.js against a fake terminal that behaves like
// Herdr 0.1.16's selection commands (measured against the live app).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const root = new URL('../home/.config/herdr-app/', import.meta.url);
const keys = JSON.parse(readFileSync(new URL('keys.json', root)));
assert.equal(keys.global['ctrl-g ['], 'mod.open:copy-mode', 'Ctrl+G [ opens copy mode, like the TUI');
assert.equal(keys['mod:copy-mode']?.escape, 'copy-mode.escape', 'Esc reaches copy mode instead of closing its popup');
// The command palette lists it (Herdr 0.1.18 skips a mod.open entry whose mod has no main.js).
const copyManifest = JSON.parse(readFileSync(new URL('mods/copy-mode/mod.json', root)));
assert.deepEqual(copyManifest.palette.map((e) => [e.title, e.command, e.args]), [['Copy mode', 'mod.open', { name: 'copy-mode' }]]);
readFileSync(new URL('mods/copy-mode/main.js', root));
const { createCopyMode, keyName } = await import(new URL('mods/copy-mode/copy.js', root));

// A terminal's grid: total rows (history and screen), cols, a view of len rows from offset.
function fakeTerminal({ total, cols, len, offset = total - len, scrolls = true, text = () => '' }) {
  const t = { total, cols, len, offset, scrolls, sel: null, calls: [] };
  const clamp = (row) => Math.max(0, Math.min(row, total - 1));
  const follow = () => {
    if (t.sel.end.row < t.offset) t.offset = t.sel.end.row;
    else if (t.sel.end.row >= t.offset + len) t.offset = t.sel.end.row - len + 1;
  };
  t.run = (name, args) => {
    t.calls.push([name, args]);
    assert.equal(args.terminal, 't7');
    if (name === 'terminal.select') {
      const { row, col } = args.at;
      assert.ok(row >= 0 && row < total && col >= 0 && col < cols, `select outside the grid: ${row},${col}`);
      if (args.mode === 'line') {
        // Ghostty's select-line: the row's text without its leading and trailing blanks.
        const line = text(row);
        const first = line.search(/\S/);
        t.sel = first < 0 ? null : { start: { row, col: first }, end: { row, col: line.trimEnd().length - 1 } };
      } else {
        t.sel = { start: { row, col }, end: { row, col } };
      }
    } else if (name === 'terminal.adjust_selection') {
      assert.ok(t.sel, 'adjust_selection needs a selection');
      const e = { ...t.sel.end };
      switch (args.direction) {
        case 'up': e.row = clamp(e.row - 1); break;
        case 'down': e.row = clamp(e.row + 1); break;
        case 'left': if (e.col > 0) e.col -= 1; else if (e.row > 0) Object.assign(e, { row: e.row - 1, col: cols - 1 }); break;
        case 'right': if (e.col < cols - 1) e.col += 1; else if (e.row < total - 1) Object.assign(e, { row: e.row + 1, col: 0 }); break;
        case 'line_start': e.col = 0; break;
        case 'line_end': e.col = cols - 1; break;
        case 'home': Object.assign(e, { row: 0, col: 0 }); break;
        case 'end': Object.assign(e, { row: total - 1, col: cols - 1 }); break;
        default: assert.fail(`unexpected direction ${args.direction}`);
      }
      t.sel.end = e;
      follow();
    } else {
      assert.fail(`unexpected command ${name}`);
    }
  };
  t.geometry = () => ({ cols, total, offset: t.offset, len, scrolls });
  return t;
}

function start(opts, cursor) {
  const term = fakeTerminal(opts);
  term.sel = { start: { ...cursor }, end: { ...cursor } };
  const copy = createCopyMode({ terminal: 't7', run: term.run, geometry: term.geometry });
  copy.start(cursor);
  // Like main.js: ^ and $ select the row as a line, then hand back what that selected.
  const press = (...names) => names.map((name) => {
    const result = copy.key(name);
    if (!result?.measure) return result;
    const { row } = result.measure;
    term.run('terminal.select', { terminal: 't7', at: { row, col: 0 }, mode: 'line' });
    copy.measured(result.measure, term.sel);
    return result;
  });
  return { term, copy, press };
}
const cell = (row, col) => ({ row, col });
const only = (row, col) => ({ start: cell(row, col), end: cell(row, col) });

// Keys arrive as one name each.
assert.equal(keyName({ key: 'j', modifiers: {} }), 'j');
assert.equal(keyName({ key: 'g', key_char: 'G', modifiers: { shift: true } }), 'G');
assert.equal(keyName({ key: '4', key_char: '$', modifiers: { shift: true } }), '$');
assert.equal(keyName({ key: 'd', modifiers: { control: true } }), 'ctrl-d');
assert.equal(keyName({ key: 'c', modifiers: { platform: true } }), 'cmd-c');
assert.equal(keyName({ key: 'space', key_char: ' ', modifiers: {} }), 'space');
assert.equal(keyName({ key: 'escape', modifiers: {} }), 'escape');
assert.equal(keyName({ key: 'j', modifiers: { alt: true } }), null);

// Normal mode: the cursor is a one-cell selection, and j/k keep the column.
{
  const { term, press } = start({ total: 200, cols: 80, len: 20, text: () => 'x'.repeat(80) }, cell(190, 10));
  press('k', 'k', 'k');
  assert.deepEqual(term.sel, only(187, 10));
  press('0', 'j');
  assert.deepEqual(term.sel, only(188, 0));
  press('$', 'k');
  assert.deepEqual(term.sel, only(187, 79), 'on a blank-free row $ is the last column');
  press('h', 'j');
  assert.deepEqual(term.sel, only(188, 78));
}

// ^ and $ go to the row's first and last text, not the edges of the terminal.
{
  const rows = { 10: '    indented text   ', 11: '', 12: 'x', 13: 'hello world' };
  const { term, copy, press } = start({ total: 40, cols: 30, len: 40, offset: 0, text: (r) => rows[r] ?? '' }, cell(10, 0));
  press('$');
  assert.deepEqual(term.sel, only(10, 16));
  press('^');
  assert.deepEqual(term.sel, only(10, 4));
  press('0');
  assert.deepEqual(term.sel, only(10, 0));
  press('j', '$');
  assert.deepEqual(term.sel, only(11, 0), 'a blank row has no text: $ stays in column 0');
  press('k', 'l', 'l', 'v', 'j', 'j', 'j', '$');
  assert.deepEqual(term.sel, { start: cell(10, 2), end: cell(13, 10) }, 'in visual mode $ extends to the text end');
  press('end', 'k', 'k', '^');
  assert.deepEqual(term.sel, { start: cell(10, 2), end: cell(11, 0) });
  assert.equal(copy.state().mode, 'char');
  press('V', '$');
  assert.deepEqual(term.sel, { start: cell(10, 0), end: cell(11, 29) }, 'V keeps whole rows on $');
}

// A line wrapped from the row above starts in column 0; one wrapping onto the next row ends in the last.
{
  const { term, copy } = start({ total: 40, cols: 30, len: 40, offset: 0 }, cell(5, 3));
  copy.measured({ row: 5, edge: 'start' }, { start: cell(4, 7), end: cell(6, 2) });
  assert.deepEqual(term.sel, only(5, 0));
  copy.measured({ row: 5, edge: 'end' }, { start: cell(4, 7), end: cell(6, 2) });
  assert.deepEqual(term.sel, only(5, 29));
  copy.measured({ row: 5, edge: 'end' }, { start: cell(4, 0), end: cell(4, 2) });
  assert.deepEqual(term.sel, only(5, 0), 'a row holding only wrapped blanks has no text end');
}

// The view follows the cursor through history, and back down.
{
  const { term, press } = start({ total: 200, cols: 80, len: 20 }, cell(190, 10));
  press('g');
  assert.deepEqual(term.sel, only(0, 0));
  assert.equal(term.offset, 0, 'g scrolls to the top');
  press('G');
  assert.deepEqual(term.sel, only(199, 0));
  assert.equal(term.offset, 180, 'G scrolls to the bottom');
  press('ctrl-u');
  assert.deepEqual(term.sel, only(189, 0));
  press('ctrl-b');
  assert.deepEqual(term.sel, only(169, 0));
  assert.equal(term.offset, 169);
  press('L');
  assert.deepEqual(term.sel, only(188, 0));
  press('H', 'M');
  assert.deepEqual(term.sel, only(178, 0));
}

// Edges stop the cursor; h never wraps to the row above.
{
  const { term, press } = start({ total: 50, cols: 40, len: 50, offset: 0, text: () => 'x'.repeat(40) }, cell(0, 0));
  press('k', 'h', 'ctrl-b');
  assert.deepEqual(term.sel, only(0, 0));
  press('G', '$', 'j', 'l', 'ctrl-f');
  assert.deepEqual(term.sel, only(49, 39));
}

// v selects characters from where it started; Esc goes back to the cursor.
{
  const { term, copy, press } = start({ total: 200, cols: 80, len: 20 }, cell(150, 10));
  press('v', 'j', 'j', 'l');
  assert.deepEqual(term.sel, { start: cell(150, 10), end: cell(152, 11) });
  assert.equal(copy.state().label, 'VISUAL');
  press('escape');
  assert.deepEqual(term.sel, only(152, 11));
  assert.equal(copy.state().mode, 'normal');
  press('space', 'k');
  assert.deepEqual(term.sel, { start: cell(152, 11), end: cell(151, 11) }, 'space starts a selection too');
  press('v');
  assert.deepEqual(term.sel, only(151, 11), 'v again ends it');
}

// V selects whole lines, on either side of the line it started on.
{
  const { term, press } = start({ total: 200, cols: 80, len: 20 }, cell(150, 10));
  press('V');
  assert.deepEqual(term.sel, { start: cell(150, 0), end: cell(150, 79) });
  press('j', 'j');
  assert.deepEqual(term.sel, { start: cell(150, 0), end: cell(152, 79) });
  press('k', 'k', 'k', 'k');
  assert.deepEqual(term.sel, { start: cell(150, 79), end: cell(148, 0) }, 'above its start, V keeps that whole line');
  press('j', 'j', 'j');
  assert.deepEqual(term.sel, { start: cell(150, 0), end: cell(151, 79) });
  press('v');
  assert.deepEqual(term.sel, { start: cell(150, 10), end: cell(151, 10) }, 'v turns it into a character selection from the same start');
}

// Far jumps in visual mode take one command, not one per row.
{
  const { term, press } = start({ total: 100000, cols: 80, len: 40 }, cell(99990, 5));
  press('v');
  term.calls.length = 0;
  press('g');
  assert.deepEqual(term.sel, { start: cell(99990, 5), end: cell(0, 0) });
  assert.ok(term.calls.length <= 2, `g took ${term.calls.length} commands`);
  press('G');
  assert.deepEqual(term.sel, { start: cell(99990, 5), end: cell(99999, 0) });
}

// y and Enter copy a selection and leave; without one they just leave.
{
  const keysFrom = (...names) => start({ total: 200, cols: 80, len: 20 }, cell(150, 10)).press(...names).at(-1);
  assert.deepEqual(keysFrom('y'), { exit: true, copy: false });
  assert.deepEqual(keysFrom('v', 'l', 'y'), { exit: true, copy: true });
  assert.deepEqual(keysFrom('V', 'enter'), { exit: true, copy: true });
  assert.deepEqual(keysFrom('v', 'cmd-c'), { exit: true, copy: true });
  assert.deepEqual(keysFrom('q'), { exit: true, copy: false });
  assert.deepEqual(keysFrom('v', 'q'), { exit: true, copy: false });
  assert.deepEqual(keysFrom('escape'), { exit: true, copy: false });
  assert.deepEqual(keysFrom('v', 'escape', 'escape'), { exit: true, copy: false }, 'Esc leaves the selection, then copy mode');
  assert.equal(keysFrom('x'), null, "other keys are not copy mode's");
}

// On the alternate screen nothing scrolls, so the cursor doesn't nudge the view.
{
  const { term, press } = start({ total: 40, cols: 80, len: 40, offset: 0, scrolls: false }, cell(20, 3));
  term.calls.length = 0;
  press('k');
  assert.deepEqual(term.calls, [['terminal.select', { terminal: 't7', at: cell(19, 3) }]]);
}

// Whatever the keys, the selection is exactly what the mode says, so the
// mod's own cursor never drifts from the terminal's.
{
  let seed = 7;
  const random = (n) => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) % n);
  const motions = ['h', 'j', 'k', 'l', '0', '^', '$', 'end', 'g', 'G', 'H', 'M', 'L', 'ctrl-u', 'ctrl-d', 'ctrl-b', 'ctrl-f', 'left', 'right', 'up', 'down'];
  const all = [...motions, ...motions, 'v', 'V', 'escape', 'space'];
  const texts = Array.from({ length: 300 }, (_, r) => (r % 7 === 0 ? '' : ' '.repeat(r % 5) + 'w'.repeat(r % 23)));
  const { term, copy, press } = start({ total: 300, cols: 30, len: 25, text: (r) => texts[r] }, cell(280, 4));
  let anchor = null;
  for (let i = 0; i < 5000; i++) {
    const { mode: before, pos: was } = copy.state();
    const key = all[random(all.length)];
    if (key === 'escape' && before === 'normal') continue;
    press(key);
    const { mode, pos } = copy.state();
    if (before === 'normal' && mode !== 'normal') anchor = { ...was };
    if (mode === 'normal') assert.deepEqual(term.sel, { start: pos, end: pos }, `after ${key} at step ${i}`);
    else if (mode === 'char') assert.deepEqual(term.sel, { start: anchor, end: pos }, `after ${key} at step ${i}`);
    else {
      const down = pos.row >= anchor.row;
      assert.deepEqual(term.sel, { start: cell(anchor.row, down ? 0 : 29), end: cell(pos.row, down ? 29 : 0) }, `after ${key} at step ${i}`);
    }
    assert.ok(pos.row >= term.offset && pos.row < term.offset + 25, `cursor ${pos.row} out of view at step ${i}`);
  }
}

console.log('herdr-app copy mode: all checks passed');

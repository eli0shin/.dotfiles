// New space, started in a folder you fuzzy-pick: the focused terminal's folder
// first (Enter right away is plain space.new), then zoxide's folders, then
// tracked repos. A space keeps the folder it was made in, so making it in the
// right one keeps `repos` and the default mods matching it. Type to filter,
// ↑/↓ (or ctrl-p/ctrl-n) and Enter to make it, a typed `/…` or `~/…` path
// works too, Esc to leave.

import { View, div } from "gpui-kit";
import { v_flex, h_flex, InputState, Input } from "gpui-base";
import { exec, focused, home, spaces, run, theme, props, closeOverlay } from "herdr";
import { displayPath, gatherFolders, rankFolders, reposPaths, typedFolder } from "./folders.js";

const ROWS = 12;
const REPOS_CONFIG = 'cat "${XDG_CONFIG_HOME:-$HOME/.config}/repos/config.json"';

// stdout of a program on the space's machine, or "" when it's missing or fails.
async function output(command, args, on) {
  try {
    const result = await exec(command, args, { on, timeout: 5000 });
    return result.code === 0 ? result.stdout : "";
  } catch {
    return "";
  }
}

export default class NewSpace extends View {
  init(_props, cx) {
    const here = focused();
    // space.new from a key makes the space on the focused space's machine;
    // pick from that machine's folders too.
    this.machine = spaces().find((space) => space.id === here?.space)?.machine ?? null;
    this.focusedCwd = here?.cwd ?? null;
    this.home = this.machine ? null : home();
    this.folders = gatherFolders({ focused: this.focusedCwd });
    this.loading = true;
    this.filter = "";
    this.at = 0;
    this.top = 0;
    this.input = InputState.new({ placeholder: "New space in…" });
    this.input.on("change", (_e, cx) => {
      this.filter = this.input.value();
      this.at = 0;
      cx.notify();
    });
    this.input.on("submit", () => {
      const rows = this.rows();
      // Nothing matches yet because the folders haven't arrived: wait, don't
      // fall back to the focused folder the person filtered away.
      if (this.loading && !rows.length) return;
      this.go(rows[this.at]);
    });
    this.input.focus();
    // The overlay can take focus back while it opens (as the shipped picker works around).
    cx.timer.after(600, () => this.input.focus());
    cx.spawn(async (cx) => {
      const on = this.machine;
      const [remoteHome, zoxide, config] = await Promise.all([
        on ? output("sh", ["-c", 'printf %s "$HOME"'], on) : Promise.resolve(this.home),
        output("zoxide", ["query", "-l"], on),
        output("sh", ["-c", REPOS_CONFIG], on),
      ]);
      this.home = remoteHome || this.home;
      this.folders = gatherFolders({ focused: this.focusedCwd, zoxide, repos: reposPaths(config) });
      this.loading = false;
      cx.notify();
    });
  }

  rows() {
    const ranked = rankFolders(this.filter, this.folders, this.home);
    const typed = typedFolder(this.filter, this.home);
    if (!typed) return ranked;
    return [{ path: typed, source: "typed" }, ...ranked.filter((folder) => folder.path !== typed)];
  }

  close() {
    closeOverlay(props().overlay);
  }

  go(folder) {
    this.close();
    // No folder (nothing matched): plain space.new, in the focused terminal's folder.
    run("space.new", { machine: this.machine ?? "", ...(folder ? { folder: folder.path } : {}) });
  }

  render() {
    const t = theme();
    const list = this.rows();
    this.at = Math.max(0, Math.min(this.at, list.length - 1));
    this.top = Math.max(0, Math.min(this.top, this.at, list.length - ROWS));
    if (this.at >= this.top + ROWS) this.top = this.at - ROWS + 1;
    const below = Math.max(0, list.length - this.top - ROWS);
    const note = (text) => div().px(14).h(22).flex_none().text_size(11).text_color(t.dim).child(text);

    const row = (folder, i) => {
      const shown = displayPath(folder.path, this.home);
      const cut = shown.lastIndexOf("/");
      const name = cut === -1 || shown === "/" ? shown : shown.slice(cut + 1);
      const parent = cut <= 0 ? "" : shown.slice(0, cut);
      const tag = { here: "here", repo: "repo", typed: "path" }[folder.source];
      return h_flex()
        .id(`ns-${i}`)
        .mx(4)
        .px(10)
        .h(32)
        .flex_none()
        .rounded(7)
        .gap(10)
        .items_center()
        .cursor_pointer()
        .when(i === this.at, (el) => el.bg(t.selected))
        .hover((el) => el.bg(t.hover))
        .on_click(() => this.go(folder))
        .child(div().flex_none().text_color(t.foreground).font_semibold().child(name))
        .child(div().flex_1().min_w(0).truncate().text_size(11).text_color(t.dim).child(parent))
        .when(Boolean(tag), (el) => el.child(div().flex_none().text_size(11).text_color(t.dim).child(tag)));
    };

    return v_flex()
      .id("new-space")
      .w_full()
      .min_h(0)
      .p(14)
      .gap(8)
      .bg(t.popover)
      .text_size(13)
      .on_key_down((e, cx) => {
        const k = e.key;
        const m = e.modifiers;
        if (k === "escape") return this.close();
        if (!list.length) return;
        if (k === "down" || (m.control && k === "n")) this.at = (this.at + 1) % list.length;
        else if (k === "up" || (m.control && k === "p")) this.at = (this.at + list.length - 1) % list.length;
        else return;
        cx.stop_propagation();
        cx.notify();
      })
      .child(h_flex().items_center()
        .child(div().flex_1().text_size(15).font_semibold().text_color(t.foreground).child(this.machine ? `New space on ${this.machine}` : "New space"))
        .child(div().text_size(11).text_color(t.dim).child("↑/↓ · Enter · Esc")))
      .child(h_flex().h(36).flex_none().px(10).items_center().rounded(9).border_1().border_color(t.accent).bg(t.background)
        .child(Input.new(this.input).flex_1().h_full().text_size(12.8).text_color(t.foreground)))
      .child(v_flex()
        .children(list.slice(this.top, this.top + ROWS).map((folder, j) => row(folder, this.top + j)))
        .when(below > 0, (el) => el.child(note(`↓ ${below} more`)))
        .when(this.loading, (el) => el.child(note("Loading folders…")))
        .when(!this.loading && !list.length, (el) => el.child(note("No folder matches; Enter starts where you are"))));
  }
}

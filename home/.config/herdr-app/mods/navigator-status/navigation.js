// vim-tmux-navigator for the app: it owns the chords, editors own their
// windows. Neovim labels an edge handoff so the same protocol works on remote
// cores without a remote app CLI.
const LABEL = "dotfiles.navigator";
// Neovim in front labels its terminal with its RPC server (v:servername) and
// gets the keys there, from `nvim` on PATH. Never `hc keys`: the core holds
// those until the person has stopped typing in that terminal for ~3 s.
const EDITOR = "dotfiles.navigator.editor";
const KEYS = { left: "h", down: "j", up: "k", right: "l" };

// `work/t7` runs on machine `work`; a bare `t7` runs here.
const machineOf = (address) => (address.includes("/") ? address.slice(0, address.lastIndexOf("/")) : null);

export function createNavigator({ focused, terminals, hc, exec, run, notify }) {
  const seen = new Map(terminals().map((t) => [t.address, t.labels?.[LABEL]]));
  const sameFocus = (source) => {
    const now = focused();
    return now?.terminal === source.terminal && now?.pane === source.pane && now?.tab === source.tab;
  };

  return {
    async navigate(direction) {
      if (!KEYS[direction]) return;
      const source = focused();
      const server = source?.terminal && terminals().find((t) => t.address === source.terminal)?.labels?.[EDITOR];
      if (!server) {
        run("pane.go", { direction });
        return;
      }
      let sent;
      try {
        const args = ["--server", server, "--remote-send", `<C-${KEYS[direction]}>`];
        sent = await exec("nvim", args, { on: machineOf(source.terminal), timeout: 2000 });
      } catch (error) {
        notify({ title: "Pane navigation failed", body: `Could not run nvim: ${error}`, level: "error" });
        return;
      }
      if (sent.code === 0) return;
      // Its Neovim died without releasing the terminal: forget it and move.
      hc(["label", source.terminal, `${EDITOR}=`]).catch(() => {});
      if (sameFocus(source)) run("pane.go", { direction });
    },

    onTerminalsChanged() {
      const current = focused();
      const live = terminals();
      const addresses = new Set(live.map((t) => t.address));
      for (const address of seen.keys()) if (!addresses.has(address)) seen.delete(address);
      for (const terminal of live) {
        const token = terminal.labels?.[LABEL];
        const known = seen.has(terminal.address);
        const previous = seen.get(terminal.address);
        // Mark even unfocused requests as seen, so returning to a terminal or
        // restarting the mod never replays a historical edge movement.
        seen.set(terminal.address, token);
        if (!known || !token || token === previous || current?.terminal !== terminal.address) continue;
        const direction = /^\d+:\d+:(left|down|up|right)$/.exec(token)?.[1];
        if (direction) run("pane.go", { direction });
      }
    },
  };
}

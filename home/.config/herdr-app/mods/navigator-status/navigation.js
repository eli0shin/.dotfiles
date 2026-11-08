// The app owns the chords; editors own their windows. Neovim labels an edge
// handoff so the same protocol works on remote cores without a remote app CLI.
const LABEL = "dotfiles.navigator";
const KEYS = { left: "h", down: "j", up: "k", right: "l" };
const PASSTHROUGH = /^(?:g?\.?)(?:view|l?n?vim?x?|fzf)(?:diff)?(?:-wrapped)?$/i;

export function createNavigator({ focused, terminals, hc, run, notify }) {
  const seen = new Map(terminals().map((t) => [t.address, t.labels?.[LABEL]]));
  const sameFocus = (source) => {
    const now = focused();
    return now?.terminal === source.terminal && now?.pane === source.pane && now?.tab === source.tab;
  };

  return {
    async navigate(direction) {
      if (!KEYS[direction]) return;
      const source = focused();
      if (!source?.terminal) {
        run("pane.go", { direction });
        return;
      }
      try {
        // Query at the keypress rather than trusting a potentially stale UI
        // process snapshot (e.g. immediately after launching/exiting Neovim).
        const result = await hc(["get", source.terminal, "--json"]);
        if (result.code !== 0) throw new Error(result.stderr || "Could not inspect terminal");
        if (!sameFocus(source)) return;
        const foreground = JSON.parse(result.stdout).foreground;
        const name = (foreground?.name ?? "").split(/[\\/]/).pop();
        if (PASSTHROUGH.test(name)) {
          const sent = await hc(["keys", source.terminal, `ctrl+${KEYS[direction]}`]);
          if (sent.code !== 0) throw new Error(sent.stderr || "Could not send navigation key");
        } else {
          run("pane.go", { direction });
        }
      } catch (error) {
        notify({ title: "Pane navigation failed", body: String(error), level: "error" });
      }
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

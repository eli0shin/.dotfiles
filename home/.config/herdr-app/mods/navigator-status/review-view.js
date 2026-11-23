// The review TUI (`review`, ~/code/code-review-tui) as a view of Herdr instead
// of a tab to hunt for: one per machine, reached with navigator-status.review
// (Cmd+R). Pressing it on the review goes back to the terminal you came from.
// Its tab stays out of the tab bar and the tab keys, as agents' tabs do. It
// still lives in a space because review opens its Review and Diff tabs in the
// space that holds its own terminal.
//
// The terminal labels itself, so it's found by label on any machine; when
// review quits, the terminal ends (Herdr's launcher would otherwise leave a
// shell behind) and the next press starts a fresh one.

// Keep in sync with eli-tabs/main.js.
export const REVIEW_LABEL = "dotfiles.review";
export const REVIEW_ARGV = [
  "/bin/sh",
  "-c",
  `hc label "$HC_TERMINAL_ID" ${REVIEW_LABEL}=1 >/dev/null 2>&1; review; hc kill "$HC_TERMINAL_ID"`,
];
const COMMAND = "review";

const machineOf = (address) => (address.includes("/") ? address.split("/")[0] : "");
export const isReview = (terminal) => terminal?.state === "live" && Boolean(terminal.labels?.[REVIEW_LABEL]);

// The tabs showing a review terminal.
export function reviewTabIds(panes, terminals) {
  const review = new Set(terminals.filter(isReview).map((t) => t.address));
  return new Set(panes.filter((p) => p.terminal && review.has(p.terminal)).map((p) => p.tab));
}

export function createReviewView({ spaces, focused, terminals, run }) {
  // The terminal to go back to from the review.
  let back = null;
  return {
    // Returns true when it handled the command.
    handle(command) {
      if (command !== COMMAND) return false;
      const here = focused();
      const all = spaces();
      const space = all.find((s) => s.id === here?.space) ?? all.find((s) => s.active);
      const machine = space?.machine ?? "";
      const listed = terminals();
      const review = listed.find((t) => isReview(t) && machineOf(t.address) === machine);
      if (review && here?.terminal === review.address) {
        if (back && listed.some((t) => t.address === back && t.state === "live")) run("pane.focus", { terminal: back });
        return true;
      }
      back = here?.terminal ?? null;
      if (review) run("pane.focus", { terminal: review.address });
      // None on this machine yet: start one in the space you're in.
      else run("tab.new", { ...(space ? { space: space.id } : {}), name: "review", argv: REVIEW_ARGV });
      return true;
    },
  };
}

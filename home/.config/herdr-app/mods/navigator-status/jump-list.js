// A jump list of tabs, like Neovim's Ctrl+O / Ctrl+I (Ctrl+G O / Ctrl+G I).
//
// Each tab you looked at for a second or more is an entry, however it came on
// screen: a tab key, an agent jump, a click, a review opening its diff. Moving
// between panes inside a tab doesn't count. The list works as Neovim's does by
// default (no `jumpoptions=stack`): leaving a tab moves it to the end of the
// list, so a tab is in it once, and going somewhere new after jumping back
// drops nothing. Jumps skip closed tabs. Memory only.

export const DWELL_MS = 1000;
export const MAX_ENTRIES = 100;

export function createJumpList({ dwell = DWELL_MS, max = MAX_ENTRIES } = {}) {
  const list = [];
  // Where you are in the list: list.length when you're past its end (not jumping).
  let pos = 0;
  // The tab on screen, and since when.
  let current = null;
  let since = 0;
  // The tab a jump asked for, until it shows.
  let pending = null;

  function push(tab) {
    const at = list.indexOf(tab);
    if (at >= 0) list.splice(at, 1);
    list.push(tab);
    if (list.length > max) list.splice(0, list.length - max);
  }

  function jump(from, step, live) {
    for (let i = from; i >= 0 && i < list.length; i += step) {
      const tab = list[i];
      if (tab !== current && live(tab)) {
        pos = i;
        pending = tab;
        return tab;
      }
    }
    return null;
  }

  return {
    /** The tab on screen now (call on every render). */
    shown(tab, now) {
      if (!tab || tab === current) return;
      if (tab === pending) {
        pending = null;
      } else {
        // You went there yourself: the tab you left is an entry if you stayed.
        pending = null;
        if (current && now - since >= dwell) push(current);
        pos = list.length;
      }
      current = tab;
      since = now;
    },

    /** The tab to show for Ctrl+G O, or null. live(tab): whether it's still open. */
    back(live) {
      // Leaving the end: remember where you are, so Ctrl+G I comes back. Only
      // when there's somewhere to go; a tab that just came on screen joins the
      // list for this, but not when nothing happens.
      if (pos >= list.length && current) {
        // Closed tabs go first, so making room can't drop the one to go back to.
        for (let i = list.length - 1; i >= 0; i--) if (!live(list[i])) list.splice(i, 1);
        if (!list.some((tab) => tab !== current)) return null;
        push(current);
        pos = list.length - 1;
      }
      return jump(pos - 1, -1, live);
    },

    /** The tab to show for Ctrl+G I, or null. */
    forward(live) {
      return jump(pos + 1, 1, live);
    },

    state() {
      return { list: [...list], pos, current };
    },
  };
}

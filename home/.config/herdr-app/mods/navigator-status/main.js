import { View, div } from "gpui-kit";
import { spaces, agents, panes, run, focused, terminals, hc, exec, notify, nextCommand, shared, setShared, checking, home } from "herdr";
import { createNavigator } from "./navigation.js";
import { focusNumberedAgent, agentOrder, ORDER_KEY, HIDDEN_MACHINES_KEY } from "./agent-order.js";
import { selectTab } from "./tab-order.js";
import { applySharedPreferences } from "./preferences.js";
import { createTabCloseFocus } from "./tab-close-focus.js";
import { createDeadSpaces } from "./dead-spaces.js";
import { createReviewView, reviewTabIds } from "./review-view.js";
import { createJumpList } from "./jump-list.js";

export default class NavigatorStatus extends View {
  init(_props, cx) {
    this.navigator = createNavigator({ focused, terminals, hc, exec, run, notify });
    this.tabCloseFocus = createTabCloseFocus({ run });
    this.review = createReviewView({ spaces, focused, terminals, run });
    this.jumpList = createJumpList();
    this.seeSpaces(spaces(), agents());
    if (!checking()) {
      const deadSpaces = createDeadSpaces({ spaces, terminals, exec, run, notify, home });
      cx.timer.every(30000, (cx) => cx.spawn(() => deadSpaces.sweep()));
    }
    cx.spawn(async () => {
      for (;;) {
        const command = await nextCommand();
        if (applySharedPreferences(command, { setShared, notify })) continue;
        if (command === "jump-list-back" || command === "jump-list-forward") {
          const open = new Set(spaces().flatMap((s) => s.tabs.map((t) => t.id)));
          const live = (tab) => open.has(tab);
          const tab = command === "jump-list-back" ? this.jumpList.back(live) : this.jumpList.forward(live);
          if (tab) run("tab.select", { id: tab });
          continue;
        }
        const order = (list) => agentOrder(list, { terminals, sort: shared("agents.sort"), published: shared(ORDER_KEY), hidden: shared(HIDDEN_MACHINES_KEY) });
        if (this.review.handle(command)) continue;
        // The review's tab is left out of the tab keys, as agents' tabs are.
        const hidden = () => reviewTabIds(panes(), terminals());
        if (selectTab(command, { spaces, agents, run, order, hidden })) continue;
        if (!focusNumberedAgent(command, { agents, terminals, shared, run })) await this.navigator.navigate(command);
      }
    });
  }

  // The Agents list order is read only when a closed tab had an agent: it
  // costs a terminals() read when the sidebar's published order is stale.
  seeSpaces(all, list) {
    const sort = shared("agents.sort"), published = shared(ORDER_KEY), hidden = shared(HIDDEN_MACHINES_KEY);
    this.tabCloseFocus.onSpacesChanged(all, list, () => agentOrder(list, { terminals, sort, published, hidden }));
  }

  // Draws nothing: the layout gives it no height, so the terminal reaches the
  // window's bottom. It stays in the layout (not the often-hidden sidebar)
  // because only shown mods get commands. The machine it used to show ends
  // the tab bar (eli-tabs).
  render() {
    this.navigator.onTerminalsChanged();
    this.seeSpaces(spaces(), agents());
    this.jumpList.shown(focused()?.tab, Date.now());
    return div().size_full();
  }
}

import {
  AssistantMessageComponent,
  CustomMessageComponent,
  ToolExecutionComponent,
  VERSION,
  type ExtensionAPI,
  type ExtensionContext,
} from "@earendil-works/pi-coding-agent";
import type { AssistantMessage } from "@earendil-works/pi-ai";
import {
  Container,
  MouseRegion,
  Spacer,
  Text,
  stripTerminalSequences,
  truncateToWidth,
  visibleWidth,
  type Component,
  type MarkdownTheme,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { CompactToolView, type ToolState } from "./tool-view.ts";
import { ImageGrid } from "./image-grid.ts";
import { ActivityTrace } from "./trace.ts";

// Pi has per-tool renderers, but no transcript-grouping hook. Keep the 1.4 adapter
// here: it reads component metadata and replaces only this chat container's view.
// The original children, session messages, tools, and provider context are untouched.
type AssistantState = {
  lastMessage?: AssistantMessage;
  isStreaming: boolean;
  markdownTheme: MarkdownTheme;
  markdownTransformers: ConstructorParameters<typeof AssistantMessageComponent>[5];
  outputPad: number;
};
type Activity = {
  key: Component;
  component: Component;
  // Notices are errors and warnings: kept in details, never counted.
  kind: "command" | "read" | "edit" | "thought" | "notice";
  images?: readonly Component[];
};
type Part = { activity: Activity } | { component: Component };
type Split = {
  signature: string;
  state: Pick<AssistantState, "outputPad" | "markdownTheme" | "markdownTransformers">;
  parts: Part[];
};

// Pi 1.4 keeps custom-message identity/expansion on the native component.
// Unknown shapes and other injected message types are not shortcut targets.
function prNotificationState(component: Component): { _expanded: boolean } | undefined {
  if (!(component instanceof CustomMessageComponent)) return undefined;
  const state = component as unknown as { message?: { customType?: string }; _expanded?: boolean };
  return state.message?.customType === "pr-watch-harness" && typeof state._expanded === "boolean"
    ? state as { _expanded: boolean }
    : undefined;
}

// CustomMessageComponent supports setExpanded(), but Pi 1.4 does not give it
// a mouse toggle. Keep that state on the native component so global/keyboard
// expansion and title clicks all control the same notification.
class PrNotificationView extends MouseRegion {
  private titleRows = new Map<number, { start: number; end: number }>();
  readonly notification: CustomMessageComponent;
  private content: Container;
  private toggle: (control: "title" | "collapse") => void;
  private style: (text: string) => string;

  constructor(notification: CustomMessageComponent, toggle: (control: "title" | "collapse") => void,
    style: (text: string) => string) {
    const content = new Container();
    super(content, (event) => {
      const row = this.titleRows.get(event.y);
      if (event.type !== "click" || event.button !== "left" || !row ||
          event.x < row.start || event.x >= row.end) return undefined;
      toggle("title");
      return { handled: true };
    });
    this.notification = notification;
    this.content = content;
    this.toggle = toggle;
    this.style = style;
  }

  render(width: number): string[] {
    this.content.children = [this.notification];
    if (prNotificationState(this.notification)!._expanded) {
      const line = truncateToWidth(this.style(" − collapse"), width);
      const labelWidth = visibleWidth(line);
      this.content.addChild(new MouseRegion(new Text(line, 0, 0), (event) => {
        if (event.type !== "click" || event.button !== "left" || event.x < 1 || event.x >= labelWidth) return undefined;
        this.toggle("collapse");
        return { handled: true };
      }));
    }
    const lines = super.render(width);
    this.titleRows.clear();
    let remaining = `${prNotificationState(this.notification)!._expanded ? "▾" : "▸"} pr-watch-notification`;
    // Measure the actual rendered title, including wrapped rows and outputPad.
    // Stop before the payload: clicking details must still select text/open links.
    for (const [y, line] of lines.entries()) {
      const plain = stripTerminalSequences(line);
      const text = plain.trim();
      if (!text) continue;
      if (!remaining.startsWith(text)) break;
      const start = visibleWidth(plain) - visibleWidth(plain.trimStart());
      this.titleRows.set(y, { start, end: start + visibleWidth(text) });
      remaining = remaining.slice(text.length).trimStart();
      if (!remaining) break;
    }
    return lines;
  }
}

function noticeText(component: Component | undefined): string | undefined {
  if (!(component instanceof Text) || component.constructor.name !== "ThemedText") return undefined;
  // Pi 1.4 showStatus/showWarning use this native component for UI notices.
  // Match only those notices, never assistant/user text quoting the same words.
  const state = component as unknown as { build?: () => string; stale: boolean; text: string };
  const text = state.stale === false ? state.text : state.build?.call(component);
  return typeof text === "string" ? stripTerminalSequences(text) : undefined;
}

function isToolOutputNotice(component: Component | undefined): boolean {
  return /^Tool output: (expanded|collapsed)$/.test(noticeText(component) ?? "");
}

// Pi's showError/showWarning statuses, including extension notify() calls.
function isErrorNotice(component: Component | undefined): boolean {
  return /^(Error|Warning): /.test(noticeText(component) ?? "");
}

function assistantState(component: AssistantMessageComponent): AssistantState | undefined {
  const state = component as unknown as AssistantState;
  return state.lastMessage?.role === "assistant" && typeof state.outputPad === "number" && state.markdownTheme
    ? state
    : undefined;
}

export class ActivityGroup extends Container {
  members: Activity[] = [];
  expanded = false;
  private override?: boolean;
  private globalExpanded = false;
  private shortcutPeek = false;
  private previews = new ImageGrid();
  private summaryWidth = 0;
  private trace?: ActivityTrace;
  private lastTraceState?: string;

  private redraw: () => void;
  private style: (text: string) => string;

  constructor(redraw: () => void, style: (text: string) => string, trace?: ActivityTrace) {
    super();
    this.redraw = redraw;
    this.style = style;
    this.trace = trace;
  }

  private recordState(reason: string, before = this.expanded, onlyIfChanged = false): void {
    if (!this.trace?.enabled) return;
    const state = { group: this.trace.id(this), expanded: this.expanded, globalExpanded: this.globalExpanded,
      override: this.override ?? null, shortcutPeek: this.shortcutPeek, members: this.members.length,
      first: this.members[0] ? this.trace.id(this.members[0].key) : null,
      last: this.members.at(-1) ? this.trace.id(this.members.at(-1)!.key) : null,
      expandedTools: this.members.filter((member) => member.key instanceof ToolExecutionComponent &&
        (member.key as unknown as { expanded: boolean }).expanded).length,
    };
    const signature = JSON.stringify(state);
    if (!onlyIfChanged || signature !== this.lastTraceState) {
      this.trace.record("group-state", { ...state, before, reason: this.lastTraceState === undefined ? "create" : reason });
    }
    this.lastTraceState = signature;
  }

  traceSnapshot(): void { this.recordState("snapshot"); }

  private recordMouse(event: TuiMouseEvent, control: "summary" | "collapse"): void {
    this.trace?.record("group-mouse", { group: this.trace.id(this), control,
      x: event.x, y: event.y, screenX: event.screenX, screenY: event.screenY,
      width: event.width, height: event.height, clickCount: event.clickCount });
  }

  update(members: Activity[], globalExpanded: boolean): void {
    const before = this.expanded;
    const globalChanged = this.globalExpanded !== globalExpanded;
    if (globalChanged) {
      this.override = undefined;
      this.shortcutPeek = false;
    }
    this.globalExpanded = globalExpanded;
    this.members = members;
    this.expanded = this.override ?? globalExpanded;
    this.recordState(globalChanged ? "global-change" : "update", before, true);
  }

  render(width: number): string[] {
    const commands = this.members.filter((member) => member.kind === "command").length;
    const reads = this.members.filter((member) => member.kind === "read").length;
    const edits = this.members.filter((member) => member.kind === "edit").length;
    const counts = [
      commands ? `${commands} command${commands === 1 ? "" : "s"}` : "",
      reads ? `${reads} read${reads === 1 ? "" : "s"}` : "",
      edits ? `${edits} edit${edits === 1 ? "" : "s"}` : "",
    ].filter(Boolean).join(", ");
    // Thought-only runs stay silent while collapsed, rather than replacing
    // removed counters with another source of transcript noise.
    if (!counts && !this.expanded) {
      this.summaryWidth = 0;
      this.children = [];
      return super.render(width);
    }
    const summary = `${this.expanded ? "−" : "+"} ${counts || "details"}`;
    const summaryLine = truncateToWidth(this.style(` ${summary}`), width);
    this.summaryWidth = visibleWidth(summaryLine);
    this.children = [new Spacer(1), new Text(summaryLine, 0, 0)];
    if (this.expanded) {
      this.children.push(...this.members.map((member) => member.component));
      const collapseLine = truncateToWidth(this.style(" − collapse"), width);
      const collapseWidth = visibleWidth(collapseLine);
      this.children.push(new MouseRegion(
        new Text(collapseLine, 0, 0),
        (event) => {
          if (event.type !== "click" || event.button !== "left" || event.x < 1 || event.x >= collapseWidth) return undefined;
          this.recordMouse(event, "collapse");
          this.setLocalExpansion(false, "mouse-collapse");
          return { handled: true };
        },
      ));
    } else {
      // Keep the visual story outside collapsed chatter, without filenames or
      // tool framing. Expanded details already contain these same images.
      this.previews.images = this.members.flatMap((member) => member.images ?? []);
      this.children.push(this.previews);
    }
    return super.render(width).map((line) =>
      line.includes("\x1b_G") || line.includes("\x1b]1337;File=") ? line : truncateToWidth(line, width));
  }

  toggle(fromShortcut = false): void {
    this.setLocalExpansion(!this.expanded, fromShortcut ? "shortcut" : "mouse-summary");
  }

  collapseShortcutPeek(): void {
    if (!this.shortcutPeek) return;
    const before = this.expanded;
    this.shortcutPeek = false;
    this.override = false;
    this.expanded = false;
    this.recordState("newer-block", before);
    // Called while the view is rebuilding for the current render; no extra
    // frame or notification is needed. Mouse-opened groups are never affected.
  }

  private setLocalExpansion(expanded: boolean, reason: "shortcut" | "mouse-summary" | "mouse-collapse"): void {
    const before = this.expanded;
    this.override = expanded;
    this.expanded = expanded;
    this.shortcutPeek = expanded && reason === "shortcut";
    this.recordState(reason, before);
    this.redraw();
  }

  handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
    if (event.type === "click" && event.button === "left" && event.y === 1 &&
        event.x >= 1 && event.x < this.summaryWidth) {
      this.recordMouse(event, "summary");
      this.toggle();
      return { handled: true, target: { component: this,
        originX: event.screenX - event.x, originY: event.screenY - event.y,
        width: event.width, height: event.height } };
    }
    return super.handleMouse(event);
  }
}

export class ActivityView extends Container {
  enabled = true;
  private groups = new WeakMap<Component, ActivityGroup>();
  private splits = new WeakMap<AssistantMessageComponent, Split>();
  private thinkingKeys = new WeakMap<AssistantMessageComponent, Component[]>();
  private errorKeys = new WeakMap<AssistantMessageComponent, Component>();
  private toolViews = new WeakMap<ToolExecutionComponent, CompactToolView>();
  private hiddenNotices = new WeakSet<Component>();
  private shortcutBlock?: ActivityGroup | CustomMessageComponent;
  private shortcutGlobalExpanded = false;
  private trace?: ActivityTrace;
  private notificationStates = new WeakMap<Component, boolean>();
  private notificationViews = new WeakMap<CustomMessageComponent, PrNotificationView>();

  private source: Container;
  private redraw: () => void;
  private style: (text: string) => string;
  private getExpanded: () => boolean;
  private styleError: (text: string) => string;

  constructor(source: Container, redraw: () => void, style: (text: string) => string, getExpanded: () => boolean,
    styleError: (text: string) => string, trace?: ActivityTrace) {
    super();
    this.source = source;
    this.redraw = redraw;
    this.style = style;
    this.getExpanded = getExpanded;
    this.styleError = styleError;
    this.trace = trace;
  }

  invalidate(): void {
    this.splits = new WeakMap();
    super.invalidate();
  }

  refresh(): void {
    this.invalidate();
    this.redraw();
  }

  resetExpansion(expanded: boolean): void {
    this.trace?.record("expansion-reset", { expanded, globalExpanded: this.getExpanded() });
    this.shortcutBlock = undefined;
    this.groups = new WeakMap();
    // Pi skips setToolsExpanded when the global value is unchanged. Explicit
    // commands must still undo per-group clicks, notification peeks, and tool toggles.
    for (const child of this.source.children) {
      if (child instanceof ToolExecutionComponent ||
          (child instanceof CustomMessageComponent && prNotificationState(child))) child.setExpanded(expanded);
    }
  }

  private splitAssistant(component: AssistantMessageComponent): Part[] {
    const state = assistantState(component);
    if (!state) return [{ component }];
    const message = state.lastMessage!;
    const thoughts = message.content.filter((block) => block.type === "thinking" && block.thinking.trim());
    const failure = ["error", "aborted", "length"].includes(message.stopReason);
    if (!thoughts.length && !failure) {
      // Invisible tool-only assistant messages should not break an activity run.
      const visible = message.content.some((block) => block.type === "text" && block.text.trim());
      return visible ? [{ component }] : [];
    }
    const signature = JSON.stringify([message.content.map((block) =>
      block.type === "thinking" ? [block.type, block.thinking] : block.type === "text" ? [block.type, block.text] : block.type),
      message.stopReason, message.errorMessage, state.isStreaming]);
    const cached = this.splits.get(component);
    if (cached?.signature === signature && cached.state.outputPad === state.outputPad &&
        cached.state.markdownTheme === state.markdownTheme &&
        cached.state.markdownTransformers === state.markdownTransformers) return cached.parts;

    const make = (content: AssistantMessage["content"], stopReason = message.stopReason) => {
      const clone = new AssistantMessageComponent(undefined, false, state.markdownTheme, undefined,
        state.outputPad, state.markdownTransformers);
      clone.updateContent({ ...message, content, stopReason }, state.isStreaming);
      return clone;
    };
    const parts: Part[] = [];
    const thinkingKeys = this.thinkingKeys.get(component) ?? [];
    this.thinkingKeys.set(component, thinkingKeys);
    let thinkingIndex = 0;
    // Preserve the order of thinking/text runs, including providers that interleave them.
    let run: AssistantMessage["content"] = [];
    let thinking = message.content[0]?.type === "thinking";
    const flush = () => {
      if (!run.length) return;
      if (thinking) {
        if (run.some((block) => block.type === "thinking" && block.thinking.trim())) {
          const detail = make(run, "stop");
          // Every reasoning run needs an identity independent of its rendered
          // clone: finalization, streaming, and theme invalidation rebuild it.
          const key = thinkingKeys[thinkingIndex] ?? (thinkingIndex === 0 ? component : new Container());
          thinkingKeys[thinkingIndex++] = key;
          parts.push({ activity: { key, component: detail, kind: "thought" } });
        }
      } else if (run.some((block) => block.type === "text" && block.text.trim())) {
        parts.push({ component: make(run, "stop") });
      }
      run = [];
    };
    for (const block of message.content) {
      const nextThinking = block.type === "thinking";
      if (nextThinking !== thinking) { flush(); thinking = nextThinking; }
      run.push(block);
    }
    flush();
    // Provider errors, truncation, and cancellation join the activity group.
    if (failure) {
      const key = this.errorKeys.get(component) ?? new Container();
      this.errorKeys.set(component, key);
      parts.push({ activity: { key, component: make([]), kind: "notice" } });
    }
    this.splits.set(component, { signature, state: {
      outputPad: state.outputPad, markdownTheme: state.markdownTheme, markdownTransformers: state.markdownTransformers,
    }, parts });
    return parts;
  }

  private updateGroups(): void {
    this.children = [];
    let members: Activity[] = [];
    const flush = () => {
      if (!members.length) return;
      const key = members[0].key;
      let group = this.groups.get(key);
      if (!group) {
        group = new ActivityGroup(this.redraw, this.style, this.trace);
        this.groups.set(key, group);
      }
      group.update(members, this.getExpanded());
      this.children.push(group);
      members = [];
    };
    const isHiddenNotice = (child: Component | undefined) => {
      if (!child) return false;
      // showStatus can reuse its final component for a different notice. Only
      // historical entries retain their classification across mutable builders.
      const current = child === this.source.children[this.source.children.length - 1];
      if (this.hiddenNotices.has(child) && !current) return true;
      if (isToolOutputNotice(child)) {
        this.hiddenNotices.add(child);
        return true;
      }
      if (current) this.hiddenNotices.delete(child);
      return false;
    };
    for (const [index, child] of this.source.children.entries()) {
      const notification = prNotificationState(child);
      if (this.trace?.enabled && notification && this.notificationStates.get(child) !== notification._expanded) {
        this.trace.record("notification-state", { notification: this.trace.id(child), expanded: notification._expanded,
          before: this.notificationStates.get(child) ?? null, globalExpanded: this.getExpanded() });
        this.notificationStates.set(child, notification._expanded);
      }
      const next = this.source.children[index + 1];
      if (isHiddenNotice(child) ||
          (child instanceof Spacer && (isHiddenNotice(next) || isErrorNotice(next)))) continue;
      let parts: Part[];
      if (isErrorNotice(child)) parts = [{ activity: { key: child, component: child, kind: "notice" } }];
      else if (child instanceof AssistantMessageComponent) parts = this.splitAssistant(child);
      else if (child instanceof ToolExecutionComponent) {
        const state = child as unknown as ToolState;
        let detail = this.toolViews.get(child);
        if (!detail) {
          detail = new CompactToolView(child, this.styleError);
          this.toolViews.set(child, detail);
        }
        // Unknown component shapes fail open to Pi's original renderer.
        parts = typeof state.isPartial !== "boolean"
          ? [{ component: child }]
          : [{ activity: {
            key: child, component: detail,
            kind: state.toolName === "read" ? "read" : state.toolName === "edit" || state.toolName === "write" ? "edit" : "command",
            images: state.imageComponents,
          } }];
      } else if (child instanceof CustomMessageComponent && notification) {
        let detail = this.notificationViews.get(child);
        if (!detail) {
          detail = new PrNotificationView(child, (control) => {
            const expanded = control === "collapse" ? false : !prNotificationState(child)!._expanded;
            child.setExpanded(expanded);
            if (this.shortcutBlock === child) this.shortcutBlock = undefined;
            this.trace?.record("notification-expansion", { notification: this.trace.id(child),
              reason: control === "collapse" ? "mouse-collapse" : "mouse-title", expanded });
            this.redraw();
          }, this.style);
          this.notificationViews.set(child, detail);
        }
        parts = [{ component: detail }];
      } else parts = [{ component: child }];
      for (const part of parts) {
        if ("activity" in part) members.push(part.activity);
        else { flush(); this.children.push(part.component); }
      }
    }
    flush();
    // Global expansion takes ownership; otherwise a newer block ends the peek.
    if (this.shortcutGlobalExpanded !== this.getExpanded()) this.shortcutBlock = undefined;
    if (this.shortcutBlock && this.shortcutBlock !== this.latestBlock()) {
      if (this.shortcutBlock instanceof ActivityGroup) this.shortcutBlock.collapseShortcutPeek();
      else {
        this.trace?.record("notification-expansion", { notification: this.trace.id(this.shortcutBlock),
          reason: "newer-block", expanded: false });
        this.shortcutBlock.setExpanded(false);
      }
      this.shortcutBlock = undefined;
    }
  }

  render(width: number): string[] {
    this.updateGroups();
    return super.render(width);
  }

  private latestBlock(): ActivityGroup | CustomMessageComponent | undefined {
    return this.children.map((child) => child instanceof PrNotificationView ? child.notification : child)
      .filter((child): child is ActivityGroup | CustomMessageComponent =>
      child instanceof ActivityGroup || prNotificationState(child) !== undefined).at(-1);
  }

  traceSnapshot(): void {
    // Observe the last displayed groups, not a refreshed view: reconciliation
    // can collapse peeks and would change the state we are trying to capture.
    this.trace?.record("view-snapshot", { enabled: this.enabled, globalExpanded: this.getExpanded() });
    if (this.enabled) {
      for (const child of this.children) {
        if (child instanceof ActivityGroup) child.traceSnapshot();
      }
    }
    for (const child of this.source.children) {
      const notification = prNotificationState(child);
      if (notification) this.trace?.record("notification-state", { notification: this.trace.id(child),
        reason: "snapshot", expanded: notification._expanded, globalExpanded: this.getExpanded() });
      else if (!this.enabled && child instanceof ToolExecutionComponent) {
        this.trace?.record("native-tool-state", { tool: this.trace.id(child), reason: "snapshot",
          expanded: (child as unknown as { expanded: boolean }).expanded });
      }
    }
  }

  toggleLatestGroup(): void {
    this.trace?.record("latest-shortcut", { enabled: this.enabled, globalExpanded: this.getExpanded() });
    if (!this.enabled) return;
    // Refresh membership without rendering tool bodies or expanding nested output.
    this.updateGroups();
    const latest = this.latestBlock();
    this.trace?.record("shortcut-target", { target: latest ? this.trace.id(latest) : null,
      kind: latest instanceof ActivityGroup ? "activity" : latest ? "notification" : "none" });
    if (!latest) return;
    let expanded: boolean;
    if (latest instanceof ActivityGroup) {
      latest.toggle(true);
      expanded = latest.expanded;
    } else {
      expanded = !prNotificationState(latest)!._expanded;
      latest.setExpanded(expanded);
      this.trace?.record("notification-expansion", { notification: this.trace.id(latest), reason: "shortcut", expanded });
      this.redraw();
    }
    this.shortcutBlock = expanded ? latest : undefined;
    this.shortcutGlobalExpanded = this.getExpanded();
  }
}

export function installActivityView(
  chat: Container,
  redraw: () => void,
  style: (text: string) => string,
  getExpanded: () => boolean,
  styleError: (text: string) => string = (text) => text,
  trace?: ActivityTrace,
): { view: ActivityView; restore: () => void } {
  const view = new ActivityView(chat, redraw, style, getExpanded, styleError, trace);
  const render = chat.render;
  const handleMouse = chat.handleMouse;
  const invalidate = chat.invalidate;
  let lastRenderState: string | undefined;
  chat.render = (width) => {
    if (trace?.enabled) {
      const state = { width, enabled: view.enabled, globalExpanded: getExpanded() };
      const signature = JSON.stringify(state);
      if (signature !== lastRenderState) trace.record("view-render", state);
      lastRenderState = signature;
    }
    return view.enabled ? view.render(width) : render.call(chat, width);
  };
  chat.handleMouse = (event) => view.enabled ? view.handleMouse(event) : handleMouse.call(chat, event);
  chat.invalidate = () => { invalidate.call(chat); view.invalidate(); };
  return {
    view,
    restore: () => {
      trace?.record("view-restore");
      chat.render = render;
      chat.handleMouse = handleMouse;
      chat.invalidate = invalidate;
      redraw();
    },
  };
}

// In Pi 1.4 both terminal modes mount document=[header, resources, chat] first.
// Refuse other layouts/versions rather than risk hiding the wrong UI component.
export function findChat(tui: Pick<TUI, "children">, version = VERSION): Container | undefined {
  if (!/^1\.4\./.test(version)) return undefined;
  const document = tui.children[0];
  if (!(document instanceof Container) || document.children.length !== 3 ||
      !document.children.every((child) => child instanceof Container)) return undefined;
  return document.children[2] as Container;
}

// Pi 1.4 fullscreen consumes focus/mouse reports in its first input listener.
// Observe before that listener, not after it. The stable TUI reference points at
// replacement renderers, which reuse this terminal and call start() on switches.
export function observeActivityInput(tui: TUI, trace: ActivityTrace): () => void {
  if (!trace.enabled) return () => {};
  const terminal = tui.terminal;
  if (!terminal || typeof terminal.start !== "function") {
    trace.record("input-observer", { supported: false, tuiMode: tui.mode });
    return () => {};
  }
  type Listener = Parameters<TUI["addInputListener"]>[0];
  const observer: Listener = (data) => { trace.input(data); };
  let unsubscribe: (() => void) | undefined;
  let active = true;
  const attach = () => {
    unsubscribe?.(); unsubscribe = undefined;
    const listeners = (tui as unknown as { inputListeners?: Set<Listener> }).inputListeners;
    if (!(listeners instanceof Set)) {
      trace.record("input-observer", { supported: false, tuiMode: tui.mode });
      return;
    }
    unsubscribe = tui.addInputListener(observer);
    const ordered = [...listeners];
    listeners.clear();
    listeners.add(observer);
    for (const listener of ordered) if (listener !== observer) listeners.add(listener);
    trace.record("input-observer", { supported: true, tuiMode: tui.mode });
  };
  attach();
  const start = terminal.start;
  const observedStart: typeof start = function (this: typeof terminal, onInput, onResize) {
    if (active) attach();
    start.call(this, onInput, onResize);
  };
  terminal.start = observedStart;
  return () => {
    active = false;
    unsubscribe?.(); unsubscribe = undefined;
    if (terminal.start === observedStart) terminal.start = start;
  };
}

export default function compactActivity(pi: ExtensionAPI): void {
  let installed: ReturnType<typeof installActivityView> | undefined;
  let trace: ActivityTrace | undefined;
  let removeInputListener: (() => void) | undefined;
  const cleanup = () => {
    removeInputListener?.(); removeInputListener = undefined;
    installed?.restore(); installed = undefined;
    trace?.record("session-stop"); trace = undefined;
  };

  pi.on("session_start", async (_event, ctx) => {
    cleanup();
    if (ctx.mode !== "tui") return;
    const sessionTrace = new ActivityTrace(ctx.sessionManager.getSessionId());
    trace = sessionTrace;
    sessionTrace.record("session-start", { version: VERSION, globalExpanded: ctx.ui.getToolsExpanded() });
    // Borrow the public custom-UI factory to get the TUI reference, closing before
    // mounting any dialog or taking focus. No persistent widget/padding is added.
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      const chat = findChat(tui);
      sessionTrace.record("view-install", { supported: !!chat, tuiMode: tui.mode });
      if (chat) {
        installed = installActivityView(chat, () => tui.requestRender(),
          (text) => ctx.ui.theme.fg("muted", text), () => ctx.ui.getToolsExpanded(),
          (text) => ctx.ui.theme.fg("error", text), sessionTrace);
        removeInputListener = observeActivityInput(tui, sessionTrace);
      }
      done();
      return new Container();
    });
    if (!installed) ctx.ui.notify("Compact activity: unsupported Pi layout/version; using the normal transcript.", "warning");
  });

  pi.on("session_shutdown", cleanup);

  pi.registerShortcut("ctrl+shift+o", {
    description: "Toggle the latest activity or PR notification block without expanding individual tool output",
    handler: () => { installed?.view.toggleLatestGroup(); },
  });

  pi.registerCommand("activity", {
    description: "Activity display: compact (default), full, expand, collapse; trace saves a diagnostic checkpoint",
    handler: async (args, ctx: ExtensionContext) => {
      if (!installed) { ctx.ui.notify("Compact activity is unavailable in this session.", "warning"); return; }
      const command = args.trim() || "compact";
      switch (command) {
        case "compact": installed.view.enabled = true; break;
        case "full": installed.view.enabled = false; break;
        case "expand": ctx.ui.setToolsExpanded(true); installed.view.resetExpansion(true); break;
        case "collapse": ctx.ui.setToolsExpanded(false); installed.view.resetExpansion(false); break;
        case "trace":
          installed.view.traceSnapshot();
          ctx.ui.notify(`Compact activity trace ${trace?.enabled ? "on" : "off"}: ${trace?.path}`, "info");
          return;
        default: ctx.ui.notify("Usage: /activity compact|full|expand|collapse|trace", "warning"); return;
      }
      trace?.record("activity-command", { command, enabled: installed.view.enabled, globalExpanded: ctx.ui.getToolsExpanded() });
      installed.view.refresh();
    },
  });
}

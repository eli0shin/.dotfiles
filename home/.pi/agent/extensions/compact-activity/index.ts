import {
  AssistantMessageComponent,
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
  type Component,
  type MarkdownTheme,
  type TUI,
  type TuiMouseEvent,
} from "@earendil-works/pi-tui";
import { CompactToolView, type ToolState } from "./tool-view.ts";
import { ImageGrid } from "./image-grid.ts";

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
  kind: "command" | "read" | "edit" | "thought";
  images?: readonly Component[];
};
type Part = { activity: Activity } | { component: Component };
type Split = {
  signature: string;
  state: Pick<AssistantState, "outputPad" | "markdownTheme" | "markdownTransformers">;
  parts: Part[];
};

function isToolOutputNotice(component: Component | undefined): boolean {
  if (!(component instanceof Text) || component.constructor.name !== "ThemedText") return false;
  // Pi 1.4 showStatus uses this native component for its transient UI notices.
  // Match only those notices, never assistant/user text quoting the same words.
  const state = component as unknown as { build?: () => string; stale: boolean; text: string };
  const text = state.stale === false ? state.text : state.build?.call(component);
  return typeof text === "string" && /^Tool output: (expanded|collapsed)$/.test(stripTerminalSequences(text));
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

  private redraw: () => void;
  private style: (text: string) => string;

  constructor(redraw: () => void, style: (text: string) => string) {
    super();
    this.redraw = redraw;
    this.style = style;
  }

  update(members: Activity[], globalExpanded: boolean): void {
    if (this.globalExpanded !== globalExpanded) {
      this.override = undefined;
      this.shortcutPeek = false;
    }
    this.globalExpanded = globalExpanded;
    this.members = members;
    this.expanded = this.override ?? globalExpanded;
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
      this.children = [];
      return super.render(width);
    }
    const summary = `${this.expanded ? "−" : "+"} ${counts || "details"}`;
    this.children = [new Spacer(1), new Text(truncateToWidth(this.style(` ${summary}`), width), 0, 0)];
    if (this.expanded) {
      this.children.push(...this.members.map((member) => member.component));
      this.children.push(new MouseRegion(
        new Text(truncateToWidth(this.style(" − collapse"), width), 0, 0),
        (event) => {
          if (event.type !== "click" || event.button !== "left") return undefined;
          this.setLocalExpansion(false);
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
    this.setLocalExpansion(!this.expanded, fromShortcut);
  }

  collapseShortcutPeek(): void {
    if (!this.shortcutPeek) return;
    this.shortcutPeek = false;
    this.override = false;
    this.expanded = false;
    // Called while the view is rebuilding for the current render; no extra
    // frame or notification is needed. Mouse-opened groups are never affected.
  }

  private setLocalExpansion(expanded: boolean, fromShortcut = false): void {
    this.override = expanded;
    this.expanded = expanded;
    this.shortcutPeek = expanded && fromShortcut;
    this.redraw();
  }

  handleMouse(event: TuiMouseEvent): ReturnType<Container["handleMouse"]> {
    if (event.type === "click" && event.button === "left" && event.y === 1) {
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
  private toolViews = new WeakMap<ToolExecutionComponent, CompactToolView>();
  private hiddenNotices = new WeakSet<Component>();
  private shortcutGroup?: ActivityGroup;

  private source: Container;
  private redraw: () => void;
  private style: (text: string) => string;
  private getExpanded: () => boolean;
  private styleError: (text: string) => string;

  constructor(source: Container, redraw: () => void, style: (text: string) => string, getExpanded: () => boolean,
    styleError: (text: string) => string) {
    super();
    this.source = source;
    this.redraw = redraw;
    this.style = style;
    this.getExpanded = getExpanded;
    this.styleError = styleError;
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
    this.shortcutGroup = undefined;
    this.groups = new WeakMap();
    // Pi skips setToolsExpanded when the global value is unchanged. Explicit
    // commands must still undo per-group clicks and per-tool local toggles.
    for (const child of this.source.children) {
      if (child instanceof ToolExecutionComponent) child.setExpanded(expanded);
    }
  }

  private splitAssistant(component: AssistantMessageComponent): Part[] {
    const state = assistantState(component);
    if (!state) return [{ component }];
    const message = state.lastMessage!;
    const thoughts = message.content.filter((block) => block.type === "thinking" && block.thinking.trim());
    if (!thoughts.length) {
      // Invisible tool-only assistant messages should not break an activity run.
      const visible = message.content.some((block) => block.type === "text" && block.text.trim());
      return visible || ["error", "aborted", "length"].includes(message.stopReason) ? [{ component }] : [];
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
    // Do not bury provider errors, truncation, or cancellation inside a thought group.
    if (["error", "aborted", "length"].includes(message.stopReason)) {
      parts.push({ component: make([]) });
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
        group = new ActivityGroup(this.redraw, this.style);
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
      if (isHiddenNotice(child) ||
          (child instanceof Spacer && isHiddenNotice(this.source.children[index + 1]))) continue;
      let parts: Part[];
      if (child instanceof AssistantMessageComponent) parts = this.splitAssistant(child);
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
      } else parts = [{ component: child }];
      for (const part of parts) {
        if ("activity" in part) members.push(part.activity);
        else { flush(); this.children.push(part.component); }
      }
    }
    flush();
    if (this.shortcutGroup && this.shortcutGroup !== this.latestToolGroup()) {
      this.shortcutGroup.collapseShortcutPeek();
      this.shortcutGroup = undefined;
    }
  }

  render(width: number): string[] {
    this.updateGroups();
    return super.render(width);
  }

  private latestToolGroup(): ActivityGroup | undefined {
    for (let index = this.children.length - 1; index >= 0; index--) {
      const child = this.children[index];
      if (child instanceof ActivityGroup && child.members.some((member) => member.kind !== "thought")) return child;
    }
    return undefined;
  }

  toggleLatestGroup(): void {
    if (!this.enabled) return;
    // Refresh group membership without rendering tool bodies or expanding any
    // nested tool output. Ignore trailing thought-only runs, which are hidden.
    this.updateGroups();
    const latest = this.latestToolGroup();
    if (!latest) return;
    latest.toggle(true);
    this.shortcutGroup = latest.expanded ? latest : undefined;
  }
}

export function installActivityView(
  chat: Container,
  redraw: () => void,
  style: (text: string) => string,
  getExpanded: () => boolean,
  styleError: (text: string) => string = (text) => text,
): { view: ActivityView; restore: () => void } {
  const view = new ActivityView(chat, redraw, style, getExpanded, styleError);
  const render = chat.render;
  const handleMouse = chat.handleMouse;
  const invalidate = chat.invalidate;
  chat.render = (width) => view.enabled ? view.render(width) : render.call(chat, width);
  chat.handleMouse = (event) => view.enabled ? view.handleMouse(event) : handleMouse.call(chat, event);
  chat.invalidate = () => { invalidate.call(chat); view.invalidate(); };
  return {
    view,
    restore: () => {
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

export default function compactActivity(pi: ExtensionAPI): void {
  let installed: ReturnType<typeof installActivityView> | undefined;

  pi.on("session_start", async (_event, ctx) => {
    installed?.restore();
    installed = undefined;
    if (ctx.mode !== "tui") return;
    // Borrow the public custom-UI factory to get the TUI reference, closing before
    // mounting any dialog or taking focus. No persistent widget/padding is added.
    await ctx.ui.custom<void>((tui, _theme, _keys, done) => {
      const chat = findChat(tui);
      if (chat) installed = installActivityView(chat, () => tui.requestRender(),
        (text) => ctx.ui.theme.fg("muted", text), () => ctx.ui.getToolsExpanded(),
        (text) => ctx.ui.theme.fg("error", text));
      done();
      return new Container();
    });
    if (!installed) ctx.ui.notify("Compact activity: unsupported Pi layout/version; using the normal transcript.", "warning");
  });

  pi.on("session_shutdown", () => { installed?.restore(); installed = undefined; });

  pi.registerShortcut("ctrl+shift+o", {
    description: "Toggle the latest tool group without expanding individual tool output",
    handler: () => { installed?.view.toggleLatestGroup(); },
  });

  pi.registerCommand("activity", {
    description: "Activity display: compact (default), full, expand, collapse",
    handler: async (args, ctx: ExtensionContext) => {
      if (!installed) { ctx.ui.notify("Compact activity is unavailable in this session.", "warning"); return; }
      switch (args.trim() || "compact") {
        case "compact": installed.view.enabled = true; break;
        case "full": installed.view.enabled = false; break;
        case "expand": ctx.ui.setToolsExpanded(true); installed.view.resetExpansion(true); break;
        case "collapse": ctx.ui.setToolsExpanded(false); installed.view.resetExpansion(false); break;
        default: ctx.ui.notify("Usage: /activity compact|full|expand|collapse", "warning"); return;
      }
      installed.view.refresh();
    },
  });
}

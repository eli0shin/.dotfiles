import { ToolExecutionComponent } from "@earendil-works/pi-coding-agent";
import { Box, Container, MouseRegion, Spacer, Text, type Component } from "@earendil-works/pi-tui";

// Pi 1.4 tool metadata. Reuse Pi's actual images: this preserves image IDs,
// sizing, protocol selection, non-PNG conversion, and the show-images setting.
export type ToolState = {
  toolName: string;
  isPartial: boolean;
  result?: { isError: boolean };
  imageComponents?: Component[];
};
type ToolShell = ToolState & {
  contentBox: Box;
  selfRenderContainer: Container;
  contentText: Text;
  contentTextRegion: MouseRegion;
  toolDefinition?: { renderShell?: string };
  hideComponent: boolean;
  outputPad: number;
  getTextOutput?: () => string;
};
type MouseState = {
  child: Component;
  onMouse: ConstructorParameters<typeof MouseRegion>[1];
};

// Project known layout primitives, rather than mutating shared renderer
// components or stripping ANSI from their output (which would damage images).
// Keep foreground styling, diffs, and mouse handlers; discard shell backgrounds
// and padding. Unknown/custom component implementations render unchanged.
function createUnframer(): (component: Component) => Component {
  const cache = new WeakMap<Component, Component>();
  const project = (source: Component): Component => {
    const cached = cache.get(source);
    if (cached) return cached;
    let projected: Component = source;
    if (source instanceof Box || source.constructor === Container) {
      const layout = source as Box | Container;
      const container = new Container();
      const render = container.render.bind(container);
      container.render = (width) => {
        container.children = layout.children.map(project);
        return render(width);
      };
      projected = container;
    } else if (source.constructor === Text) {
      const text = new Text("", 0, 0);
      const render = text.render.bind(text);
      text.render = (width) => {
        text.setText((source as unknown as { text: string }).text);
        return render(width);
      };
      projected = text;
    } else if (source instanceof MouseRegion) {
      const state = source as unknown as MouseState;
      projected = new MouseRegion(project(state.child), state.onMouse.bind(source));
    }
    cache.set(source, projected);
    return projected;
  };
  return project;
}

// Apply error color after each SGR boundary, so muted/syntax-colored native
// output cannot override it. Preserve links, other attributes, and image bytes.
function errorOutput(source: Component, style: (text: string) => string): Component {
  return {
    render: (width) => source.render(width).map((line) => {
      if (line.includes("\x1b_G") || line.includes("\x1b]1337;File=")) return line;
      return line.split(/(\x1b\[[\d;:]*m)/).map((part) =>
        /^\x1b\[[\d;:]*m$/.test(part) || !part ? part : style(part)).join("");
    }),
    handleMouse: (event) => source.handleMouse?.(event),
    invalidate: () => source.invalidate(),
  };
}

export class CompactToolView extends Container {
  private source: ToolExecutionComponent;
  private project = createUnframer();
  private styleError: (text: string) => string;

  constructor(source: ToolExecutionComponent, styleError: (text: string) => string) {
    super();
    this.source = source;
    this.styleError = styleError;
  }

  render(width: number): string[] {
    const state = this.source as unknown as ToolShell;
    if (!(state.contentBox instanceof Box) || !(state.selfRenderContainer instanceof Container) ||
        !(state.contentText instanceof Text) || !(state.contentTextRegion instanceof MouseRegion)) return this.source.render(width);
    if (state.hideComponent) return [];
    const shell = state.toolDefinition
      ? state.toolDefinition.renderShell === "self" ? state.selfRenderContainer : state.contentBox
      : undefined;
    const content = new Box(state.outputPad, 0);
    if (shell) {
      for (const [index, child] of shell.children.entries()) {
        const projected = this.project(child);
        content.addChild(state.result?.isError && index > 0 ? errorOutput(projected, this.styleError) : projected);
      }
    } else {
      // Native fallback text combines title, JSON arguments, and output. Split
      // only its exact output suffix so error coloring never touches the call.
      const output = state.result?.isError ? state.getTextOutput?.() : undefined;
      const fullText = (state.contentText as unknown as { text: string }).text;
      const suffix = output ? `\n${output}` : undefined;
      if (suffix && fullText.endsWith(suffix)) {
        const fallback = new Container();
        fallback.addChild(new Text(fullText.slice(0, -suffix.length), 0, 0));
        fallback.addChild(errorOutput(new Text(output, 0, 0), this.styleError));
        const region = state.contentTextRegion as unknown as MouseState;
        content.addChild(new MouseRegion(fallback, region.onMouse.bind(state.contentTextRegion)));
      } else content.addChild(this.project(state.contentTextRegion));
    }
    this.children = [new Spacer(1), content];
    for (const image of state.imageComponents ?? []) this.children.push(new Spacer(1), image);
    return super.render(width);
  }
}

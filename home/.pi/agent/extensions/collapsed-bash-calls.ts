import { type ExtensionAPI, keyHint, type ToolDefinition } from "@earendil-works/pi-coding-agent";

const PREVIEW_LINES = 3;

// Renderers apply to every tool's argument shape, as Pi's own ToolRenderers type does.
type ToolRenderers = Pick<ToolDefinition<any, any, any>, "renderShell" | "renderCall" | "renderResult">;
type ToolRendererResolver = (toolName: string, next: () => ToolRenderers | undefined) => ToolRenderers | undefined;
// The 0.84 typings this project checks against predate registerToolRenderer; the installed Pi has it.
type ToolRendererApi = { registerToolRenderer(resolver: ToolRendererResolver): void };

export type CollapsedCommand = { preview: string; hiddenLines: number };

// Collapse only when at least two lines would be hidden, so the hint never replaces a single line.
export function collapseCommand(command: unknown, previewLines = PREVIEW_LINES): CollapsedCommand | undefined {
  if (typeof command !== "string") return undefined;
  const lines = command.replace(/\n+$/, "").split("\n");
  const hiddenLines = lines.length - previewLines;
  if (hiddenLines < 2) return undefined;
  return { preview: lines.slice(0, previewLines).join("\n"), hiddenLines };
}

export function collapseBashCall(renderers: ToolRenderers | undefined): ToolRenderers | undefined {
  const renderCall = renderers?.renderCall;
  if (!renderCall) return renderers;

  return {
    ...renderers,
    renderCall(args, theme, context) {
      const bashArgs = args as { command?: unknown } | undefined;
      const collapsed = context.expanded ? undefined : collapseCommand(bashArgs?.command);
      if (!collapsed) return renderCall(args, theme, context);

      // The hint rides inside the command text so the built-in renderer keeps drawing (and reusing) one Text.
      const hint =
        theme.fg("muted", `... (${collapsed.hiddenLines} more lines,`) +
        ` ${keyHint("app.tools.expand", "to expand")}` +
        theme.fg("muted", ")");
      return renderCall({ ...bashArgs, command: `${collapsed.preview}\n${hint}` }, theme, context);
    },
  };
}

export default function collapsedBashCalls(pi: ExtensionAPI): void {
  (pi as ExtensionAPI & ToolRendererApi).registerToolRenderer((toolName, next) =>
    toolName === "bash" ? collapseBashCall(next()) : next(),
  );
}

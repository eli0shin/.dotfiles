import type { ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getMarkdownTheme } from "@earendil-works/pi-coding-agent";
import { Container, Markdown, type SelectItem, SelectList, Spacer, Text } from "@earendil-works/pi-tui";

export type ReviewAction = "send" | "save" | "ignore";

/**
 * Show the review findings with action choices.
 * Returns the chosen action, or "ignore" if cancelled.
 */
export async function presentReview(
  ctx: ExtensionCommandContext,
  findings: string,
): Promise<ReviewAction> {
  const result = await ctx.ui.custom<ReviewAction>((tui, theme, _kb, done) => {
    const container = new Container();
    const border = (s: string) => theme.fg("accent", s);

    container.addChild(new DynamicBorder(border));
    container.addChild(new Text(theme.fg("accent", theme.bold("Code Review")), 1, 0));
    container.addChild(new Spacer(1));
    container.addChild(new Markdown(findings.trim() || "No actionable issues found.", 1, 0, getMarkdownTheme()));
    container.addChild(new Spacer(1));

    const items: SelectItem[] = [
      { value: "send", label: "Send to agent", description: "Inject findings as advisory context" },
      { value: "save", label: "Save to file", description: "Write findings to a markdown file" },
      { value: "ignore", label: "Ignore", description: "Discard the review" },
    ];
    const selectList = new SelectList(items, items.length, {
      selectedPrefix: (t) => theme.fg("accent", t),
      selectedText: (t) => theme.fg("accent", t),
      description: (t) => theme.fg("muted", t),
      scrollInfo: (t) => theme.fg("dim", t),
      noMatch: (t) => theme.fg("warning", t),
    });
    selectList.onSelect = (item) => done(item.value as ReviewAction);
    selectList.onCancel = () => done("ignore");
    container.addChild(selectList);
    container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc ignore"), 1, 0));
    container.addChild(new DynamicBorder(border));

    return {
      render: (w) => container.render(w),
      invalidate: () => container.invalidate(),
      handleInput: (data) => {
        selectList.handleInput(data);
        tui.requestRender();
      },
    };
  });
  return result ?? "ignore";
}

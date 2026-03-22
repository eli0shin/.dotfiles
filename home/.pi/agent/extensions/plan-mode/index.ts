import type { AgentMessage } from "@mariozechner/pi-agent-core";
import type { AssistantMessage, TextContent } from "@mariozechner/pi-ai";
import type { ExtensionAPI, ExtensionContext } from "@mariozechner/pi-coding-agent";
import { Key } from "@mariozechner/pi-tui";
import { extractTodoItems, isSafeCommand, markCompletedSteps, type TodoItem } from "./utils.js";

const BASE_PLAN_TOOLS = ["read", "bash", "grep", "find", "ls"];
const OPTIONAL_PLAN_TOOLS = ["web_search", "fetch_content", "web_search_exa", "get_code_context_exa"];
const PLAN_MESSAGE_TYPES = new Set([
  "plan-mode",
  "plan-mode-context",
  "plan-execution-context",
  "plan-mode-execute",
  "plan-todo-list",
  "plan-complete",
]);

type PlanState = {
  enabled?: boolean;
  executing?: boolean;
  todos?: TodoItem[];
  restoreTools?: string[];
};

function isAssistantMessage(message: AgentMessage): message is AssistantMessage {
  return message.role === "assistant" && Array.isArray(message.content);
}

function getTextContent(message: AssistantMessage): string {
  return message.content
    .filter((block): block is TextContent => block.type === "text")
    .map((block) => block.text)
    .join("\n");
}

export default function planModeExtension(pi: ExtensionAPI): void {
  let planModeEnabled = false;
  let executionMode = false;
  let todoItems: TodoItem[] = [];
  let restoreTools: string[] = [];

  pi.registerFlag("plan", {
    description: "Start in plan mode (read-only exploration)",
    type: "boolean",
    default: false,
  });

  function getPlanTools(): string[] {
    const availableToolNames = new Set(pi.getAllTools().map((tool) => tool.name));
    return [...BASE_PLAN_TOOLS, ...OPTIONAL_PLAN_TOOLS].filter((toolName) => availableToolNames.has(toolName));
  }

  function getRestoreTools(): string[] {
    return restoreTools.length > 0 ? restoreTools : pi.getActiveTools();
  }

  function restoreNormalTools(): void {
    pi.setActiveTools(getRestoreTools());
  }

  function persistState(): void {
    pi.appendEntry("plan-mode", {
      enabled: planModeEnabled,
      executing: executionMode,
      todos: todoItems,
      restoreTools,
    });
  }

  function updateStatus(ctx: ExtensionContext): void {
    if (executionMode && todoItems.length > 0) {
      const completed = todoItems.filter((todo) => todo.completed).length;
      ctx.ui.setStatus("plan-mode", `plan ${completed}/${todoItems.length}`);
    } else if (planModeEnabled) {
      ctx.ui.setStatus("plan-mode", "plan");
    } else {
      ctx.ui.setStatus("plan-mode", undefined);
    }

    if (executionMode && todoItems.length > 0) {
      const lines = todoItems.map((todo) => `${todo.completed ? "[x]" : "[ ]"} ${todo.step}. ${todo.text}`);
      ctx.ui.setWidget("plan-todos", lines);
    } else {
      ctx.ui.setWidget("plan-todos", undefined);
    }
  }

  function enablePlanMode(ctx: ExtensionContext): void {
    restoreTools = pi.getActiveTools();
    planModeEnabled = true;
    executionMode = false;
    todoItems = [];
    pi.setActiveTools(getPlanTools());
    updateStatus(ctx);
    persistState();
    if (ctx.hasUI) {
      ctx.ui.notify("Plan mode enabled.", "info");
    }
  }

  function disablePlanMode(ctx: ExtensionContext): void {
    planModeEnabled = false;
    executionMode = false;
    todoItems = [];
    restoreNormalTools();
    updateStatus(ctx);
    persistState();
    if (ctx.hasUI) {
      ctx.ui.notify("Plan mode disabled.", "info");
    }
  }

  function togglePlanMode(ctx: ExtensionContext): void {
    if (planModeEnabled || executionMode) {
      disablePlanMode(ctx);
      return;
    }

    enablePlanMode(ctx);
  }

  pi.registerCommand("plan", {
    description: "Toggle read-only plan mode",
    handler: async (_args, ctx) => togglePlanMode(ctx),
  });

  pi.registerCommand("todos", {
    description: "Show current plan progress",
    handler: async (_args, ctx) => {
      if (todoItems.length === 0) {
        ctx.ui.notify("No plan items yet.", "info");
        return;
      }

      const list = todoItems.map((todo) => `${todo.step}. ${todo.completed ? "x" : "-"} ${todo.text}`).join("\n");
      ctx.ui.notify(`Plan progress:\n${list}`, "info");
    },
  });

  pi.registerShortcut(Key.ctrlAlt("p"), {
    description: "Toggle plan mode",
    handler: async (ctx) => togglePlanMode(ctx),
  });

  pi.on("tool_call", async (event) => {
    if (!planModeEnabled || event.toolName !== "bash") return undefined;

    const command = event.input.command as string;
    if (isSafeCommand(command)) return undefined;

    return {
      block: true,
      reason: `Plan mode blocked bash command: ${command}`,
    };
  });

  pi.on("context", async (event) => {
    return {
      messages: event.messages.filter((message) => {
        const candidate = message as AgentMessage & { customType?: string };
        if (!PLAN_MESSAGE_TYPES.has(candidate.customType ?? "")) return true;
        if (planModeEnabled && candidate.customType === "plan-mode-context") return true;
        if (executionMode && candidate.customType === "plan-execution-context") return true;
        return false;
      }),
    };
  });

  pi.on("before_agent_start", async () => {
    if (planModeEnabled) {
      const planTools = getPlanTools().join(", ");
      return {
        message: {
          customType: "plan-mode-context",
          content: `[PLAN MODE ACTIVE]\nYou are in read-only planning mode.\n\nAllowed tools: ${planTools}\n\nRules:\n- Do not modify files or install packages.\n- Use only read-only bash commands.\n- If web tools are available, you may use them for research.\n- End with a numbered plan under a \"Plan:\" header.\n\nPlan:\n1. First step\n2. Second step`,
          display: false,
        },
      };
    }

    if (executionMode && todoItems.length > 0) {
      const remaining = todoItems.filter((todo) => !todo.completed);
      const todoList = remaining.map((todo) => `${todo.step}. ${todo.text}`).join("\n");
      return {
        message: {
          customType: "plan-execution-context",
          content: `[EXECUTING PLAN]\n\nRemaining steps:\n${todoList}\n\nWork in order. After completing a step, include a [DONE:n] marker in your response.`,
          display: false,
        },
      };
    }

    return undefined;
  });

  pi.on("turn_end", async (event, ctx) => {
    if (!executionMode || todoItems.length === 0) return;
    if (!isAssistantMessage(event.message)) return;

    const text = getTextContent(event.message);
    if (markCompletedSteps(text, todoItems) > 0) {
      updateStatus(ctx);
      persistState();
    }
  });

  pi.on("agent_end", async (event, ctx) => {
    if (executionMode && todoItems.length > 0) {
      if (!todoItems.every((todo) => todo.completed)) return;

      const completedList = todoItems.map((todo) => `- [x] ${todo.text}`).join("\n");
      pi.sendMessage(
        {
          customType: "plan-complete",
          content: `Plan complete.\n\n${completedList}`,
          display: true,
        },
        { triggerTurn: false },
      );

      executionMode = false;
      todoItems = [];
      restoreNormalTools();
      updateStatus(ctx);
      persistState();
      return;
    }

    if (!planModeEnabled || !ctx.hasUI) return;

    const lastAssistant = [...event.messages].reverse().find(isAssistantMessage);
    if (lastAssistant) {
      const extracted = extractTodoItems(getTextContent(lastAssistant));
      if (extracted.length > 0) {
        todoItems = extracted;
        persistState();
      }
    }

    if (todoItems.length > 0) {
      const todoListText = todoItems.map((todo) => `${todo.step}. [ ] ${todo.text}`).join("\n");
      pi.sendMessage(
        {
          customType: "plan-todo-list",
          content: `Plan steps (${todoItems.length}):\n\n${todoListText}`,
          display: true,
        },
        { triggerTurn: false },
      );
    }

    const choice = await ctx.ui.select("Plan mode - what next?", [
      todoItems.length > 0 ? "Execute the plan" : "Exit plan mode",
      "Stay in plan mode",
      "Refine the plan",
    ]);

    if (choice === "Exit plan mode") {
      disablePlanMode(ctx);
      return;
    }

    if (choice === "Execute the plan") {
      planModeEnabled = false;
      executionMode = todoItems.length > 0;
      restoreNormalTools();
      updateStatus(ctx);
      persistState();

      const executeMessage =
        todoItems.length > 0
          ? `Execute the plan. Start with step 1: ${todoItems[0].text}`
          : "Exit plan mode and continue normally.";
      pi.sendMessage(
        {
          customType: "plan-mode-execute",
          content: executeMessage,
          display: true,
        },
        { triggerTurn: todoItems.length > 0 },
      );
      return;
    }

    if (choice === "Refine the plan") {
      const refinement = await ctx.ui.editor("Refine the plan:", "");
      if (refinement?.trim()) {
        pi.sendUserMessage(refinement.trim());
      }
    }
  });

  pi.on("session_start", async (_event, ctx) => {
    if (pi.getFlag("plan") === true) {
      planModeEnabled = true;
    }

    const entries = ctx.sessionManager.getEntries();
    const planModeEntry = entries
      .filter((entry: { type: string; customType?: string }) => entry.type === "custom" && entry.customType === "plan-mode")
      .pop() as { data?: PlanState } | undefined;

    if (planModeEntry?.data) {
      planModeEnabled = planModeEntry.data.enabled ?? planModeEnabled;
      executionMode = planModeEntry.data.executing ?? executionMode;
      todoItems = planModeEntry.data.todos ?? todoItems;
      restoreTools = planModeEntry.data.restoreTools ?? restoreTools;
    }

    if (restoreTools.length === 0) {
      restoreTools = pi.getActiveTools();
    }

    if (executionMode && todoItems.length > 0) {
      let executeIndex = -1;
      for (let index = entries.length - 1; index >= 0; index -= 1) {
        const entry = entries[index] as { customType?: string };
        if (entry.customType === "plan-mode-execute") {
          executeIndex = index;
          break;
        }
      }

      const assistantMessages: AssistantMessage[] = [];
      for (let index = executeIndex + 1; index < entries.length; index += 1) {
        const entry = entries[index];
        if (entry.type === "message" && "message" in entry && isAssistantMessage(entry.message as AgentMessage)) {
          assistantMessages.push(entry.message as AssistantMessage);
        }
      }

      const allText = assistantMessages.map(getTextContent).join("\n");
      markCompletedSteps(allText, todoItems);
    }

    if (planModeEnabled) {
      pi.setActiveTools(getPlanTools());
    } else if (executionMode) {
      restoreNormalTools();
    }

    updateStatus(ctx);
  });
}

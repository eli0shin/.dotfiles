import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";

export default function modelStatus(pi: ExtensionAPI): void {
  pi.on("model_select", async (event, ctx) => {
    const next = `${event.model.provider}/${event.model.id}`;

    if (event.source !== "restore") {
      ctx.ui.notify(`Model: ${next}`, "info");
    }

    ctx.ui.setStatus("model-status", `model ${event.model.id}`);
  });
}

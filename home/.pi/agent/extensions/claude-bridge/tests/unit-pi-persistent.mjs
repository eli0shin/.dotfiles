// Full Pi RPC -> bridge -> installed Claude -> local API stub. No real auth/API.
import { it } from "node:test";
import assert from "node:assert/strict";
import { once } from "node:events";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getModels } from "@earendil-works/pi-ai/compat";
import { createRpcHarness } from "./lib/rpc-harness.mjs";

it("Pi reuses one native query across a tool turn and a following user turn, then shuts it down", { timeout: 30_000 }, async () => {
	const cwd = mkdtempSync(join(tmpdir(), "pi-persistent-rpc-"));
	writeFileSync(join(cwd, "fixture.txt"), "persistent tool result");
	const requests = [];
	const server = createServer(async (request, response) => {
		const chunks = [];
		for await (const chunk of request) chunks.push(chunk);
		if (request.method !== "POST" || !request.url.startsWith("/v1/messages") || request.url.includes("count_tokens")) {
			response.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":10}');
			return;
		}
		const body = JSON.parse(Buffer.concat(chunks).toString());
		requests.push(body);
		const read = body.tools.find((tool) => tool.name === "mcp__custom-tools__read");
		assert.ok(read, "Pi read tool must be exposed through the MCP bridge");
		const toolTurn = requests.length === 1;
		const content = toolTurn ? { type: "tool_use", id: "rpc-read-1", name: read.name, input: {} } : { type: "text", text: "ACK" };
		const event = (type, fields) => `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
		response.writeHead(200, { "content-type": "text/event-stream" });
		response.end(
			[
				event("message_start", {
					message: {
						id: `rpc-${requests.length}`,
						type: "message",
						role: "assistant",
						model: body.model,
						content: [],
						stop_reason: null,
						stop_sequence: null,
						usage: { input_tokens: 10, output_tokens: 1 },
					},
				}),
				event("content_block_start", { index: 0, content_block: content }),
				event("content_block_delta", {
					index: 0,
					delta: toolTurn
						? { type: "input_json_delta", partial_json: JSON.stringify({ path: join(cwd, "fixture.txt") }) }
						: { type: "text_delta", text: "ACK" },
				}),
				event("content_block_stop", { index: 0 }),
				event("message_delta", {
					delta: { stop_reason: toolTurn ? "tool_use" : "end_turn", stop_sequence: null },
					usage: { output_tokens: 2 },
				}),
				event("message_stop", {}),
			].join(""),
		);
	});
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	const model = getModels("anthropic").find((model) => model.id.includes("haiku"));
	const h = createRpcHarness({
		name: "persistent-native-rpc",
		cwd,
		args: ["--model", `claude-bridge/${model.id}`],
		env: {
			ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`,
			ANTHROPIC_API_KEY: "offline-test",
			ANTHROPIC_AUTH_TOKEN: "",
			CLAUDE_BRIDGE_TEST_LOG_DIR: join(cwd, "logs"),
		},
	});
	try {
		await h.startAndWait(1500);
		const ended = once(h.pi(), "close");
		assert.equal(await h.promptAndWait("first persistent Pi user turn"), "ACK");
		assert.equal(await h.promptAndWait("second persistent Pi user turn"), "ACK");
		assert.equal(requests.length, 3, "one tool request, its continuation, then the second user turn");
		assert.match(JSON.stringify(requests[1].messages), /persistent tool result/);
		assert.match(JSON.stringify(requests[2].messages), /first persistent Pi user turn/);
		assert.match(JSON.stringify(requests[2].messages), /second persistent Pi user turn/);
		const log = readFileSync(h.DEBUG_LOG, "utf8");
		assert.equal((log.match(/provider: fresh query model=/g) ?? []).length, 1, "Pi must not reopen Claude for its next user turn");
		h.pi().stdin.end();
		const [code] = await ended;
		assert.equal(code, 0, "Pi shutdown awaits its persistent Claude child");
	} finally {
		await h.stop();
		server.closeAllConnections();
		await new Promise((resolve) => server.close(resolve));
	}
});

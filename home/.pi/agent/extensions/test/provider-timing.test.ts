import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { after, beforeEach, test } from "node:test";
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";

const agentDir = mkdtempSync(join(tmpdir(), "provider-timing-"));
const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
process.env.PI_CODING_AGENT_DIR = agentDir;
// Load after setting the isolated agent directory; timing uses the host Pi API.
const { registerTiming } = await import(new URL("../provider-reliability/timing.ts", import.meta.url).href);
const { LOG_PATH } = await import("../provider-reliability/log.ts");
if (previousAgentDir === undefined) delete process.env.PI_CODING_AGENT_DIR;
else process.env.PI_CODING_AGENT_DIR = previousAgentDir;

after(() => rmSync(agentDir, { recursive: true, force: true }));
beforeEach(() => rmSync(LOG_PATH, { force: true }));

function records(): Array<Record<string, any>> {
	try {
		return readFileSync(LOG_PATH, "utf8").trim().split("\n").map((line) => JSON.parse(line));
	} catch (error) {
		if ((error as NodeJS.ErrnoException).code === "ENOENT") return [];
		throw error;
	}
}

function harness() {
	const handlers = new Map<string, (event: any, ctx: ExtensionContext) => void>();
	registerTiming({
		on: (name: string, handler: (event: any, ctx: ExtensionContext) => void) => { handlers.set(name, handler); },
	} as unknown as ExtensionAPI);
	const ctx = (provider: string) => ({
		model: { provider, id: provider === "anthropic" ? "claude-sonnet" : "gpt-codex" },
		cwd: "/test",
		sessionManager: { getSessionId: () => "session-test" },
		ui: { setStatus: () => assert.fail("timing must not write footer status messages") },
	}) as unknown as ExtensionContext;
	return {
		emit(name: string, event: object = {}, provider = "anthropic") {
			handlers.get(name)?.(event, ctx(provider));
		},
	};
}

for (const provider of ["openai-codex", "openai", "google", "amazon-bedrock"]) {
	test(`timing ignores ${provider} requests, responses, and stream events`, (t) => {
		t.mock.timers.enable({ apis: ["Date", "setInterval"] });
		const { emit } = harness();
		emit("before_provider_request", { payload: { stream: true } }, provider);
		t.mock.timers.tick(60_000);
		emit("after_provider_response", { status: 200, headers: {} }, provider);
		emit("provider_stream_event", { provider, data: { type: "response.completed" } }, provider);
		emit("message_end", { message: { role: "assistant", provider, stopReason: "stop" } }, provider);
		emit("agent_end");
		emit("session_shutdown");
		assert.deepEqual(records(), []);
	});
}

test("Anthropic timing and stall logs remain, without any footer status", (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	const { emit } = harness();
	emit("before_provider_request", { payload: { max_tokens: 100 } });
	t.mock.timers.tick(30_000);
	assert.equal(records()[0].kind, "stall");
	assert.equal(records()[0].waitingFor, "headers");
	emit("after_provider_response", { status: 200, headers: { "request-id": "req_test" } });
	emit("provider_stream_event", { provider: "anthropic", data: { type: "message_start" } });
	t.mock.timers.tick(1_000);
	emit("provider_stream_event", { provider: "anthropic", data: { type: "content_block_start" } });
	t.mock.timers.tick(15_000);
	emit("provider_stream_event", { provider: "anthropic", data: { type: "message_stop" } });
	emit("message_end", { message: { role: "assistant", provider: "anthropic", stopReason: "stop", usage: { output: 10 } } });
	const request = records()[1];
	assert.equal(request.provider, "anthropic");
	assert.equal(request.headersMs, 30_000);
	assert.equal(request.firstEventMs, 30_000);
	assert.equal(request.firstContentMs, 31_000);
	assert.equal(request.totalMs, 46_000);
	assert.equal(request.requestId, "req_test");
	assert.equal(request.outputTokens, 10);
	assert.equal(request.outcome, "completed");
	t.mock.timers.tick(60_000);
	assert.equal(records().length, 2);
});

test("switching to Codex stops Anthropic tracking and does not track the WebSocket request", (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	const { emit } = harness();
	emit("before_provider_request", { payload: { max_tokens: 100 } });
	emit("before_provider_request", { payload: { max_tokens: 1 } });
	emit("before_provider_request", { payload: {} }, "openai-codex");
	assert.equal(records().length, 2);
	assert.ok(records().every((record) => record.provider === "anthropic" && record.outcome === "superseded"));
	t.mock.timers.tick(60_000);
	emit("provider_stream_event", { provider: "openai-codex", data: { type: "response.completed" } }, "openai-codex");
	emit("agent_end");
	assert.equal(records().length, 2);
	emit("before_provider_request", { payload: { max_tokens: 100 } });
	emit("agent_end");
	assert.equal(records()[2].idleMsSincePrevious, undefined);
});

test("non-Anthropic response, stream, and message events cannot mutate an Anthropic record", (t) => {
	t.mock.timers.enable({ apis: ["Date", "setInterval"] });
	const { emit } = harness();
	emit("before_provider_request", { payload: { max_tokens: 100 } });
	emit("after_provider_response", { status: 200, headers: { "request-id": "codex" } }, "openai-codex");
	emit("provider_stream_event", { provider: "openai-codex", data: { type: "content_block_start" } }, "openai-codex");
	emit("message_end", { message: { role: "assistant", provider: "openai-codex", stopReason: "stop" } }, "openai-codex");
	assert.deepEqual(records(), []);
	emit("agent_end");
	const [request] = records();
	assert.equal(request.headersMs, undefined);
	assert.equal(request.firstEventMs, undefined);
	assert.equal(request.firstContentMs, undefined);
	assert.equal(request.stopReason, undefined);
});

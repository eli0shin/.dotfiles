// Real SDK and Claude Code against a local API stub: every sync row's
// generated launch flags must be ones the native CLI accepts.
import { it, before, after } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { query } from "@anthropic-ai/claude-agent-sdk";
import { digestMessages } from "../src/message-digests.js";
const mod = await import("../src/index.js");
const { __test } = mod;
const handlers = {};
let provider;
mod.default({ on: (name, fn) => { (handlers[name] ??= []).push(fn); }, registerProvider: (_id, value) => { provider = value; }, registerTool: () => {} });
const model = provider.models.find((m) => m.id.includes("haiku")) ?? provider.models[0];
const user = (content) => ({ role: "user", content, timestamp: 1 });
const say = (text) => ({ role: "assistant", content: [{ type: "text", text }], provider: model.provider, timestamp: 1 });
const cwd = mkdtempSync(join(tmpdir(), "native-launch-"));
// A cloned repo's Claude Code settings must not run anything in bridge queries.
const repoHookRan = join(cwd, "repo-hook-ran");
mkdirSync(join(cwd, ".claude"));
for (const file of ["settings.json", "settings.local.json"]) {
	writeFileSync(join(cwd, ".claude", file), JSON.stringify({
		hooks: { UserPromptSubmit: [{ hooks: [{ type: "command", command: `touch '${repoHookRan}'` }] }] },
	}));
}
const requests = [], requestTools = [], launches = [], env = {};
const children = [];
let streamingWait;
let resolveStreamingWait;
const server = createServer(async (request, response) => {
	const chunks = [];
	for await (const chunk of request) chunks.push(chunk);
	if (request.method !== "POST" || !request.url.startsWith("/v1/messages") || request.url.includes("count_tokens")) {
		response.writeHead(200, { "content-type": "application/json" }).end('{"input_tokens":10}');
		return;
	}
	const body = JSON.parse(Buffer.concat(chunks).toString());
	requests.push(JSON.stringify(body.messages));
	requestTools.push((body.tools ?? []).map((tool) => tool.name));
	const event = (type, fields) => `event: ${type}\ndata: ${JSON.stringify({ type, ...fields })}\n\n`;
	response.writeHead(200, { "content-type": "text/event-stream" });
	const waiting = JSON.stringify(body.messages.findLast(message => message.role === "user")).includes("WAIT_NATIVE");
	const frames = [
		event("message_start", { message: { id: `msg_${requests.length}`, type: "message", role: "assistant", model: body.model, content: [], stop_reason: null, stop_sequence: null, usage: { input_tokens: 10, output_tokens: 1 } } }),
		event("content_block_start", { index: 0, content_block: { type: "text", text: "" } }),
		event("content_block_delta", { index: 0, delta: { type: "text_delta", text: waiting ? "partial native reply" : "ACK" } }),
		event("content_block_stop", { index: 0 }),
		event("message_delta", { delta: { stop_reason: "end_turn", stop_sequence: null }, usage: { output_tokens: 2 } }),
		event("message_stop", {}),
	];
	if (waiting) {
		response.write(frames.slice(0, 3).join(""));
		resolveStreamingWait?.();
	} else response.end(frames.join(""));
});

before(async () => {
	await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
	Object.assign(env, { ANTHROPIC_BASE_URL: `http://127.0.0.1:${server.address().port}`, ANTHROPIC_API_KEY: "offline-test", DISABLE_TELEMETRY: "1", DISABLE_ERROR_REPORTING: "1" });
	for (const [key, value] of Object.entries(env)) process.env[key] = value;
	for (const id of ["pi-native", "pi-ask"]) for (const fn of handlers.session_start) fn({}, { cwd, sessionManager: { getSessionId: () => id } });
	__test.resetSharedSession();
	__test.setQuery((params) => {
		launches.push(params.options);
		const spawn = params.options.spawnClaudeCodeProcess;
		return query({ ...params, options: { ...params.options, spawnClaudeCodeProcess: (options) => {
			const child = spawn(options);
			children.push(child);
			return child;
		} } });
	});
});
async function shutdown(id) {
	for (const fn of handlers.session_shutdown ?? []) await fn({}, { sessionManager: { getSessionId: () => id } });
	await new Promise(setImmediate);
}
after(async () => {
	await shutdown("pi-native");
	await shutdown("pi-ask");
	__test.setQuery(null);
	__test.resetSharedSession();
	for (const key of Object.keys(env)) delete process.env[key];
	server.closeAllConnections();
	await new Promise((resolve) => server.close(resolve));
	rmSync(cwd, { recursive: true, force: true });
});

async function turn(messages) {
	const output = await provider.streamSimple(model, { messages, tools: [] }, { sessionId: "pi-native", env: { PROVIDER_ENV_PROBE: "1" } }).result();
	assert.equal(output.stopReason, "stop", output.errorMessage);
	assert.deepEqual(output.content.filter((b) => b.type === "text").map((b) => b.text), ["ACK"]);
	return output;
}

it("native Claude Code accepts import, restart fork, prefix-write and AskClaude import launches", { timeout: 120_000 }, async () => {
	const prior = [user("first question"), say("first answer")];
	const second = await turn([...prior, user("second")]);
	assert.equal(launches[0].env.PROVIDER_ENV_PROBE, "1", "pi's provider env reaches Claude Code");
	assert.equal(launches[0].sessionId, undefined, "row 2 resumes its written import");
	assert.ok(launches[0].resume);
	assert.match(requests.at(-1), /first answer/);
	const warm = await turn([...prior, user("second"), second, user("warm third")]);
	assert.equal(launches.length, 1, "real SDK must keep the same native process across user turns");
	assert.equal(children.length, 1);
	assert.equal(children[0].exitCode, null, "the original native PID remains alive");
	assert.match(requests.at(-1), /second/);
	assert.match(requests.at(-1), /warm third/);
	// Keep the original scenario's history selected below; it also exercises
	// branching away from a live session after a history edit.

	const saved = __test.getSharedSession("pi-native");
	assert.deepEqual(saved.digests, digestMessages([...prior, user("second"), second, user("warm third"), warm]), "CC's replay acknowledged the prompt");
	assert.equal(saved.dirtyTail, false);
	await shutdown("pi-native");
	for (const fn of handlers.session_start) fn({}, { cwd, sessionManager: { getSessionId: () => "pi-native" } });
	__test.forgetSessionMemory();
	const third = await turn([...prior, user("second"), second, user("warm third"), warm, user("third")]);
	assert.equal(launches[1].forkSession, true, "a restart forks the persisted pointer");
	assert.equal(launches[1].resume, saved.ccSessionId);
	assert.ok(launches[1].sessionId);

	await turn([user("REDACTED question"), say("first answer"), user("second"), second, user("third"), third, user("fourth")]);
	assert.equal(launches[2].sessionId, undefined, "row 7 resumes its written prefix");
	assert.equal(launches[2].forkSession, undefined);
	assert.match(requests.at(-1), /REDACTED question/);

	const answer = await __test.promptAndWait("delegated", "none", new Map(), undefined, { model: model.id, appendSkills: false, context: prior, piSessionId: "pi-ask" });
	assert.equal(answer.responseText, "ACK");
	assert.equal(launches[3].sessionId, undefined, "AskClaude's import resumes its written id");
	assert.ok(launches[3].resume);
	assert.equal(__test.getSharedSession("pi-ask"), null);
	assert.equal(existsSync(repoHookRan), false, "a hook from the repo's .claude settings ran");
});

it("a pre-aborted native prompt never launches Claude or reaches HTTP", { timeout: 3000 }, async () => {
	const controller = new AbortController();
	controller.abort();
	const processes = children.length, sent = requests.length;
	const output = await provider.streamSimple(model, { messages: [user("cancelled before startup")], tools: [] }, { sessionId: "pi-native", signal: controller.signal }).result();
	assert.equal(output.stopReason, "aborted");
	assert.equal(children.length, processes);
	assert.equal(requests.length, sent);
});

it("native interruption drains then accepts another user turn on the same PID", { timeout: 30_000 }, async () => {
	await shutdown("pi-native");
	__test.resetSharedSession();
	for (const fn of handlers.session_start) fn({}, { cwd, sessionManager: { getSessionId: () => "pi-native" } });
	const before = children.length;
	streamingWait = new Promise(resolve => { resolveStreamingWait = resolve; });
	const controller = new AbortController();
	const ask = user("WAIT_NATIVE");
	const active = provider.streamSimple(model, { messages: [ask], tools: [] }, { sessionId: "pi-native", signal: controller.signal, env: { PROVIDER_ENV_PROBE: "1" } });
	await Promise.race([streamingWait, active.result().then(output => { throw new Error(`Turn ended before the streaming probe: ${JSON.stringify(output)}`); })]);
	// Wait for Pi's partial stream, not merely the server's socket write.
	for await (const frame of active) {
		if (frame.type === "text_delta") { controller.abort(); break; }
	}
	const partial = await active.result();
	assert.equal(partial.stopReason, "aborted");
	const next = await turn([ask, partial, user("continue after interruption")]);
	assert.equal(next.stopReason, "stop");
	assert.equal(children.length, before + 1, "interrupt/resume must not spawn a replacement process");
	assert.equal(children.at(-1).exitCode, null);
	resolveStreamingWait = undefined;
});

it("native idle expiry resumes saved history in a new process", { timeout: 30_000 }, async () => {
	await shutdown("pi-native");
	__test.resetSharedSession();
	for (const fn of handlers.session_start) fn({}, { cwd, sessionManager: { getSessionId: () => "pi-native" } });
	__test.setIdleTimeout(30);
	const ask = user("remember this native session");
	const answer = await turn([ask]);
	const child = children.at(-1), before = children.length;
	while (child.exitCode === null && child.signalCode === null) await new Promise(resolve => setTimeout(resolve, 10));
	__test.setIdleTimeout(3_600_000);
	await turn([ask, answer, user("after idle expiry")]);
	assert.equal(children.length, before + 1);
	assert.match(requests.at(-1), /remember this native session/);
	assert.match(requests.at(-1), /after idle expiry/);
});

// The real CLI honours tools/list_changed for added tools; a removal restarts,
// because Claude Code would keep the removed tool in its requests (onlyAddsTools).
it("native Claude Code takes added tools on the same PID, and a removal restarts it", { timeout: 30_000 }, async () => {
	await shutdown("pi-native");
	__test.resetSharedSession();
	for (const fn of handlers.session_start) fn({}, { cwd, sessionManager: { getSessionId: () => "pi-native" } });
	const tool = (name) => ({ name, description: `${name} tool`, parameters: { type: "object", properties: { path: { type: "string" } } } });
	const send = async (messages, tools) => {
		const output = await provider.streamSimple(model, { messages, tools }, { sessionId: "pi-native" }).result();
		assert.equal(output.stopReason, "stop", output.errorMessage);
		return output;
	};
	const ask = user("tools one");
	const answer = await send([ask], [tool("read")]);
	assert.deepEqual(requestTools.at(-1), ["mcp__custom-tools__read"]);
	const child = children.at(-1), before = children.length;
	const second = await send([ask, answer, user("tools two")], [tool("read"), tool("write")]);
	assert.equal(children.length, before, "an added tool must not spawn a replacement process");
	assert.equal(child.exitCode, null);
	assert.deepEqual(requestTools.at(-1), ["mcp__custom-tools__read", "mcp__custom-tools__write"], "the added tool reaches the API");
	await send([ask, answer, user("tools two"), second, user("tools three")], [tool("write")]);
	assert.equal(children.length, before + 1, "a removed tool restarts Claude");
	assert.deepEqual(requestTools.at(-1), ["mcp__custom-tools__write"], "the restarted process no longer offers it");
});

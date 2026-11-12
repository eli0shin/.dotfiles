// Exercise the registered provider: the external SDK alone is scripted.
import { it, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync, existsSync, readFileSync, appendFileSync, mkdirSync, writeFileSync } from "node:fs";
import { createSession, getSessionPath } from "cc-session-io";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
const mod = await import("../src/index.js");
const { __test } = mod;
let provider;
const handlers = {};
mod.default({
	on(name, fn) {
		(handlers[name] ??= []).push(fn);
	},
	registerProvider(_id, config) {
		provider = config;
	},
	registerTool() {},
});
const model = provider.models[0];
const user = (content) => ({ role: "user", content, timestamp: 1 });
const tick = () => new Promise(setImmediate);
let launches;
function queue() {
	const values = [];
	let wake;
	let ended = false;
	return {
		push(value) {
			values.push(value);
			wake?.();
		},
		end() {
			ended = true;
			wake?.();
		},
		async *[Symbol.asyncIterator]() {
			while (true) {
				if (values.length) {
					yield values.shift();
					continue;
				}
				if (ended) return;
				await new Promise((resolve) => {
					wake = resolve;
				});
			}
		},
	};
}
function sdk({ prompt, options }) {
	const output = queue();
	const launch = { options, closed: false, interrupted: 0, inputs: [], output, models: [], efforts: [], toolLists: [] };
	launches.push(launch);
	// Like Claude Code: list the served tools at startup and again on list_changed,
	// unless the test scripts a CLI that ignores the notification.
	const toolServer = options.mcpServers?.["custom-tools"];
	if (toolServer) {
		let requestId = 0;
		const transport = {
			start: async () => {},
			close: async () => {},
			send: async (message) => {
				if (message.method === "notifications/tools/list_changed" && !launch.ignoreListChanged) listTools();
				else if (message.result?.tools) launch.toolLists.push(message.result.tools.map((tool) => tool.name));
			},
		};
		const listTools = () => transport.onmessage({ jsonrpc: "2.0", id: ++requestId, method: "tools/list" });
		void toolServer.instance.connect(transport).then(listTools);
	}
	const id = options.sessionId ?? options.resume;
	const path = getSessionPath(id, options.cwd, process.env.CLAUDE_CONFIG_DIR);
	if (options.forkSession) {
		const records = readFileSync(getSessionPath(options.resume, options.cwd, process.env.CLAUDE_CONFIG_DIR), "utf8")
			.trim()
			.split("\n")
			.map(JSON.parse);
		const cut = records.findIndex((r) => r.uuid === options.resumeSessionAt);
		mkdirSync(dirname(path), { recursive: true });
		writeFileSync(
			path,
			records
				.slice(0, cut + 1)
				.map((r) => JSON.stringify({ ...r, sessionId: id }))
				.join("\n") + "\n",
		);
	}
	let parent = existsSync(path) ? readFileSync(path, "utf8").trim().split("\n").map(JSON.parse).at(-1)?.uuid : null;
	const record = (role, content, uuid = randomUUID()) => {
		const builder = createSession({ projectPath: options.cwd, sessionId: id });
		if (role === "assistant") builder.addAssistantMessage(content);
		else builder.addUserMessage(content);
		const row = { ...builder.records[0], uuid, parentUuid: parent };
		parent = uuid;
		mkdirSync(dirname(path), { recursive: true });
		appendFileSync(path, JSON.stringify(row) + "\n");
		return uuid;
	};
	output.push({ type: "system", subtype: "init", session_id: id });
	void (async () => {
		try {
			for await (const input of prompt) {
				launch.inputRead = (launch.inputRead ?? 0) + 1;
				if (launch.inputGate) await launch.inputGate;
				if (launch.closed) break;
				launch.inputs.push(input);
				record("user", input.message.content, input.uuid);
				output.push({ type: "user", isReplay: true, parent_tool_use_id: null, uuid: input.uuid, message: input.message });
				const text =
					typeof input.message.content === "string" ? input.message.content : input.message.content.map((b) => b.text ?? "").join("");
				if (text === "WAIT") continue;
				const tool = text === "TOOL";
				const content = tool
					? [{ type: "tool_use", id: "call-x", name: "mcp__custom-tools__read", input: {} }]
					: [{ type: "text", text: `answer:${text}` }];
				output.push({
					type: "assistant",
					parent_tool_use_id: null,
					uuid: record("assistant", content),
					message: { id: randomUUID(), model: model.id, content },
				});
				if (!tool) output.push({ type: "result", subtype: "success", is_error: false, result: `answer:${text}`, session_id: id });
			}
		} catch {
		} finally {
			output.end();
		}
	})();
	const gen = output[Symbol.asyncIterator]();
	gen.interrupt = async () => {
		launch.interrupted++;
		// Like the real SDK, control acknowledgement precedes the final result.
		setImmediate(() => output.push({ type: "result", subtype: "success", is_error: true, result: "Interrupted", session_id: id }));
	};
	gen.setModel = async (model) => {
		launch.models.push(model);
		await launch.modelGate;
	};
	gen.applyFlagSettings = async (settings) => {
		launch.efforts.push(settings.effortLevel);
	};
	gen.close = () => {
		launch.closed = true;
		output.end();
	};
	return gen;
}
const tools = [{ name: "read", description: "read", parameters: { type: "object", properties: {} } }];
const call = (messages, options = {}, context = {}) =>
	provider.streamSimple(model, { messages, tools, ...context }, { sessionId: "persistent-pi", ...options });
const shutdown = async (id = "persistent-pi") => {
	for (const fn of handlers.session_shutdown ?? []) await fn({}, { sessionManager: { getSessionId: () => id } });
	await tick();
	await tick();
};
beforeEach(() => {
	process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(), "persistent-cc-"));
	__test.resetSharedSession();
	launches = [];
	__test.setQuery(sdk);
});
afterEach(async () => {
	for (const c of [...__test.activeQueryContexts]) await shutdown(c.piSessionId);
	__test.setIdleTimeout?.(3_600_000);
	__test.setToolRelistTimeout?.(3000);
	__test.setQuery(null);
});
it("starts TUI provider turns without welcome notices or notice-related config writes", { timeout: 3000 }, async () => {
	const notifications = [];
	const config = join(process.env.PI_CODING_AGENT_DIR, "claude-bridge.json");
	const before = existsSync(config) ? readFileSync(config, "utf8") : null;
	for (const fn of handlers.session_start ?? []) fn({}, {
		cwd: process.cwd(), mode: "tui", ui: { notify: message => notifications.push(message) },
		sessionManager: { getSessionId: () => "persistent-pi" },
	});
	const ask = user("one"), answer = await call([ask]).result();
	await call([ask, answer, user("two")]).result();
	assert.deepEqual(notifications, []);
	assert.equal(existsSync(config) ? readFileSync(config, "utf8") : null, before);
});
it("reuses one live SDK process across completed user turns", { timeout: 3000 }, async () => {
	const first = user("one");
	const answer = await call([first]).result();
	assert.equal(answer.stopReason, "stop");
	assert.equal(launches[0].closed, false, "a user response must not close Claude");
	const second = await call([first, answer, user("two")]).result();
	assert.equal(second.content[0].text, "answer:two");
	assert.equal(launches.length, 1);
	assert.equal(launches[0].inputs.length, 2);
});
it("never starts Claude for an already-cancelled prompt", { timeout: 3000 }, async () => {
	const controller = new AbortController();
	controller.abort();
	const output = await call([user("must not be sent")], { signal: controller.signal }).result();
	assert.equal(output.stopReason, "aborted");
	assert.equal(launches.length, 0);
});
it("retires queued startup input when cancellation precedes its replay acknowledgement", { timeout: 3000 }, async () => {
	let started, release;
	const ready = new Promise((resolve) => {
		started = resolve;
	});
	const gate = new Promise((resolve) => {
		release = resolve;
	});
	let sent = 0,
		closed = false;
	__test.setQuery(({ prompt }) => {
		const gen = (async function* () {
			started();
			await gate;
			for await (const _ of prompt) sent++;
		})();
		gen.interrupt = async () => {};
		gen.close = () => {
			closed = true;
			release();
		};
		return gen;
	});
	const controller = new AbortController();
	const pending = call([user("must not leave the queue")], { signal: controller.signal });
	await ready;
	controller.abort();
	const output = await pending.result();
	assert.equal(output.stopReason, "aborted");
	assert.equal(sent, 0);
	assert.equal(closed, true);
});
it("a cancelled warm prompt neither reaches Claude nor disables idle expiry", { timeout: 3000 }, async () => {
	__test.setIdleTimeout(20);
	const ask = user("one"),
		answer = await call([ask]).result();
	const controller = new AbortController();
	controller.abort();
	const output = await call([ask, answer, user("must not be sent")], { signal: controller.signal }).result();
	assert.equal(output.stopReason, "aborted");
	await new Promise((resolve) => setTimeout(resolve, 80));
	assert.equal(launches.length, 1);
	assert.equal(launches[0].inputs.length, 1);
	assert.equal(launches[0].closed, true, "cancelled setup must not lose idle cleanup");
});
it("cancellation during a live model change cannot enqueue the cancelled prompt", { timeout: 3000 }, async () => {
	const ask = user("one"),
		answer = await call([ask]).result();
	let release;
	launches[0].modelGate = new Promise((resolve) => {
		release = resolve;
	});
	const controller = new AbortController();
	const other = provider.models.find((m) => m.id !== model.id);
	const pending = provider.streamSimple(
		other,
		{ messages: [ask, answer, user("must not be sent")], tools },
		{ sessionId: "persistent-pi", signal: controller.signal },
	);
	while (!launches[0].models.length) await tick();
	controller.abort();
	release();
	const output = await pending.result();
	assert.equal(output.stopReason, "aborted");
	assert.equal(launches[0].inputs.length, 1, "the SDK input queue must never receive the cancelled prompt");
	assert.equal(launches[0].closed, true, "failed setup must retire or re-arm idle cleanup");
});
it("cancelling an unacknowledged later turn never deletes earlier native progress", { timeout: 3000 }, async () => {
	const ask = user("one"),
		answer = await call([ask]).result();
	const state = __test.getSharedSession("persistent-pi");
	const path = getSessionPath(state.ccSessionId, state.cwd, process.env.CLAUDE_CONFIG_DIR);
	let release;
	launches[0].inputGate = new Promise((resolve) => {
		release = resolve;
	});
	const controller = new AbortController();
	const pending = call([ask, answer, user("cancelled later startup")], { signal: controller.signal });
	while (launches[0].inputRead !== 2) await tick();
	controller.abort();
	assert.equal((await pending.result()).stopReason, "aborted");
	await shutdown();
	release();
	assert.ok(existsSync(path), "retiring a later no-progress turn must retain the earlier transcript");
	assert.equal(launches[0].inputs.length, 1);
});
it("does not retain all prior turns raw SDK content in the persistent context", { timeout: 3000 }, async () => {
	const history = [];
	for (let i = 0; i < 12; i++) {
		history.push(user(`turn ${i}`));
		history.push(await call(history).result());
	}
	assert.equal(launches.length, 1);
	const [context] = __test.activeQueryContexts;
	assert.equal(context.assistantSteps.size, 1);
	assert.equal(context.recording.recorded.digests.length, 24);
});
it("isolates simultaneous Pi sessions", { timeout: 3000 }, async () => {
	const a = user("a"),
		b = user("b");
	const [aa, ba] = await Promise.all([call([a]).result(), call([b], { sessionId: "other" }).result()]);
	await call([a, aa, user("a2")]).result();
	await call([b, ba, user("b2")], { sessionId: "other" }).result();
	assert.equal(launches.length, 2);
	assert.deepEqual(
		launches.map((l) => l.inputs.length),
		[2, 2],
	);
	await shutdown();
	assert.equal(launches[0].closed, true);
	assert.equal(launches[1].closed, false);
});
it("interrupts and drains a running turn without killing its session", { timeout: 3000 }, async () => {
	const controller = new AbortController();
	const ask = user("WAIT");
	const pending = call([ask], { signal: controller.signal });
	while (!launches[0]?.inputs.length) await tick();
	controller.abort();
	const aborted = await pending.result();
	assert.equal(aborted.stopReason, "aborted");
	const next = await call([ask, aborted, user("continue")]).result();
	assert.equal(next.stopReason, "stop", next.errorMessage);
	assert.equal(launches.length, 1);
	assert.equal(launches[0].interrupted, 1);
	assert.equal(launches[0].closed, false);
});
it("does not let a completed request signal kill an idle session", { timeout: 3000 }, async () => {
	const controller = new AbortController(),
		ask = user("one");
	const answer = await call([ask], { signal: controller.signal }).result();
	controller.abort();
	await call([ask, answer, user("two")]).result();
	assert.equal(launches.length, 1);
	assert.equal(launches[0].interrupted, 0);
});
it("expires idle processes, but never times out a tool or permission wait", { timeout: 3000 }, async () => {
	__test.setIdleTimeout(20);
	await call([user("one")]).result();
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(launches[0].closed, true);
	await call([user("TOOL")]).result();
	await new Promise((resolve) => setTimeout(resolve, 60));
	assert.equal(launches[1].closed, false, "a parked tool is active, not idle");
});
it("restarts for changed connection settings", { timeout: 3000 }, async () => {
	const ask = user("one"),
		answer = await call([ask]).result();
	const next = await call([ask, answer, user("two")], { env: { TEST_CONNECTION: "changed" } }).result();
	assert.equal(launches.length, 2);
	assert.equal(launches[0].closed, true);
	assert.equal(next.stopReason, "stop", next.errorMessage);
});
it("swaps added tools onto the live process", { timeout: 3000 }, async () => {
	const ask = user("one"),
		answer = await call([ask]).result();
	const write = { name: "write", description: "write", parameters: { type: "object", properties: {} } };
	const next = await call([ask, answer, user("two")], {}, { tools: [...tools, write] }).result();
	assert.equal(next.stopReason, "stop", next.errorMessage);
	assert.equal(launches.length, 1, "an added tool must not restart Claude");
	assert.equal(launches[0].closed, false);
	assert.deepEqual(launches[0].toolLists.at(-1), ["read", "write"], "Claude re-lists before the turn is sent");
	assert.equal(launches[0].inputs.length, 2);
});
it("restarts for removed or redefined tools, which Claude would keep offering", { timeout: 3000 }, async () => {
	const ask = user("one"),
		answer = await call([ask]).result();
	const next = await call([ask, answer, user("two")], {}, { tools: [] }).result();
	assert.equal(next.stopReason, "stop", next.errorMessage);
	assert.equal(launches.length, 2, "a removed tool restarts");
	assert.equal(launches[0].closed, true);
	assert.equal(launches[0].toolLists.length, 1, "no swap was attempted");
	const redefined = [{ ...tools[0], description: "read, redefined" }];
	const third = await call([ask, answer, user("two"), next, user("three")], {}, { tools: redefined }).result();
	assert.equal(third.stopReason, "stop", third.errorMessage);
	assert.equal(launches.length, 3, "a redefined tool restarts");
});
it("relaunches when Claude never re-lists a changed tool declaration", { timeout: 3000 }, async () => {
	__test.setToolRelistTimeout(30);
	const ask = user("one"),
		answer = await call([ask]).result();
	launches[0].ignoreListChanged = true;
	const write = { name: "write", description: "write", parameters: { type: "object", properties: {} } };
	const next = await call([ask, answer, user("two")], {}, { tools: [...tools, write] }).result();
	assert.equal(next.stopReason, "stop", next.errorMessage);
	assert.equal(next.content[0].text, "answer:two");
	assert.equal(launches.length, 2);
	assert.equal(launches[0].closed, true);
	assert.equal(launches[0].inputs.length, 1, "the abandoned process never receives the turn");
	assert.deepEqual(launches[1].toolLists[0], ["read", "write"]);
});
it("restarts for a tool change on a process launched without tools", { timeout: 3000 }, async () => {
	const ask = user("one"),
		answer = await call([ask], {}, { tools: [] }).result();
	const next = await call([ask, answer, user("two")]).result();
	assert.equal(next.stopReason, "stop", next.errorMessage);
	assert.equal(launches.length, 2);
	assert.equal(launches[0].closed, true);
});
it("session shutdown from a separately loaded extension closes the owning process only", { timeout: 3000 }, async () => {
	await call([user("mine")]).result();
	await call([user("other")], { sessionId: "other" }).result();
	const fresh = await import(`../src/index.js?separate-runtime=${Date.now()}`);
	const freshHandlers = {};
	fresh.default({
		on(name, fn) {
			(freshHandlers[name] ??= []).push(fn);
		},
		registerProvider() {},
		registerTool() {},
	});
	for (const fn of freshHandlers.session_shutdown) await fn({}, { sessionManager: { getSessionId: () => "persistent-pi" } });
	assert.equal(launches[0].closed, true);
	assert.equal(launches[1].closed, false);
});
it("isolates the provider from user Claude settings and uses verbatim Pi prompts", { timeout: 3000 }, async () => {
	await call([user("one")]).result();
	assert.deepEqual(launches[0].options.settingSources, []);
	assert.equal(launches[0].options.settings.disableAllHooks, true);
	assert.equal(launches[0].options.verbatimPrompts, true);
	assert.deepEqual(launches[0].options.tools, []);
});
it("changes model and effort on the live process", { timeout: 3000 }, async () => {
	const ask = user("one"),
		answer = await call([ask]).result();
	const other = provider.models.find((m) => m.id !== model.id);
	const next = await provider
		.streamSimple(other, { messages: [ask, answer, user("two")], tools }, { sessionId: "persistent-pi", reasoning: "high" })
		.result();
	assert.equal(next.stopReason, "stop", next.errorMessage);
	assert.equal(next.model, other.id);
	assert.equal(launches.length, 1);
	assert.equal(launches[0].models.length, 1);
	assert.equal(launches[0].efforts.length, 1);
});
it("restarts when Pi instructions or a nested tool schema change", { timeout: 3000 }, async () => {
	const prompt = "test assembled Pi instructions";
	const capture = (customPrompt) => {
		for (const fn of handlers.before_agent_start ?? []) fn({ systemPrompt: prompt, systemPromptOptions: { customPrompt } });
	};
	capture("policy one");
	const ask = user("one"),
		answer = await call([ask], {}, { systemPrompt: prompt }).result();
	capture("policy two");
	const next = await call([ask, answer, user("two")], {}, { systemPrompt: prompt }).result();
	assert.equal(next.stopReason, "stop", next.errorMessage);
	assert.equal(launches.length, 2);
	assert.match(launches[1].options.systemPrompt.append, /policy two/);
	assert.equal(launches[1].options.systemPrompt.snapshot, false);
	const changedTools = [
		{
			...tools[0],
			parameters: { type: "object", properties: { nested: { type: "object", properties: { required: { type: "boolean" } } } } },
		},
	];
	const third = await call([ask, answer, user("two"), next, user("three")], {}, { systemPrompt: prompt, tools: changedTools }).result();
	assert.equal(third.stopReason, "stop", third.errorMessage);
	assert.equal(launches.length, 3);
});
it("forwards raw SDK events to the provider observer for each new turn", { timeout: 3000 }, async () => {
	const observed = [],
		first = user("one");
	const answer = await call([first], {
		onProviderStreamEvent: (event) => {
			observed.push(["one", event.type]);
		},
	}).result();
	await call([first, answer, user("two")], {
		onProviderStreamEvent: (event) => {
			observed.push(["two", event.type]);
		},
	}).result();
	assert.ok(observed.some(([turn, type]) => turn === "one" && type === "assistant"));
	assert.ok(observed.some(([turn, type]) => turn === "two" && type === "assistant"));
	assert.equal(launches.length, 1);
});
it("an isolated Pi summary never replaces or closes the live process", { timeout: 3000 }, async () => {
	const ask = user("one"),
		answer = await call([ask]).result();
	// Summary uses the existing one-shot SDK path, so script a finite query for it.
	__test.setQuery(({ options }) => {
		assert.equal(options.persistSession, false);
		const gen = (async function* () {
			yield { type: "result", subtype: "success", is_error: false, result: "summary" };
		})();
		gen.close = () => {};
		gen.interrupt = async () => {};
		return gen;
	});
	const summary = await call([user("summarize")], { cacheRetention: "none" }).result();
	assert.equal(summary.content[0].text, "summary");
	__test.setQuery(sdk);
	await call([ask, answer, user("two")]).result();
	assert.equal(launches.length, 1);
	assert.equal(launches[0].closed, false);
});

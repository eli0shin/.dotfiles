import assert from "node:assert/strict";
import test from "node:test";
import {
	createStallGuardFetch,
	firstRealEvent,
	isGuardedRequest,
	type StallGuardOptions,
	type StallInfo,
	stallGuardOptionsFromEnv,
} from "../provider-reliability/stall-guard.ts";

const URL_MESSAGES = "https://api.anthropic.com/v1/messages?beta=true";
const STREAM_INIT = { method: "POST", body: JSON.stringify({ model: "m", stream: true }) };
const PING = "event: ping\ndata: {\"type\": \"ping\"}\n\n";
const START = 'event: message_start\ndata: {"type":"message_start","message":{"id":"msg_1"}}\n\n';
const STOP = 'event: message_stop\ndata: {"type":"message_stop"}\n\n';

type Step = { afterMs: number; text: string };

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function abortable<T>(signal: AbortSignal | null | undefined, work: Promise<T>): Promise<T> {
	return new Promise<T>((resolve, reject) => {
		if (signal?.aborted) return reject(signal.reason);
		signal?.addEventListener("abort", () => reject(signal.reason), { once: true });
		work.then(resolve, reject);
	});
}

/** A fake upstream: optional header delay, then timed SSE chunks; aborts like undici. */
function upstream(headersAfterMs: number, steps: Step[], status = 200) {
	return async (init?: RequestInit): Promise<Response> => {
		const signal = init?.signal;
		await abortable(signal, sleep(headersAfterMs));
		let i = 0;
		const encoder = new TextEncoder();
		const body = new ReadableStream<Uint8Array>({
			async pull(controller) {
				if (i >= steps.length) return controller.close();
				const step = steps[i++];
				await abortable(signal, sleep(step.afterMs));
				controller.enqueue(encoder.encode(step.text));
			},
		});
		return new Response(body, { status, headers: { "content-type": "text/event-stream", "request-id": "req_test" } });
	};
}

function fakeFetch(attempts: Array<(init?: RequestInit) => Promise<Response>>) {
	const calls: RequestInit[] = [];
	const fn = (async (_input: unknown, init?: RequestInit) => {
		calls.push(init ?? {});
		const next = attempts[Math.min(calls.length - 1, attempts.length - 1)];
		return next(init);
	}) as typeof fetch;
	return { fn, calls };
}

function options(overrides: Partial<StallGuardOptions> = {}) {
	const resends: StallInfo[] = [];
	const giveUps: StallInfo[] = [];
	const opts: StallGuardOptions = {
		firstEventDeadlineMs: 200,
		postHeadersGraceMs: 60,
		maxResends: 2,
		onResend: (info) => resends.push(info),
		onGiveUp: (info) => giveUps.push(info),
		...overrides,
	};
	return { opts, resends, giveUps };
}

test("only guards streaming POSTs to Anthropic's Messages API", () => {
	assert.equal(isGuardedRequest(URL_MESSAGES, STREAM_INIT), true);
	assert.equal(isGuardedRequest(URL_MESSAGES, { method: "POST", body: '{"stream":false}' }), false);
	assert.equal(isGuardedRequest("https://api.anthropic.com/v1/models", STREAM_INIT), false);
	assert.equal(isGuardedRequest("https://example.com/v1/messages", STREAM_INIT), false);
	assert.equal(isGuardedRequest(URL_MESSAGES, { body: STREAM_INIT.body }), false);
});

test("finds the first non-ping SSE event only once it is complete", () => {
	assert.equal(firstRealEvent(PING + PING), undefined);
	assert.equal(firstRealEvent(PING + "event: message_start\ndata: {"), undefined);
	assert.equal(firstRealEvent(PING + START), "message_start");
	assert.equal(firstRealEvent('data: {"type":"message_start"}\r\n\r\n'), "message_start");
	assert.equal(firstRealEvent('event: error\ndata: {"type":"error"}\n\n'), "error");
});

test("hands back the full stream, pings included, when message_start arrives in time", async () => {
	const { fn, calls } = fakeFetch([upstream(10, [{ afterMs: 5, text: PING }, { afterMs: 5, text: START }, { afterMs: 5, text: STOP }])]);
	const { opts, resends } = options();
	const response = await createStallGuardFetch(fn, opts)(URL_MESSAGES, STREAM_INIT);
	assert.equal(await response.text(), PING + START + STOP);
	assert.equal(response.headers.get("request-id"), "req_test");
	assert.equal(calls.length, 1);
	assert.deepEqual(resends, []);
});

test("re-sends when response headers never arrive", async () => {
	const { fn, calls } = fakeFetch([upstream(10_000, []), upstream(5, [{ afterMs: 5, text: START + STOP }])]);
	const { opts, resends } = options();
	const response = await createStallGuardFetch(fn, opts)(URL_MESSAGES, STREAM_INIT);
	assert.equal(await response.text(), START + STOP);
	assert.equal(calls.length, 2);
	assert.equal(calls[1].body, STREAM_INIT.body);
	assert.equal(resends.length, 1);
	assert.equal(resends[0].stage, "headers");
	assert.equal(resends[0].attempt, 1);
});

test("re-sends when headers arrive but only pings follow", async () => {
	const pingsForever = Array.from({ length: 50 }, () => ({ afterMs: 20, text: PING }));
	const { fn, calls } = fakeFetch([upstream(5, pingsForever), upstream(5, [{ afterMs: 5, text: START + STOP }])]);
	const { opts, resends } = options();
	const response = await createStallGuardFetch(fn, opts)(URL_MESSAGES, STREAM_INIT);
	assert.equal(await response.text(), START + STOP);
	assert.equal(calls.length, 2);
	assert.equal(resends[0].stage, "first_event");
	assert.equal(resends[0].requestId, "req_test");
	assert.ok((resends[0].elapsedMs ?? 0) < 200, "post-headers grace fires before the overall deadline");
});

test("gives up with a retryable timeout error after maxResends", async () => {
	const { fn, calls } = fakeFetch([upstream(10_000, [])]);
	const { opts, resends, giveUps } = options({ maxResends: 1, firstEventDeadlineMs: 50 });
	await assert.rejects(createStallGuardFetch(fn, opts)(URL_MESSAGES, STREAM_INIT), /timed out/);
	assert.equal(calls.length, 2);
	assert.equal(resends.length, 1);
	assert.equal(giveUps.length, 1);
});

test("a caller abort rejects without re-sending", async () => {
	const { fn, calls } = fakeFetch([upstream(10_000, [])]);
	const { opts, resends } = options({ firstEventDeadlineMs: 5_000 });
	const controller = new AbortController();
	const pending = createStallGuardFetch(fn, opts)(URL_MESSAGES, { ...STREAM_INIT, signal: controller.signal });
	setTimeout(() => controller.abort(new Error("user abort")), 20);
	await assert.rejects(pending, /user abort/);
	assert.equal(calls.length, 1);
	assert.deepEqual(resends, []);
});

test("a caller abort after hand-off still cancels the stream", async () => {
	const steps = [{ afterMs: 5, text: START }, ...Array.from({ length: 50 }, () => ({ afterMs: 20, text: PING }))];
	const { fn } = fakeFetch([upstream(5, steps)]);
	const { opts } = options();
	const controller = new AbortController();
	const response = await createStallGuardFetch(fn, opts)(URL_MESSAGES, { ...STREAM_INIT, signal: controller.signal });
	setTimeout(() => controller.abort(new Error("user abort")), 30);
	await assert.rejects(response.text(), /user abort/);
});

test("error responses and unguarded requests pass through untouched", async () => {
	const { fn, calls } = fakeFetch([upstream(5, [{ afterMs: 0, text: '{"error":"overloaded"}' }], 529)]);
	const { opts } = options();
	const guarded = createStallGuardFetch(fn, opts);
	assert.equal((await guarded(URL_MESSAGES, STREAM_INIT)).status, 529);
	await guarded("https://example.com/", {});
	assert.equal(calls.length, 2);
});

test("a zero deadline disables the guard", async () => {
	const { fn, calls } = fakeFetch([upstream(100, [{ afterMs: 0, text: PING }])]);
	const { opts, resends } = options({ firstEventDeadlineMs: 0 });
	const response = await createStallGuardFetch(fn, opts)(URL_MESSAGES, STREAM_INIT);
	assert.equal(await response.text(), PING);
	assert.equal(calls.length, 1);
	assert.deepEqual(resends, []);
});

test("reads overrides from the environment and ignores invalid values", () => {
	assert.deepEqual(
		stallGuardOptionsFromEnv({ PI_STALL_FIRST_EVENT_DEADLINE_MS: "40000", PI_STALL_MAX_RESENDS: "x" }),
		{ firstEventDeadlineMs: 40_000, postHeadersGraceMs: 3_000, maxResends: 2 },
	);
});

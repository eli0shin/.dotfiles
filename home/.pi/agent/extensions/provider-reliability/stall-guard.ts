// Anthropic sometimes accepts a streaming /v1/messages request and then holds
// it: response headers arrive late (~30s) and only `ping` keepalives follow,
// sometimes for many minutes. Pings reset every idle timer, so pi waits.
//
// This wraps fetch for those requests and withholds the Response from the SDK
// until the first real SSE event (normally `message_start`) arrives. When it
// does not arrive in time, the attempt is aborted and the identical request is
// re-sent. Nothing has reached the session yet, so the re-send is invisible.
// After `maxResends`, it throws a "timed out" error that pi's retry handles.

export type StallStage = "headers" | "first_event";

export type StallGuardOptions = {
	/** Deadline from send for the first real event. 0 disables the guard. */
	firstEventDeadlineMs: number;
	/** How long after headers to wait for the first real event. */
	postHeadersGraceMs: number;
	/** Transparent re-sends before giving up. */
	maxResends: number;
	onResend?: (info: StallInfo) => void;
	onGiveUp?: (info: StallInfo) => void;
};

export type StallInfo = {
	attempt: number;
	maxResends: number;
	stage: StallStage;
	elapsedMs: number;
	headersMs?: number;
	status?: number;
	requestId?: string;
};

export const DEFAULT_STALL_GUARD_OPTIONS: Omit<StallGuardOptions, "onResend" | "onGiveUp"> = {
	firstEventDeadlineMs: 25_000,
	postHeadersGraceMs: 3_000,
	maxResends: 2,
};

function envInt(env: NodeJS.ProcessEnv, name: string): number | undefined {
	const raw = env[name]?.trim();
	if (!raw) return undefined;
	const value = Number(raw);
	return Number.isInteger(value) && value >= 0 ? value : undefined;
}

export function stallGuardOptionsFromEnv(env: NodeJS.ProcessEnv = process.env): typeof DEFAULT_STALL_GUARD_OPTIONS {
	return {
		firstEventDeadlineMs:
			envInt(env, "PI_STALL_FIRST_EVENT_DEADLINE_MS") ?? DEFAULT_STALL_GUARD_OPTIONS.firstEventDeadlineMs,
		postHeadersGraceMs: envInt(env, "PI_STALL_POST_HEADERS_GRACE_MS") ?? DEFAULT_STALL_GUARD_OPTIONS.postHeadersGraceMs,
		maxResends: envInt(env, "PI_STALL_MAX_RESENDS") ?? DEFAULT_STALL_GUARD_OPTIONS.maxResends,
	};
}

/** Only guard streaming Messages API calls to Anthropic's first-party API. */
export function isGuardedRequest(input: unknown, init: RequestInit | undefined): boolean {
	if (typeof input !== "string" && !(input instanceof URL)) return false;
	let url: URL;
	try {
		url = new URL(String(input));
	} catch {
		return false;
	}
	if (url.hostname !== "api.anthropic.com" || !url.pathname.endsWith("/v1/messages")) return false;
	if ((init?.method ?? "GET").toUpperCase() !== "POST") return false;
	return typeof init?.body === "string" && /"stream"\s*:\s*true/.test(init.body);
}

/** Returns the first SSE event name other than `ping`, or undefined if none is complete yet. */
export function firstRealEvent(buffered: string): string | undefined {
	for (const block of buffered.replace(/\r\n/g, "\n").split("\n\n").slice(0, -1)) {
		let name: string | undefined;
		let data = "";
		for (const line of block.split("\n")) {
			if (line.startsWith("event:")) name = line.slice(6).trim();
			else if (line.startsWith("data:")) data += line.slice(5).trim();
		}
		if (!name && data) {
			try {
				const type = (JSON.parse(data) as { type?: unknown }).type;
				if (typeof type === "string") name = type;
			} catch {
				// Unparseable data still counts as a real event; let the SDK report it.
				name = "unknown";
			}
		}
		if (name && name !== "ping") return name;
	}
	return undefined;
}

class StallAbort extends Error {
	readonly stage: StallStage;
	constructor(stage: StallStage) {
		super(`stalled waiting for ${stage}`);
		this.stage = stage;
	}
}

function abortError(signal: AbortSignal): unknown {
	return signal.reason ?? new DOMException("This operation was aborted", "AbortError");
}

function withPrefix(prefix: Uint8Array[], reader: ReadableStreamDefaultReader<Uint8Array>): ReadableStream<Uint8Array> {
	let index = 0;
	return new ReadableStream<Uint8Array>({
		async pull(controller) {
			if (index < prefix.length) {
				controller.enqueue(prefix[index++]);
				return;
			}
			const { value, done } = await reader.read();
			if (done) controller.close();
			else controller.enqueue(value);
		},
		cancel(reason) {
			return reader.cancel(reason);
		},
	});
}

type AttemptResult = { kind: "response"; response: Response } | { kind: "stalled"; info: Omit<StallInfo, "attempt" | "maxResends"> };

async function attempt(
	inner: typeof fetch,
	input: string | URL,
	init: RequestInit,
	options: StallGuardOptions,
): Promise<AttemptResult> {
	const callerSignal = init.signal ?? undefined;
	if (callerSignal?.aborted) throw abortError(callerSignal);

	const controller = new AbortController();
	const onCallerAbort = () => controller.abort(callerSignal?.reason);
	callerSignal?.addEventListener("abort", onCallerAbort, { once: true });
	const startedAt = Date.now();
	let stalled: StallAbort | undefined;
	let timer: ReturnType<typeof setTimeout> | undefined;
	const arm = (ms: number, stage: StallStage) => {
		if (timer) clearTimeout(timer);
		timer = setTimeout(() => {
			stalled = new StallAbort(stage);
			controller.abort(stalled);
		}, Math.max(0, ms));
	};
	const disarm = () => {
		if (timer) clearTimeout(timer);
		timer = undefined;
	};
	// Keep forwarding caller aborts after a hand-off; only drop the listener on
	// paths where this attempt's connection is finished.
	const detachCaller = () => callerSignal?.removeEventListener("abort", onCallerAbort);

	arm(options.firstEventDeadlineMs, "headers");
	let response: Response;
	try {
		response = await inner(input, { ...init, signal: controller.signal });
	} catch (error) {
		disarm();
		detachCaller();
		if (stalled) return { kind: "stalled", info: { stage: "headers", elapsedMs: Date.now() - startedAt } };
		throw error;
	}

	const headersMs = Date.now() - startedAt;
	const meta = { headersMs, status: response.status, requestId: response.headers.get("request-id") ?? undefined };
	const isEventStream = response.headers.get("content-type")?.includes("text/event-stream") ?? false;
	if (!response.ok || !response.body || !isEventStream) {
		// Errors and non-streams pass through untouched for pi to handle.
		disarm();
		return { kind: "response", response };
	}

	arm(Math.min(options.postHeadersGraceMs, options.firstEventDeadlineMs - headersMs), "first_event");
	const reader = response.body.getReader();
	const decoder = new TextDecoder();
	const chunks: Uint8Array[] = [];
	let text = "";
	try {
		for (;;) {
			const { value, done } = await reader.read();
			if (done) break;
			chunks.push(value);
			text += decoder.decode(value, { stream: true });
			if (firstRealEvent(text)) break;
		}
	} catch (error) {
		disarm();
		detachCaller();
		if (stalled) {
			void reader.cancel().catch(() => {});
			return { kind: "stalled", info: { stage: "first_event", elapsedMs: Date.now() - startedAt, ...meta } };
		}
		throw error;
	}
	disarm();

	const body = withPrefix(chunks, reader);
	return {
		kind: "response",
		response: new Response(body, { status: response.status, statusText: response.statusText, headers: response.headers }),
	};
}

export function createStallGuardFetch(inner: typeof fetch, options: StallGuardOptions): typeof fetch {
	const guarded = async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
		if (options.firstEventDeadlineMs <= 0 || !isGuardedRequest(input, init)) return inner(input, init);
		const url = input as string | URL;
		const requestInit = init as RequestInit;
		for (let resend = 0; ; resend++) {
			const result = await attempt(inner, url, requestInit, options);
			if (result.kind === "response") return result.response;
			const info: StallInfo = { ...result.info, attempt: resend + 1, maxResends: options.maxResends };
			if (resend >= options.maxResends) {
				options.onGiveUp?.(info);
				throw new Error(
					`Request timed out: Anthropic sent no response events (stalled waiting for ${info.stage}) after ${resend + 1} attempts`,
				);
			}
			options.onResend?.(info);
		}
	};
	return guarded as typeof fetch;
}

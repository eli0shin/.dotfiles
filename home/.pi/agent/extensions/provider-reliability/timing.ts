import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeLine } from "./log.ts";

// Logs one JSONL record per provider request with the stage where time was
// spent: request sent -> response headers -> first stream event -> first
// content -> end. A request that stalls also gets an early "stall" record so
// the evidence survives a killed process.

const STATUS_KEY = "provider-timing";
const STATUS_AFTER_MS = 10_000;
const STALL_LOG_AFTER_MS = 30_000;
const TICK_MS = 1_000;
// A warm request that errors never reaches message_stop; stop routing events to it.
const WARM_MAX_MS = 120_000;

type Stage = "headers" | "first_event" | "content";

type RequestRecord = {
	kind: "request" | "cache_warm" | "stall";
	overlapsTurnRequest?: boolean;
	ts: string;
	sessionId: string;
	cwd: string;
	provider?: string;
	model?: string;
	payloadBytes?: number;
	maxTokens?: number;
	idleMsSincePrevious?: number;
	waitingFor?: Stage;
	headersMs?: number;
	status?: number;
	requestId?: string;
	cfRay?: string;
	firstEventMs?: number;
	firstEventType?: string;
	firstContentMs?: number;
	maxEventGapMs?: number;
	streamEndMs?: number;
	totalMs?: number;
	userAbortMs?: number;
	stopReason?: string;
	errorMessage?: string;
	outputTokens?: number;
	cacheReadTokens?: number;
	cacheWriteTokens?: number;
	outcome?: "completed" | "superseded" | "abandoned" | "agent_end" | "shutdown";
};

type InFlight = {
	startedAt: number;
	record: RequestRecord;
	lastEventAt?: number;
	stallLogged: boolean;
	abortListener?: () => void;
	signal?: AbortSignal;
};

function payloadBytes(payload: unknown): number | undefined {
	try {
		return JSON.stringify(payload)?.length;
	} catch {
		return undefined;
	}
}

function maxTokensOf(payload: unknown): number | undefined {
	if (payload && typeof payload === "object" && "max_tokens" in payload) {
		const value = (payload as { max_tokens: unknown }).max_tokens;
		return typeof value === "number" ? value : undefined;
	}
	return undefined;
}

function waitingFor(record: RequestRecord): Stage | undefined {
	if (record.headersMs === undefined) return "headers";
	if (record.firstEventMs === undefined) return "first_event";
	if (record.firstContentMs === undefined) return "content";
	return undefined;
}

export function registerTiming(pi: ExtensionAPI): void {
	// Pi's cache warmer sends `max_tokens: 1` requests through the same hooks,
	// sometimes while a turn request is still in flight. Track them in their own
	// slot so they neither supersede nor mask a stalled turn request. The hooks
	// carry no request ID, so while a warm request is open its stream events are
	// attributed to it; warm requests are short, so the overlap is brief.
	let turn: InFlight | undefined;
	let warm: InFlight | undefined;
	let lastFinishedAt: number | undefined;
	let ticker: ReturnType<typeof setInterval> | undefined;
	let statusCtx: ExtensionContext | undefined;

	const clearStatus = () => {
		if (ticker) clearInterval(ticker);
		ticker = undefined;
		statusCtx?.ui.setStatus(STATUS_KEY, undefined);
	};

	const finish = (inFlight: InFlight | undefined, outcome: NonNullable<RequestRecord["outcome"]>) => {
		if (!inFlight) return;
		if (inFlight === turn) {
			turn = undefined;
			clearStatus();
		} else if (inFlight === warm) {
			warm = undefined;
		}
		if (inFlight.abortListener) inFlight.signal?.removeEventListener("abort", inFlight.abortListener);
		const { record } = inFlight;
		// Prefer the observed stream end over "when we noticed", which for
		// superseded records can include unrelated tool time.
		const endedAt = record.streamEndMs !== undefined ? inFlight.startedAt + record.streamEndMs : Date.now();
		if (record.kind === "request") lastFinishedAt = endedAt;
		record.outcome = outcome;
		record.totalMs = endedAt - inFlight.startedAt;
		record.waitingFor = waitingFor(record);
		writeLine(record);
	};

	// Stream events belong to the open warm request first, then the turn request.
	const target = (): InFlight | undefined => {
		if (warm && Date.now() - warm.startedAt > WARM_MAX_MS) finish(warm, "abandoned");
		return warm ?? turn;
	};

	const tick = () => {
		const inFlight = turn;
		if (!inFlight) return;
		const now = Date.now();
		const elapsed = now - inFlight.startedAt;
		const stage = waitingFor(inFlight.record);
		const quietMs = now - (inFlight.lastEventAt ?? inFlight.startedAt);

		if (stage && elapsed >= STALL_LOG_AFTER_MS && !inFlight.stallLogged) {
			inFlight.stallLogged = true;
			writeLine({ ...inFlight.record, kind: "stall", ts: new Date(now).toISOString(), waitingFor: stage, totalMs: elapsed });
		}

		if (stage && elapsed >= STATUS_AFTER_MS) {
			statusCtx?.ui.setStatus(STATUS_KEY, `⏳ waiting for ${stage.replace("_", " ")} ${Math.round(elapsed / 1000)}s`);
		} else if (!stage && quietMs >= STATUS_AFTER_MS) {
			statusCtx?.ui.setStatus(STATUS_KEY, `⏳ stream quiet ${Math.round(quietMs / 1000)}s`);
		} else {
			statusCtx?.ui.setStatus(STATUS_KEY, undefined);
		}
	};

	pi.on("before_provider_request", (event, ctx) => {
		const now = Date.now();
		const maxTokens = maxTokensOf(event.payload);
		const isWarm = maxTokens === 1;
		const record: RequestRecord = {
			kind: isWarm ? "cache_warm" : "request",
			ts: new Date(now).toISOString(),
			sessionId: ctx.sessionManager.getSessionId(),
			cwd: ctx.cwd,
			provider: ctx.model?.provider,
			model: ctx.model?.id,
			payloadBytes: payloadBytes(event.payload),
			maxTokens,
		};
		const inFlight: InFlight = { startedAt: now, record, stallLogged: false };

		if (isWarm) {
			finish(warm, "superseded");
			if (turn) record.overlapsTurnRequest = true;
			warm = inFlight;
			return;
		}

		// Pi's cache warmer aborts any in-flight warm request before a turn
		// request is built, so it can never receive this request's events.
		finish(warm, "superseded");
		finish(turn, "superseded");
		record.idleMsSincePrevious = lastFinishedAt === undefined ? undefined : now - lastFinishedAt;
		statusCtx = ctx;
		const signal = ctx.signal;
		if (signal && !signal.aborted) {
			inFlight.signal = signal;
			inFlight.abortListener = () => {
				record.userAbortMs ??= Date.now() - now;
			};
			signal.addEventListener("abort", inFlight.abortListener, { once: true });
		}
		turn = inFlight;
		ticker = setInterval(tick, TICK_MS);
		ticker.unref?.();
	});

	pi.on("after_provider_response", (event) => {
		// Headers go to whichever open request has not received them yet.
		const open = target();
		const inFlight = open === warm && warm?.record.headersMs === undefined ? warm : turn;
		if (!inFlight || inFlight.record.headersMs !== undefined) return;
		const now = Date.now();
		inFlight.record.headersMs = now - inFlight.startedAt;
		inFlight.record.status = event.status;
		inFlight.record.requestId = event.headers["request-id"] ?? event.headers["x-request-id"];
		inFlight.record.cfRay = event.headers["cf-ray"];
		inFlight.lastEventAt = now;
	});

	pi.on("provider_stream_event", (event) => {
		const inFlight = target();
		if (!inFlight) return;
		const now = Date.now();
		const { record } = inFlight;
		if (inFlight.lastEventAt !== undefined) {
			record.maxEventGapMs = Math.max(record.maxEventGapMs ?? 0, now - inFlight.lastEventAt);
		}
		inFlight.lastEventAt = now;
		const type = (event.data as { type?: unknown } | undefined)?.type;
		if (record.firstEventMs === undefined) {
			record.firstEventMs = now - inFlight.startedAt;
			record.firstEventType = typeof type === "string" ? type : undefined;
		}
		if (record.firstContentMs === undefined && type === "content_block_start") {
			record.firstContentMs = now - inFlight.startedAt;
		}
		if (type === "message_stop") {
			record.streamEndMs = now - inFlight.startedAt;
			if (inFlight === warm) finish(warm, "completed");
			else clearStatus();
		}
	});

	pi.on("message_end", (event) => {
		if (!turn || event.message.role !== "assistant") return;
		const message = event.message;
		turn.record.stopReason = message.stopReason;
		turn.record.errorMessage = message.errorMessage;
		turn.record.outputTokens = message.usage?.output;
		turn.record.cacheReadTokens = message.usage?.cacheRead;
		turn.record.cacheWriteTokens = message.usage?.cacheWrite;
		finish(turn, "completed");
	});

	pi.on("agent_end", () => {
		finish(turn, "agent_end");
		finish(warm, "agent_end");
	});
	pi.on("session_shutdown", () => {
		finish(turn, "shutdown");
		finish(warm, "shutdown");
	});
}

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { writeLine } from "./log.ts";
import { createStallGuardFetch, type StallGuardOptions, type StallInfo, stallGuardOptionsFromEnv } from "./stall-guard.ts";
import { registerTiming } from "./timing.ts";

// The fetch wrapper is installed once per process. Each extension load (and
// /reload) replaces this slot, so the wrapper always uses current options and
// never calls into a stale context.
const SLOT = Symbol.for("dotfiles.pi.stallGuard");

type Slot = { options: StallGuardOptions };
type GlobalWithSlot = typeof globalThis & { [SLOT]?: Slot };
type MaybeGuarded = typeof fetch & { [SLOT]?: true };

function installGuard(): void {
	const current = globalThis.fetch as MaybeGuarded;
	if (current[SLOT]) return;
	const live: StallGuardOptions = {
		get firstEventDeadlineMs() {
			return (globalThis as GlobalWithSlot)[SLOT]?.options.firstEventDeadlineMs ?? 0;
		},
		get postHeadersGraceMs() {
			return (globalThis as GlobalWithSlot)[SLOT]?.options.postHeadersGraceMs ?? 0;
		},
		get maxResends() {
			return (globalThis as GlobalWithSlot)[SLOT]?.options.maxResends ?? 0;
		},
		onResend: (info) => (globalThis as GlobalWithSlot)[SLOT]?.options.onResend?.(info),
		onGiveUp: (info) => (globalThis as GlobalWithSlot)[SLOT]?.options.onGiveUp?.(info),
	};
	const guarded = createStallGuardFetch(current, live) as MaybeGuarded;
	guarded[SLOT] = true;
	globalThis.fetch = guarded;
}

export default function providerReliability(pi: ExtensionAPI): void {
	registerTiming(pi);

	let ctx: ExtensionContext | undefined;

	const record = (kind: "stall_resend" | "stall_give_up", info: StallInfo) => {
		writeLine({
			kind,
			ts: new Date().toISOString(),
			sessionId: ctx?.sessionManager.getSessionId(),
			cwd: ctx?.cwd,
			model: ctx?.model?.id,
			...info,
		});
	};

	const describe = (info: StallInfo) =>
		info.stage === "headers"
			? `no response after ${Math.round(info.elapsedMs / 1000)}s`
			: `headers after ${Math.round((info.headersMs ?? 0) / 1000)}s but no events`;

	(globalThis as GlobalWithSlot)[SLOT] = {
		options: {
			...stallGuardOptionsFromEnv(),
			onResend: (info) => {
				record("stall_resend", info);
				try {
					ctx?.ui.notify(
						`Anthropic request stalled (${describe(info)}); resending (${info.attempt}/${info.maxResends})`,
						"warning",
					);
				} catch {
					// UI may be gone; the log still has the record.
				}
			},
			onGiveUp: (info) => record("stall_give_up", info),
		},
	};

	// Pi installs its undici fetch before extensions load, so wrap it now. The
	// Anthropic SDK resolves the global fetch for each request's client.
	installGuard();

	const track = (_event: unknown, eventCtx: ExtensionContext) => {
		ctx = eventCtx;
		installGuard();
	};
	pi.on("session_start", track);
	pi.on("before_provider_request", track);
	pi.on("session_shutdown", () => {
		ctx = undefined;
	});
}

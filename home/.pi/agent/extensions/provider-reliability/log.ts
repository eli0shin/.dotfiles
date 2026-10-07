import { appendFileSync, mkdirSync, renameSync, statSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

const LOG_DIR = join(getAgentDir(), "logs");
export const LOG_PATH = join(LOG_DIR, "provider-requests.jsonl");
const MAX_LOG_BYTES = 20 * 1024 * 1024;

/** Appends one JSON record to the provider request log. Never throws. */
export function writeLine(record: object): void {
	try {
		mkdirSync(LOG_DIR, { recursive: true });
		try {
			if (statSync(LOG_PATH).size > MAX_LOG_BYTES) renameSync(LOG_PATH, `${LOG_PATH}.1`);
		} catch {
			// Log does not exist yet.
		}
		appendFileSync(LOG_PATH, `${JSON.stringify(record)}\n`);
	} catch {
		// Logging must never break a request.
	}
}

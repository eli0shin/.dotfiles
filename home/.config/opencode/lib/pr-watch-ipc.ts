import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export type Registration = {
  version: 1;
  sessionID: string;
  directory: string;
  orchestrationID?: string;
  updatedAt: number;
};

export type CommandRequest = {
  version: 1;
  id: string;
  sessionID: string;
  input: string;
  createdAt: number;
};

export type CommandResponse = {
  version: 1;
  id: string;
  sessionID: string;
  message: string;
  variant: "info" | "warning" | "error";
  createdAt: number;
};

export type StatusSnapshot = {
  version: 1;
  sessionID: string;
  text?: string;
  warning: boolean;
  updatedAt: number;
};

export function stateRoot(): string {
  return join(
    process.env.XDG_STATE_HOME ?? join(homedir(), ".local", "state"),
    "opencode",
    "pr-watch",
  );
}

function encoded(value: string): string {
  return encodeURIComponent(value);
}

export function registrationPath(root: string, sessionID: string): string {
  return join(root, "registrations", `${encoded(sessionID)}.json`);
}

export function sessionStatePath(root: string, sessionID: string): string {
  return join(root, "sessions", `${encoded(sessionID)}.json`);
}

export function statusPath(root: string, sessionID: string): string {
  return join(root, "status", `${encoded(sessionID)}.json`);
}

export function commandRequestPath(root: string, sessionID: string, requestID: string): string {
  return join(root, "commands", encoded(sessionID), `${encoded(requestID)}.json`);
}

export function commandResponsePath(root: string, sessionID: string, requestID: string): string {
  return join(root, "responses", encoded(sessionID), `${encoded(requestID)}.json`);
}

export async function atomicWriteJson(path: string, value: unknown): Promise<void> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const temporaryPath = `${path}.${process.pid}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporaryPath, path);
}

export function commandDirectory(root: string, sessionID: string): string {
  return join(root, "commands", encoded(sessionID));
}

export async function readJson<T>(path: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path, "utf8")) as T;
  } catch (error) {
    if (typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT") {
      return undefined;
    }
    throw error;
  }
}

export function isFreshRegistration(
  registration: Pick<Registration, "updatedAt">,
  now = Date.now(),
  maximumAge = 15_000,
): boolean {
  return Number.isFinite(registration.updatedAt) && now - registration.updatedAt <= maximumAge;
}

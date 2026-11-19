import { readFileSync } from "node:fs";
import { join } from "node:path";
import { getAgentDir } from "@earendil-works/pi-coding-agent";

/**
 * Role models come from roles.json in Pi's agent directory, which dot merge
 * generates from roles.base.json and its profile layers. Each role names a
 * provider/model `default` and the `eligible` IDs a caller may pick by name;
 * the default is always eligible. A model's name is its ID without the
 * provider. spawn-worker reads the "worker" role the same way.
 */
export type Role = "worker" | "review";

interface RoleModels {
  default?: string;
  eligible?: string[];
}

export type Roles = Partial<Record<Role, RoleModels>>;

export function rolesPath(agentDir = getAgentDir()): string {
  return join(agentDir, "roles.json");
}

/** Read roles.json. A missing file configures no roles. */
export function readRoles(path = rolesPath()): Roles {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return {};
    throw error;
  }
  try {
    return JSON.parse(text) as Roles;
  } catch (error) {
    throw new Error(`Invalid ${path}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export function modelName(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? id : id.slice(slash + 1);
}

/** The role's eligible provider/model IDs, default first. */
export function eligibleModels(roles: Roles, role: Role): string[] {
  const models = roles[role] ?? {};
  return [...new Set([...(models.default ? [models.default] : []), ...(models.eligible ?? [])])];
}

/**
 * Resolve a model name to the one eligible provider/model ID it names. Without
 * a name, return the role's default, or undefined when it has none.
 */
export function resolveRoleModel(roles: Roles, role: Role, name?: string): string | undefined {
  const requested = name?.trim();
  if (!requested) return roles[role]?.default || undefined;

  const models = eligibleModels(roles, role);
  const matches = models.filter((id) => modelName(id) === requested);
  if (matches.length === 1) return matches[0];
  if (matches.length > 1) {
    throw new Error(`Model ${requested} matches more than one eligible ${role} model: ${matches.join(", ")}`);
  }
  const names = models.map(modelName).join(", ") || "none";
  throw new Error(`Model ${requested} is not an eligible ${role} model; eligible: ${names}`);
}

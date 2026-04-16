/**
 * Service discovery for VX API endpoint.
 *
 * On startup the MCP server fetches a well-known config URL to learn where the
 * API actually lives. This lets us change the API location (domain migration,
 * failover, regional routing) without pushing a new MCP server version to every
 * user.
 *
 * The discovery URL is public, read-only metadata — no secrets or user data.
 * If the fetch fails (offline, timeout, DNS error), the caller falls back to
 * the compiled-in default.
 */

const DISCOVERY_URL = "https://onememory.co/.well-known/vx-config.json";
const DISCOVERY_TIMEOUT_MS = 3_000;

export interface VxServiceConfig {
  api: string;
}

let cached: string | null = null;

/**
 * Fetch the canonical API base URL from the service discovery endpoint.
 * Returns null if the fetch fails for any reason — callers should fall back
 * to VX_DEFAULT_API_BASE_URL.
 */
export async function discoverApiBaseUrl(): Promise<string | null> {
  if (cached) return cached;

  try {
    const res = await fetch(DISCOVERY_URL, {
      signal: AbortSignal.timeout(DISCOVERY_TIMEOUT_MS),
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return null;

    const config: VxServiceConfig = await res.json();
    if (typeof config.api === "string" && config.api.startsWith("https://")) {
      cached = config.api;
      return cached;
    }

    return null;
  } catch {
    // Network error, timeout, DNS failure — all fine, just use the default.
    return null;
  }
}

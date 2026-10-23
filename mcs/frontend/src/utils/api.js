import { API } from "../constants";

// Only the shared, read-only catalog endpoints are cached. Anything that
// reflects a user's own data (records, sessions) or an admin view
// (dashboard, reports) must always hit the API, or the console would show
// stale numbers.
const CACHEABLE_PATHS = new Set(["/sections", "/appliances", "/rooms"]);
const CACHE_TTL_MS = 60_000; // 1 minute

const _cache = new Map();

function _cacheKey(path, options) {
  if ((options.method || "GET").toUpperCase() !== "GET" || options.body) {
    return null;
  }
  // The query string is part of the identity of a response.
  const [base] = path.split("?");
  if (!CACHEABLE_PATHS.has(base)) {
    return null;
  }
  return path;
}

export async function request(path, options = {}) {
  const key = _cacheKey(path, options);
  if (key) {
    const entry = _cache.get(key);
    if (entry && Date.now() < entry.expires) {
      return entry.data;
    }
  }

  const response = await fetch(`${API}${path}`, {
    ...options,
    credentials: "same-origin",
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(data.detail || "Something went wrong. Please try again.");
  }

  if (key) {
    _cache.set(key, { data, expires: Date.now() + CACHE_TTL_MS });
  }
  return data;
}

/**
 * Manually invalidate a cached GET path (e.g., after a mutation).
 */
export function invalidateCache(path) {
  _cache.delete(path);
}

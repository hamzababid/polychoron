const STORAGE_KEY = 'polychoron.demoSession';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function getSessionId(): string | null {
  const stored = localStorage.getItem(STORAGE_KEY);
  if (!stored) return null;
  try {
    return (JSON.parse(stored) as { sessionId: string }).sessionId;
  } catch {
    return null;
  }
}

/** Attaches the demo session's x-session-id header (see AuthContext) to
 * every screen-facing API call — every AML screen requires a logged-in
 * demo user (specs/suites/bfsi/features/aml-detection/screens/*.md). */
export async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const sessionId = getSessionId();
  const headers = new Headers(init?.headers);
  headers.set('Content-Type', 'application/json');
  if (sessionId) headers.set('x-session-id', sessionId);

  const res = await fetch(`/api/v1${path}`, { ...init, headers });

  if (res.status === 401) {
    localStorage.removeItem(STORAGE_KEY);
    window.location.href = '/login';
    throw new ApiError(401, 'Session expired or invalid');
  }
  if (!res.ok) {
    const body = await res.text();
    throw new ApiError(res.status, body || `Request failed: ${res.status}`);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

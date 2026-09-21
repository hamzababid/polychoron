const STORAGE_KEY = 'polychoron.demoSession';

export class ApiError extends Error {
  status: number;

  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** app-api's Nest error responses are {message, error, statusCode} —
 * message is a string for most errors, or an array of strings for
 * class-validator failures. Screens used to render the raw JSON text
 * of a failed response as the error message (e.g. a 403 body verbatim
 * on screen); this extracts the actual human sentence instead, and
 * falls back to a plain "Request failed: <status>" for anything that
 * isn't the expected shape rather than ever showing raw JSON/HTML. */
async function parseErrorMessage(res: Response): Promise<string> {
  const text = await res.text();
  if (!text) return `Request failed: ${res.status}`;
  try {
    const body = JSON.parse(text) as { message?: string | string[]; error?: string };
    if (Array.isArray(body.message) && body.message.length > 0) return body.message.join(' ');
    if (typeof body.message === 'string' && body.message) return body.message;
    if (typeof body.error === 'string' && body.error) return body.error;
  } catch {
    // Not JSON — fall through to the generic message below rather
    // than surfacing raw HTML/text (e.g. a proxy error page).
  }
  return `Request failed: ${res.status}`;
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
    throw new ApiError(res.status, await parseErrorMessage(res));
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

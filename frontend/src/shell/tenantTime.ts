/** Every time a person reads is shown in the tenant's zone, never the
 * browser's — an officer in Karachi, an examiner abroad and the agent's
 * own narrative all name the same clock time
 * (specs/platform/02-platform-data-models.py::Tenant.timezone).
 * AuthProvider sets the zone from the session before anything renders;
 * until then the browser's zone is used. */

let zone: string | undefined;

export function setTenantTimeZone(timeZone: string | undefined) {
  zone = timeZone;
}

type Instant = string | number | Date;
const asDate = (x: Instant) => (x instanceof Date ? x : new Date(x));

/** Date and time, with the zone named ("9/14/2026, 10:00:00 AM GMT+5"). */
export const formatDateTime = (x: Instant, opts: Intl.DateTimeFormatOptions = {}) =>
  asDate(x).toLocaleString(undefined, { timeZone: zone, timeZoneName: 'short', ...opts });

export const formatDate = (x: Instant, opts: Intl.DateTimeFormatOptions = {}) =>
  asDate(x).toLocaleDateString(undefined, { timeZone: zone, ...opts });

export const formatTime = (x: Instant, opts: Intl.DateTimeFormatOptions = {}) =>
  asDate(x).toLocaleTimeString(undefined, { timeZone: zone, ...opts });

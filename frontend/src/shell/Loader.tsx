/** Platform loading indicators — every feature uses these rather than
 * its own "Loading…" text, so the whole product loads the same way.
 * Styles live in styles/design-system.css (global), because Loader is
 * also shown before the shell itself has mounted. */

export function Spinner({ size = 16 }: { size?: number }) {
  return <span className="spinner" style={{ width: size, height: size }} aria-hidden />;
}

/** A block loader for a page or panel still fetching its data.
 * `page` fills the viewport (app start-up); the default sits inside
 * whatever area is loading. */
export function Loader({ label = 'Loading…', page = false }: { label?: string; page?: boolean }) {
  return (
    <div className={`loader ${page ? 'loader--page' : ''}`} role="status" aria-live="polite">
      <Spinner size={page ? 28 : 20} />
      <span className="loader__label">{label}</span>
    </div>
  );
}

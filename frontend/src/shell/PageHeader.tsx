import { useNavigate } from 'react-router-dom';
import { useBreadcrumbs } from './useBreadcrumbs';

/** Sits on the main page's own (light) background, directly below the
 * dark TopHeader — breadcrumbs, then that screen's own heading (the
 * last breadcrumb's label, so the page title is never a second copy
 * of the same string kept in sync by hand). Rendered once in
 * NavigationShell, so every routed screen gets it automatically. */
export function PageHeader() {
  const navigate = useNavigate();
  const crumbs = useBreadcrumbs();
  const title = crumbs[crumbs.length - 1]?.label ?? '';

  return (
    <div className="pageheader">
      <nav className="breadcrumbs" aria-label="Breadcrumb">
        {crumbs.map((c, i) => {
          const isLast = i === crumbs.length - 1;
          return (
            <span key={i} className="breadcrumbs__item">
              {i > 0 && <span className="breadcrumbs__sep">/</span>}
              {c.to && !isLast ? (
                <a
                  href={c.to}
                  onClick={(e) => {
                    e.preventDefault();
                    navigate(c.to!);
                  }}
                >
                  {c.label}
                </a>
              ) : (
                <span className={isLast ? 'breadcrumbs__current' : undefined}>{c.label}</span>
              )}
            </span>
          );
        })}
      </nav>
      {title && <h2 className="pageheader__title">{title}</h2>}
    </div>
  );
}

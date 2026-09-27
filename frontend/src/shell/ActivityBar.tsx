import { useEffect, useState } from 'react';
import { subscribeToRequestActivity } from '../auth/apiClient';

// Requests quicker than this never show the bar (no flicker on fast
// calls); once shown, it stays long enough to be seen.
const SHOW_AFTER_MS = 150;
const MIN_VISIBLE_MS = 400;

/** A thin progress bar across the top of the platform while any
 * foreground API request is in flight — page data loading, or an
 * action like claim / save / publish. Background polling doesn't
 * count (see apiFetch's `background` option). */
export function ActivityBar() {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    let showTimer: ReturnType<typeof setTimeout> | null = null;
    let hideTimer: ReturnType<typeof setTimeout> | null = null;
    let shownAt = 0;

    const unsubscribe = subscribeToRequestActivity((active) => {
      if (active) {
        if (hideTimer) clearTimeout(hideTimer);
        hideTimer = null;
        if (!showTimer && !shownAt) {
          showTimer = setTimeout(() => {
            showTimer = null;
            shownAt = Date.now();
            setVisible(true);
          }, SHOW_AFTER_MS);
        }
      } else {
        if (showTimer) clearTimeout(showTimer);
        showTimer = null;
        if (shownAt) {
          hideTimer = setTimeout(
            () => {
              shownAt = 0;
              setVisible(false);
            },
            Math.max(0, MIN_VISIBLE_MS - (Date.now() - shownAt)),
          );
        }
      }
    });
    return () => {
      unsubscribe();
      if (showTimer) clearTimeout(showTimer);
      if (hideTimer) clearTimeout(hideTimer);
    };
  }, []);

  return (
    <div className={`activity-bar ${visible ? 'activity-bar--visible' : ''}`} role="progressbar" aria-hidden={!visible} aria-label="Loading">
      <span className="activity-bar__track" />
    </div>
  );
}

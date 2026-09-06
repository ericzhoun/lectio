// Page-side analytics: auto page views, declarative click/form events via
// data-event attributes, and a tiny global `lectioTrack(name, props)` for
// imperative calls (audio playback, overlay opens, ...). Events batch and
// flush via sendBeacon so navigation never loses them.
export {};

type EventProps = Record<string, string | number | boolean | undefined>;

interface QueuedEvent {
  name: string;
  path: string;
  lang: string;
  variants: Record<string, string>;
  props?: EventProps;
  ts: number;
}

declare global {
  interface Window {
    lectioTrack?: (name: string, props?: EventProps) => void;
  }
}

const FLUSH_SIZE = 5;
const queue: QueuedEvent[] = [];

function readVariantCookie(): Record<string, string> {
  try {
    const raw = document.cookie
      .split(';')
      .map((c) => c.trim())
      .find((c) => c.startsWith('ab='));
    if (!raw) return {};
    const variants: Record<string, string> = {};
    for (const pair of decodeURIComponent(raw.slice(3)).split(';')) {
      const eq = pair.indexOf('=');
      if (eq > 0) variants[pair.slice(0, eq)] = pair.slice(eq + 1);
    }
    return variants;
  } catch {
    return {};
  }
}

function flush(): void {
  if (!queue.length) return;
  const batch = queue.splice(0, queue.length);
  const body = JSON.stringify({ events: batch });
  try {
    if (navigator.sendBeacon?.('/api/analytics/collect', new Blob([body], { type: 'application/json' }))) {
      return;
    }
  } catch {
    /* fall through to fetch */
  }
  void fetch('/api/analytics/collect', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
  }).catch(() => {});
}

window.lectioTrack = (name, props) => {
  queue.push({
    name,
    path: location.pathname,
    lang: document.documentElement.lang || 'en',
    variants: readVariantCookie(),
    props,
    ts: Date.now(),
  });
  if (queue.length >= FLUSH_SIZE) flush();
};

const track = window.lectioTrack;
track('page_view');

// Declarative instrumentation: <button data-event="cta_click" data-event-props='{"tier":"pro"}'>
document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  const el = (event.target as Element).closest<HTMLElement>('[data-event]');
  if (!el) return;
  let props: EventProps | undefined;
  try {
    props = el.dataset.eventProps ? (JSON.parse(el.dataset.eventProps) as EventProps) : undefined;
  } catch {
    /* bad JSON: track the click without props */
  }
  track(el.dataset.event!, props);
});

document.addEventListener('submit', (event) => {
  const form = event.target as Element;
  const name = form.getAttribute('data-event-form');
  if (!name) return;
  let props: EventProps | undefined;
  try {
    props = form.getAttribute('data-event-props')
      ? (JSON.parse(form.getAttribute('data-event-props')!) as EventProps)
      : undefined;
  } catch {
    /* bad JSON: track the submit without props */
  }
  track(name, props);
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') flush();
});

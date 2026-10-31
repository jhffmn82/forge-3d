// This page's build and the network helpers the platform shares (consolidation A1): the stamped build time, a
// deadline for any promise, and a fetch that gives up after a time and tries again on a network blip.

/** The build this page was stamped with (index.html meta forge-build, tools/assets/stamp-build.mjs), or 'dev'. */
export const pageBuild = () => (typeof document !== 'undefined' && document.querySelector('meta[name="forge-build"]')?.content) || 'dev';

/** The promise, or a rejection "<label> timed out" after `ms` (calling `cancel` first). 1.7's load deadline. */
export function deadline(promise, ms, label, cancel) {
  if (!Number.isFinite(ms)) return Promise.resolve(promise);
  return new Promise((resolve, reject) => {
    let settled = false;
    const timer = setTimeout(() => { if (settled) return; settled = true; cancel?.(); reject(new Error(label + ' timed out')); }, ms);
    Promise.resolve(promise).then(v => { if (settled) return; settled = true; clearTimeout(timer); resolve(v); }, e => { if (settled) return; settled = true; clearTimeout(timer); reject(e); });
  });
}

/**
 * fetch with a time limit for the whole attempt and, when `tries` > 1, another go after a network error or a 5xx
 * answer (a 404 is a missing file: no retry), `gap` ms times the attempt number apart. Resolves the Response (which may
 * be a 4xx or the last 5xx); rejects "<label> timed out" or the last network error.
 * @param {string} url @param {RequestInit & { timeout?: number, tries?: number, gap?: number, label?: string }} [o]
 */
export function fetchWithTimeout(url, { timeout = Infinity, tries = 1, gap = 500, label = url, ...init } = {}) {
  const ctl = typeof AbortController === 'function' ? new AbortController() : null;
  const attempt = async () => {
    for (let i = 1; ; i++) {
      try {
        const r = await fetch(url, ctl ? { ...init, signal: ctl.signal } : init);
        if (r.ok || r.status < 500 || i >= tries) return r;
      } catch (e) {
        if (i >= tries || ctl?.signal.aborted) throw e;
      }
      await new Promise(res => setTimeout(res, gap * i));
    }
  };
  return deadline(attempt(), timeout, label, () => ctl?.abort());
}

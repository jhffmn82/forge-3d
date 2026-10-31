// The update check as the title and the Version window read it (consolidation C17): deps.version from the page
// (platform/ui-calls.js), or a quiet stand-in where the page gives none (tests, a screen built alone).

export const QUIET_CHECK = { state: () => ({ message: '', latest: null }), check: () => {}, install: () => {}, itch: () => false, watch: () => () => {}, titleStatus: () => '' };
export const versionCheck = deps => deps?.version ?? QUIET_CHECK;

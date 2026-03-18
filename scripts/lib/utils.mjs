// ── Pure helpers shared across the build pipeline ────────────────────────────

// eslint-disable-next-line no-control-regex
const ANSI_RE = /\x1b\[[0-9;]*[a-zA-Z]/g;

/** Remove ANSI escape codes from a string (Playwright embeds them in errors). */
export const stripAnsi = s => (s ?? '').replace(ANSI_RE, '');

/** Format a millisecond duration for display: "1.23s" or "456ms". */
export const fmtDur = ms => ms >= 1000 ? (ms / 1000).toFixed(2) + 's' : ms + 'ms';

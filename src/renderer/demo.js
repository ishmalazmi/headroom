// Sample data so the popover can be opened in a plain browser while designing.
// Inside the app the real bridge exists and this file does nothing.
// Try index.html?view=onboarding or ?platform=win32
(function () {
  if (window.headroom) return;
  window.__demo = true;
  const q = new URLSearchParams(location.search);
  const now = Date.now();
  const H = 36e5;
  const D = 864e5;
  const platform = q.get('platform') || 'darwin';
  // ?view=settings opens settings, ?open=codex expands that row
  window.__demoView = q.get('view') === 'settings' ? 'settings' : 'main';
  window.__demoOpen = q.get('open');

  const agents = [
    {
      id: 'claude', name: 'Claude Code', mark: 'Cl', detected: true, tracked: true, evidence: 'claude command, ~/.claude', lastActive: now,
      sub: 'alex@example.com', signedIn: true,
      usage: {
        plan: 'Max', lock: null, action: null, note: null,
        windows: [
          { id: 'session', label: '5-hour window', lengthMs: 5 * H, usedPct: 78, resetsAt: now + 1.9 * H, exact: true },
          { id: 'week', label: 'weekly limit', lengthMs: 7 * D, usedPct: 41, resetsAt: now + 3.2 * D, exact: true },
        ],
        stats: [{ value: 1840000, label: 'tokens today' }, { value: 11650000, label: 'tokens in 7 days' }],
      },
      headline: { text: '78%', pct: 78, level: 'warn', sub: 'resets in 1h 54m', windowId: 'session' },
    },
    {
      id: 'claude:work', icon: 'claude', name: 'Claude Code', sub: 'team@example.org', signedIn: true, mark: 'Cl',
      detected: true, tracked: true, evidence: '~/.claude-work', lastActive: now - 3 * H,
      usage: {
        plan: 'Team', lock: null, note: q.get('signin') ? "Couldn't read limits: Not signed in for the claude command." : null,
        action: q.get('signin') ? { kind: 'sign-in', label: 'Sign in' } : null,
        windows: [
          { id: 'session', label: '5-hour window', lengthMs: 5 * H, usedPct: 9, resetsAt: now + 4.2 * H, exact: true },
          { id: 'week', label: 'weekly limit', lengthMs: 7 * D, usedPct: 34, resetsAt: now + 2.1 * D, exact: true },
        ],
        stats: [{ value: 96000, label: 'tokens today' }, { value: 2300000, label: 'tokens in 7 days' }],
      },
      headline: { text: '34%', pct: 34, level: 'calm', sub: 'resets in 2d 2h', windowId: 'week' },
    },
    {
      id: 'codex', name: 'Codex', mark: 'Cx', detected: true, tracked: true, evidence: 'codex command, ~/.codex', lastActive: now - H,
      usage: {
        plan: 'Plus', lock: null, action: null, note: 'Limits are as of your last Codex turn.', asOf: now - 40 * 60000,
        windows: [
          { id: 'session', label: '5-hour window', lengthMs: 5 * H, usedPct: 23, resetsAt: now + 3.4 * H, exact: true },
          { id: 'week', label: 'weekly limit', lengthMs: 7 * D, usedPct: 12, resetsAt: now + 5 * D, exact: true },
        ],
        stats: [{ value: 412000, label: 'tokens today' }, { value: 4089000, label: 'tokens in 7 days' }],
      },
      headline: { text: '23%', pct: 23, level: 'calm', sub: 'resets in 3h 24m', windowId: 'session' },
    },
    {
      id: 'gemini', name: 'Gemini CLI', mark: 'Ge', detected: true, tracked: true, evidence: 'gemini command, ~/.gemini', lastActive: now - 5 * H,
      usage: {
        plan: null, lock: null, action: null,
        note: 'Gemini counts requests per day. Your allowance depends on your account, so no percentage is shown.',
        windows: [{ id: 'day', label: 'daily quota', lengthMs: D, usedPct: null, resetsAt: now + 9 * H, exact: true }],
        stats: [{ value: 37, label: 'requests today' }, { value: 286000, label: 'tokens today' }],
      },
      headline: { text: '37', pct: null, level: 'none', sub: 'requests today', windowId: null },
    },
    {
      id: 'antigravity', name: 'Antigravity', mark: 'Ag', detected: true, tracked: true, evidence: 'Antigravity app', lastActive: now - 2 * D,
      usage: {
        plan: null, action: null, windows: [],
        lock: { until: now + 3.2 * H, what: 'gemini-3.1-pro' },
        note: 'Antigravity keeps no usage meter on disk. Headroom shows activity and quota lockouts.',
        stats: [{ value: 6, label: 'conversations today' }, { value: 162, label: 'conversations in 7 days' }],
      },
      headline: { text: '3h 12m', pct: 100, level: 'crit', sub: 'limit reached', windowId: null, locked: true },
    },
    { id: 'kimi', name: 'Kimi', mark: 'Ki', detected: false, tracked: false, evidence: '', usage: null, headline: { text: '–', pct: null, level: 'none', sub: '' } },
    { id: 'deepseek', name: 'DeepSeek', mark: 'Ds', detected: q.get('new') === '1', tracked: false, evidence: 'deepseek command', usage: null, headline: { text: '–', pct: null, level: 'none', sub: '' } },
  ];

  const state = {
    platform,
    barName: platform === 'darwin' ? 'menu bar' : platform === 'win32' ? 'taskbar' : 'tray',
    machine: platform === 'darwin' ? 'Mac' : platform === 'win32' ? 'PC' : 'computer',
    settings: {
      onboarded: q.get('view') !== 'onboarding',
      tracked: ['claude', 'claude:work', 'codex', 'gemini', 'antigravity'],
      pinned: q.get('pin') || 'claude',
      known: ['claude', 'claude:work', 'codex', 'gemini', 'antigravity'],
      display: 'used', alerts: true, launchAtLogin: false, claudeLive: true,
    },
    agents,
    updatedAt: now - 20000,
  };

  window.headroom = {
    getState: async () => state,
    onState: () => {},
    refresh: async () => { state.updatedAt = Date.now(); return state; },
    setSettings: async (patch) => {
      Object.assign(state.settings, patch);
      agents.forEach((a) => { a.tracked = state.settings.tracked.includes(a.id); });
      return state;
    },
    completeOnboarding: async (c) => {
      Object.assign(state.settings, { onboarded: true, tracked: c.tracked, pinned: c.pinned, claudeLive: c.claudeLive });
      agents.forEach((a) => { a.tracked = c.tracked.includes(a.id); });
      return state;
    },
    act: async () => state,
    resize: () => {}, hide: () => {}, quit: () => {},
  };
})();

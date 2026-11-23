const F = require('../../shared/format');
const claude = require('./claude');
const codex = require('./codex');
const gemini = require('./gemini');
const antigravity = require('./antigravity');
const { kimi, deepseek } = require('./generic');

// To support another agent, add a module with { id, name, mark, detect, read }.
const PROVIDERS = [claude, codex, gemini, antigravity, kimi, deepseek];

// The one figure that represents an agent in the bar and in its row.
function headline(usage, settings, now) {
  const none = { text: '–', pct: null, level: 'none', sub: '', windowId: null };
  if (!usage) return none;
  if (usage.lock && usage.lock.until > now) {
    return { text: F.dur(usage.lock.until - now), pct: 100, level: 'crit', sub: 'limit reached', windowId: null, locked: true };
  }
  const measured = usage.windows.filter((w) => w.usedPct != null);
  if (measured.length) {
    const w = measured.reduce((a, b) => (b.usedPct > a.usedPct ? b : a));
    const pct = Math.round(w.usedPct);
    const level = pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : 'calm';
    const left = w.resetsAt && w.resetsAt > now ? F.dur(w.resetsAt - now) : null;
    // Close to the limit, the time until it lifts matters more than the number.
    const text = level === 'crit' && left ? left : (settings.display === 'left' ? 100 - pct : pct) + '%';
    return { text, pct, level, sub: left ? `resets in ${left}` : '', windowId: w.id, showsTime: level === 'crit' && !!left };
  }
  const stat = usage.stats.find((s) => s.value > 0);
  if (stat) return { text: F.num(stat.value), pct: null, level: 'none', sub: stat.label, windowId: null };
  return none;
}

async function readUsage(p, ctx) {
  try {
    return await p.read(ctx);
  } catch (e) {
    return { windows: [], stats: [], plan: null, note: null, action: null, lock: null, empty: `Couldn't read usage: ${e.message}` };
  }
}

// A provider normally yields one agent. One with several logins (Claude Code)
// yields an agent per login, so each can be tracked and pinned on its own.
async function agentsFor(p, settings, now) {
  let det;
  try { det = await p.detect(); } catch { det = { detected: false, evidence: '', lastActive: null }; }
  let logins = [];
  if (p.logins && det.detected) {
    try { logins = await p.logins(now); } catch { logins = []; }
  }
  const variants = logins.length > 1 ? logins : [null];

  return Promise.all(variants.map(async (login) => {
    const id = !login || login.isDefault ? p.id : `${p.id}:${login.name}`;
    const agent = {
      id, icon: p.id, name: p.name, mark: p.mark, ...det,
      sub: login ? login.email || login.name : null,
      tracked: settings.tracked.includes(id), usage: null,
    };
    if (login) {
      agent.evidence = login.path;
      agent.lastActive = await p.lastActive(login);
      agent.signedIn = login.loggedIn;
    }
    if (agent.detected && agent.tracked) agent.usage = await readUsage(p, { settings, now, login: login || undefined });
    agent.headline = headline(agent.usage, settings, now);
    return agent;
  }));
}

// Carry out a button the popover offered, such as "Sign in" for one Claude login.
async function act(agentId, kind, now = Date.now()) {
  const [providerId, loginName] = String(agentId).split(':');
  const p = PROVIDERS.find((x) => x.id === providerId);
  if (!p || kind !== 'sign-in' || !p.signIn) return false;
  const list = await p.logins(now);
  const login = loginName ? list.find((l) => l.name === loginName) : list.find((l) => l.isDefault) || list[0];
  return login ? p.signIn(login) : false;
}

async function collect(settings, now = Date.now()) {
  return (await Promise.all(PROVIDERS.map((p) => agentsFor(p, settings, now)))).flat();
}

module.exports = { collect, headline, act, resetLive: claude.resetLive };

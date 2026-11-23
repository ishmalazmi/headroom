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

async function collect(settings, now = Date.now()) {
  const agents = await Promise.all(PROVIDERS.map(async (p) => {
    let det;
    try { det = await p.detect(); } catch { det = { detected: false, evidence: '', lastActive: null }; }
    const agent = { id: p.id, name: p.name, mark: p.mark, ...det, tracked: settings.tracked.includes(p.id), usage: null };
    if (agent.detected && agent.tracked) {
      try {
        agent.usage = await p.read({ settings, now });
      } catch (e) {
        agent.usage = { windows: [], stats: [], plan: null, note: null, action: null, lock: null, empty: `Couldn't read usage: ${e.message}` };
      }
    }
    // Claude can have several logins; the popover lets the user choose one.
    if (p.logins && agent.detected) {
      try {
        agent.logins = (await p.logins(now)).map(({ id, name, path, email, plan, loggedIn }) => ({ id, name, path, email, plan, loggedIn }));
      } catch { agent.logins = []; }
    }
    agent.headline = headline(agent.usage, settings, now);
    return agent;
  }));
  return agents;
}

module.exports = { collect, headline, resetLive: claude.resetLive };

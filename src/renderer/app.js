/* global F */
(function () {
  const api = window.headroom;
  const $app = document.getElementById('app');

  let S = null;          // state from the main process
  let view = window.__demoView || 'main';     // 'main' | 'settings'
  let expanded = window.__demoOpen || null;   // id of the row opened for detail
  let busy = false;      // a refresh is running
  let draft = null;      // first-run choices: { tracked:Set, pinned, live }

  const ICON = {
    pin: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 2.5l4 4-2 .7-2.2 2.2.2 2.8-1 1-2.7-2.7L2.5 13.5M5.8 10.5 3 7.7l1-1 2.8.2L9 4.7z"/></svg>',
    gear: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="8" cy="8" r="2.1"/><path d="M8 1.8v1.6M8 12.6v1.6M1.8 8h1.6M12.6 8h1.6M3.6 3.6l1.1 1.1M11.3 11.3l1.1 1.1M3.6 12.4l1.1-1.1M11.3 4.7l1.1-1.1"/></svg>',
    refresh: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M13.2 8a5.2 5.2 0 1 1-1.6-3.7M13.3 2.6v2.9h-2.9"/></svg>',
    close: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8"/></svg>',
    back: '<svg viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9.5 3.5 5 8l4.5 4.5"/></svg>',
  };

  // Brand marks live in ./icons; an agent without one falls back to its initials.
  const BRANDED = new Set(['claude', 'codex', 'gemini', 'antigravity', 'kimi', 'deepseek']);
  const mark = (a) => (BRANDED.has(a.id)
    ? `<img class="mark" src="icons/${a.id}.svg" alt="" width="24" height="24">`
    : `<span class="mark" aria-hidden="true">${esc(a.mark)}</span>`);

  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);
  const levelOf = (pct) => (pct >= 90 ? 'crit' : pct >= 75 ? 'warn' : 'calm');
  const shown = (pct) => (S.settings.display === 'left' ? 100 - Math.round(pct) : Math.round(pct));
  const word = () => (S.settings.display === 'left' ? 'left' : 'used');

  function elapsedPct(w, now) {
    if (!w.resetsAt || !w.lengthMs) return null;
    return Math.max(0, Math.min(100, (1 - (w.resetsAt - now) / w.lengthMs) * 100));
  }

  // Fill shows how much is used; the tick shows how far through the window we are.
  function bar(w, now, small) {
    const pct = Math.max(0, Math.min(100, w.usedPct));
    const el = elapsedPct(w, now);
    const label = `${Math.round(pct)}% used` + (el != null ? `, ${Math.round(el)}% of the time elapsed` : '');
    return `<div class="bar${small ? ' small' : ''}" data-level="${levelOf(pct)}" role="img" aria-label="${label}">
      <div class="bar-track"><div class="bar-fill" style="width:${pct}%"${pct === 0 ? ' data-zero' : ''}></div></div>
      ${el != null ? `<div class="bar-tick" style="left:${el}%" title="Time elapsed in this window"></div>` : ''}
    </div>`;
  }

  function resetText(w, now) {
    if (!w.resetsAt) return w.usedPct === 0 ? 'Not started' : '';
    return `Resets in ${F.dur(w.resetsAt - now)}`;
  }

  function windowLine(w, now) {
    if (w.usedPct == null) {
      const when = w.resetsAt ? `resets in ${F.dur(w.resetsAt - now)}` : '';
      return `<li class="window"><span>${esc(cap(w.label))}</span><span class="w-value">${when}${w.exact ? '' : ', estimated'}</span></li>`;
    }
    const reset = w.resetsAt ? `, resets in ${F.dur(w.resetsAt - now)}` : '';
    return `<li class="window">
      <span>${esc(cap(w.label))}</span>
      <span class="w-value"><b>${shown(w.usedPct)}%</b> ${word()}${reset}</span>
      ${bar(w, now, true)}
    </li>`;
  }

  // Everything below the headline figure: other windows, counts, caveats.
  function detail(a, now, skipWindowId, skipStatLabel) {
    const u = a.usage;
    if (!u) return '';
    const windows = u.windows.filter((w) => w.id !== skipWindowId);
    const stats = u.stats.filter((s) => s.label !== skipStatLabel && (s.value > 0 || !u.empty));
    let html = '';
    if (windows.length) html += `<ul class="windows">${windows.map((w) => windowLine(w, now)).join('')}</ul>`;
    if (stats.length) html += `<dl class="stats">${stats.map((s) => `<dt>${F.num(s.value)}</dt><dd>${esc(s.label)}</dd>`).join('')}</dl>`;
    if (u.empty) html += `<p class="note">${esc(u.empty)}</p>`;
    if (u.note) html += `<p class="note">${esc(u.note)}${u.asOf ? ' Last turn ' + F.ago(now - u.asOf) + '.' : ''}</p>`;
    if (u.action) html += `<button class="link" data-act="action" data-kind="${esc(u.action.kind)}">${esc(u.action.label)}</button>`;
    return html;
  }

  function hero(a, now) {
    const u = a.usage;
    const h = a.headline;
    let figure = '';
    let under = '';
    let skipWindow = null;
    let skipStat = null;

    if (u && h.locked) {
      figure = `<div class="figure"><span class="big words">Limit reached</span></div>`;
      under = `<p class="pace">Back in ${esc(h.text)}${u.lock.what ? ` for ${esc(u.lock.what)}` : ''}.</p>`;
    } else if (u && h.windowId) {
      const w = u.windows.find((x) => x.id === h.windowId);
      skipWindow = w.id;
      const p = F.pace(w, now);
      figure = `<div class="figure"><span class="big">${shown(w.usedPct)}<small>%</small></span>
        <span class="figure-label">of ${esc(w.label)} ${word()}</span></div>
        ${bar(w, now)}
        <div class="under-bar"><span>${resetText(w, now)}</span></div>`;
      under = p ? `<p class="pace">${p}</p>` : '';
    } else if (u && h.text !== '–') {
      skipStat = h.sub;
      figure = `<div class="figure"><span class="big">${esc(h.text)}</span><span class="figure-label">${esc(h.sub)}</span></div>`;
    } else {
      figure = `<div class="figure"><span class="big words">Nothing yet</span></div>`;
    }

    return `<section class="hero" data-level="${h.level}">
      <div class="hero-head">
        ${mark(a)}
        <h1>${esc(a.name)}</h1>
        ${u && (u.plan || u.login) ? `<span class="plan" title="${esc(u.login || '')}">${esc([u.plan, u.login].filter(Boolean).join(', '))}</span>` : ''}
        <span class="where" title="This agent is shown in the ${S.barName}">${ICON.pin} In ${S.barName}</span>
      </div>
      ${figure}${under}
      ${detail(a, now, skipWindow, skipStat)}
    </section>`;
  }

  function row(a, now) {
    const h = a.headline;
    const open = expanded === a.id;
    let value;
    if (h.locked) value = `<span class="row-value" data-level="crit">back in <b>${esc(h.text)}</b></span>`;
    else if (h.pct != null) {
      const w = a.usage.windows.find((x) => x.id === h.windowId);
      value = `<span class="row-value" data-level="${h.level}">${bar(w, now, true)}<b>${shown(h.pct)}%</b></span>`;
    } else if (h.text !== '–') value = `<span class="row-value"><b>${esc(h.text)}</b> ${esc(h.sub.replace(/ (today|in 7 days|this session)$/, ''))}</span>`;
    else value = `<span class="row-value">no recent use</span>`;

    return `<li>
      <div class="row">
        <button class="row-main" data-act="expand" data-id="${a.id}" aria-expanded="${open}">
          ${mark(a)}
          <span class="row-name">${esc(a.name)}</span>
          ${value}
        </button>
        <button class="icon-btn" data-act="pin" data-id="${a.id}" title="Show ${esc(a.name)} in the ${S.barName}" aria-label="Show ${esc(a.name)} in the ${S.barName}">${ICON.pin}</button>
      </div>
      ${open ? `<div class="row-detail">${detail(a, now, null, null)}</div>` : ''}
    </li>`;
  }

  function mainView(now) {
    const tracked = S.agents.filter((a) => a.tracked && a.detected);
    if (!tracked.length) {
      return `<div class="empty"><strong>No agents are being tracked</strong>
        <p>Turn one on in settings to see its usage here.</p>
        <button class="btn" data-act="settings">Open settings</button></div>`;
    }
    const pinned = tracked.find((a) => a.id === S.settings.pinned) || tracked[0];
    const others = tracked.filter((a) => a !== pinned);
    const fresh = S.agents.filter((a) => a.detected && !S.settings.known.includes(a.id) && !a.tracked);

    return `${hero(pinned, now)}
      ${others.length ? `<ul class="others">${others.map((a) => row(a, now)).join('')}</ul>` : ''}
      ${fresh.map((a) => `<div class="banner"><p><strong>${esc(a.name)}</strong> is now on this ${S.machine}.</p>
        <button class="btn quiet" data-act="skip-new" data-id="${a.id}">Not now</button>
        <button class="btn" data-act="track-new" data-id="${a.id}">Track it</button></div>`).join('')}
      <footer class="foot">
        <span>Updated ${F.ago(now - S.updatedAt)}</span>
        <button class="icon-btn${busy ? ' spin' : ''}" data-act="refresh" title="Refresh now" aria-label="Refresh now">${ICON.refresh}</button>
        <button class="icon-btn" data-act="settings" title="Settings" aria-label="Settings">${ICON.gear}</button>
      </footer>`;
  }

  function sw(act, checked, label, extra = '') {
    return `<label class="switch"><input type="checkbox" data-act="${act}" ${extra} ${checked ? 'checked' : ''} aria-label="${esc(label)}"><span></span></label>`;
  }

  // Shown only when this machine has more than one Claude login.
  function loginChooser(claude, selected, act) {
    if (!claude || !claude.logins || claude.logins.length < 2) return '';
    const current = selected || (claude.logins.find((l) => l.loggedIn) || claude.logins[0]).id;
    return `<section class="group"><h2>Claude login to track</h2>
      ${claude.logins.map((l) => `<label class="pick login">
        <div class="pick-text"><strong>${esc(l.email || l.name)}</strong>
          <span>${esc(l.loggedIn ? [l.plan, l.path].filter(Boolean).join(', ') : `Not signed in for the claude command, ${l.path}`)}</span></div>
        <div class="pick-cell"><span class="radio"><input type="radio" name="${act}" data-act="${act}" data-id="${esc(l.id)}" ${l.id === current ? 'checked' : ''} aria-label="Track ${esc(l.email || l.name)}"><span></span></span></div>
      </label>`).join('')}
    </section>`;
  }

  function settingsView() {
    const st = S.settings;
    const claude = S.agents.find((a) => a.id === 'claude' && a.detected);
    return `<header class="page-head">
        <button class="icon-btn" data-act="back" title="Back" aria-label="Back">${ICON.back}</button><h1>Settings</h1>
      </header>
      <section class="group"><h2>Agents to track</h2>
        ${S.agents.map((a) => `<div class="pick">
          ${mark(a)}
          <div class="pick-text"><strong>${esc(a.name)}</strong><span>${a.detected ? esc(a.evidence || 'Installed') : `Not found on this ${S.machine}`}</span></div>
          ${sw('track', a.tracked && a.detected, 'Track ' + a.name, `data-id="${a.id}" ${a.detected ? '' : 'disabled'}`)}
        </div>`).join('')}
      </section>
      <section class="group"><h2>In the ${S.barName}</h2>
        <div class="setting"><div class="setting-text">Show percent</div>
          <div class="seg" role="radiogroup" aria-label="Show percent">
            <label><input type="radio" name="display" data-act="display" value="used" ${st.display === 'used' ? 'checked' : ''}><span>Used</span></label>
            <label><input type="radio" name="display" data-act="display" value="left" ${st.display === 'left' ? 'checked' : ''}><span>Left</span></label>
          </div></div>
        <div class="setting"><div class="setting-text">Tell me at 90%<span>One quiet notification per window. Nothing else.</span></div>${sw('alerts', st.alerts, 'Tell me at 90%')}</div>
        <div class="setting"><div class="setting-text">Open at login</div>${sw('login', st.launchAtLogin, 'Open at login')}</div>
      </section>
      ${loginChooser(claude, st.claudeLogin, 'login')}
      ${claude ? `<section class="group"><h2>Claude Code</h2>
        <div class="setting"><div class="setting-text">Read limits from Anthropic
          <span>Claude Code keeps tokens on disk but not your limit percentages. Headroom asks Anthropic for them with the sign-in Claude Code already saved${S.platform === 'darwin' ? '; macOS may ask for Keychain access' : ''}.</span></div>
          ${sw('live', st.claudeLive, 'Read Claude limits from Anthropic')}</div>
      </section>` : ''}
      <div class="actions"><button class="btn quiet" data-act="quit">Quit Headroom</button></div>`;
  }

  function onboardingView() {
    const found = S.agents.filter((a) => a.detected);
    const missing = S.agents.filter((a) => !a.detected);
    if (!draft) {
      // Suggest the first agent used this week; the list is ordered by how much each can report.
      const week = Date.now() - 7 * 864e5;
      const suggested = found.find((a) => a.lastActive && a.lastActive > week) || found[0];
      const cl = found.find((a) => a.id === 'claude');
      const firstLogin = cl && cl.logins && (cl.logins.find((l) => l.loggedIn) || cl.logins[0]);
      draft = { tracked: new Set(found.map((a) => a.id)), pinned: suggested ? suggested.id : null, live: true, login: firstLogin ? firstLogin.id : null };
    }
    // Closing keeps Headroom in the bar; clicking its icon brings this screen back.
    const closeBtn = `<button class="icon-btn close" data-act="close" title="Close. Headroom stays in the ${S.barName}" aria-label="Close">${ICON.close}</button>`;
    if (!found.length) {
      return `${closeBtn}<div class="intro"><h1>No coding agents found yet</h1>
        <p>Headroom looks for Claude Code, Codex, Gemini CLI, Antigravity, Kimi and DeepSeek. Install one, then check again.</p></div>
        <div class="actions"><button class="btn wide" data-act="refresh">Check again</button></div>
        <div class="actions"><button class="btn quiet" data-act="quit">Quit Headroom</button></div>`;
    }
    const claudeOn = draft.tracked.has('claude');
    return `${closeBtn}<div class="intro"><h1>Found ${found.length} ${found.length === 1 ? 'agent' : 'agents'} on this ${S.machine}</h1>
        <p>Choose which to track, and the one whose usage stays in your ${S.barName}.</p></div>
      <div class="cols"><span>Track</span><span>${cap(S.barName)}</span></div>
      <section class="group" style="padding-top:0">
        ${found.map((a) => `<div class="pick">
          ${mark(a)}
          <div class="pick-text"><strong>${esc(a.name)}</strong><span title="${esc(a.evidence)}">${a.lastActive ? 'Last used ' + F.ago(Date.now() - a.lastActive) : 'Installed, not used yet'}</span></div>
          <div class="pick-cell">${sw('ob-track', draft.tracked.has(a.id), 'Track ' + a.name, `data-id="${a.id}"`)}</div>
          <div class="pick-cell"><label class="radio"><input type="radio" name="ob-pin" data-act="ob-pin" data-id="${a.id}" ${draft.pinned === a.id ? 'checked' : ''} ${draft.tracked.has(a.id) ? '' : 'disabled'} aria-label="Show ${esc(a.name)} in the ${S.barName}"><span></span></label></div>
        </div>`).join('')}
      </section>
      ${claudeOn ? loginChooser(found.find((a) => a.id === 'claude'), draft.login, 'ob-login') : ''}
      ${claudeOn ? `<section class="group"><div class="setting"><div class="setting-text">Read Claude limits from Anthropic
        <span>Uses the sign-in Claude Code already saved. Everything else stays on this ${S.machine}.${S.platform === 'darwin' ? ' macOS may ask for Keychain access.' : ''}</span></div>
        ${sw('ob-live', draft.live, 'Read Claude limits from Anthropic')}</div></section>` : ''}
      <div class="actions"><button class="btn wide" data-act="start" ${draft.tracked.size ? '' : 'disabled'}>Start tracking</button></div>
      <div class="actions split"><button class="btn quiet" data-act="close">Set up later</button><button class="btn quiet" data-act="quit">Quit Headroom</button></div>
      ${missing.length ? `<p class="fine">Not found: ${missing.map((a) => esc(a.name)).join(', ')}. Headroom will offer to add them once installed.</p>` : ''}`;
  }

  function render() {
    if (!S) return;
    document.documentElement.classList.toggle('vibrant', S.platform === 'darwin' && !window.__demo);
    const now = Date.now();
    $app.innerHTML = !S.settings.onboarded ? onboardingView() : view === 'settings' ? settingsView() : mainView(now);
    requestAnimationFrame(() => api.resize(Math.ceil($app.getBoundingClientRect().height)));
  }

  const patch = async (p) => { S = await api.setSettings(p); render(); };

  async function refresh() {
    busy = true; render();
    try { S = await api.refresh(); } finally { busy = false; render(); }
  }

  $app.addEventListener('click', async (e) => {
    const t = e.target.closest('button[data-act]');
    if (!t) return;
    const id = t.dataset.id;
    switch (t.dataset.act) {
      case 'expand': expanded = expanded === id ? null : id; render(); break;
      case 'pin': expanded = null; await patch({ pinned: id }); break;
      case 'refresh': await refresh(); break;
      case 'settings': view = 'settings'; render(); break;
      case 'back': view = 'main'; render(); break;
      case 'quit': api.quit(); break;
      case 'close': api.hide(); break;
      case 'action': if (t.dataset.kind === 'claude-live') await patch({ claudeLive: true }); break;
      case 'track-new': await patch({ tracked: [...S.settings.tracked, id], known: [...S.settings.known, id] }); break;
      case 'skip-new': await patch({ known: [...S.settings.known, id] }); break;
      case 'start':
        t.disabled = true;
        S = await api.completeOnboarding({ tracked: [...draft.tracked], pinned: draft.pinned, claudeLive: draft.live && draft.tracked.has('claude'), claudeLogin: draft.login });
        draft = null; view = 'main'; render();
        break;
    }
  });

  $app.addEventListener('change', async (e) => {
    const t = e.target.closest('input[data-act]');
    if (!t) return;
    const id = t.dataset.id;
    switch (t.dataset.act) {
      case 'ob-track':
        if (t.checked) draft.tracked.add(id); else draft.tracked.delete(id);
        if (!draft.tracked.has(draft.pinned)) draft.pinned = [...draft.tracked][0] || null;
        render(); break;
      case 'ob-pin': draft.pinned = id; render(); break;
      case 'ob-live': draft.live = t.checked; break;
      case 'ob-login': draft.login = id; break;
      case 'login': await patch({ claudeLogin: id }); break;
      case 'track': {
        const set = new Set(S.settings.tracked);
        if (t.checked) set.add(id); else set.delete(id);
        await patch({ tracked: [...set], known: [...new Set([...S.settings.known, id])] });
        break;
      }
      case 'display': await patch({ display: t.value }); break;
      case 'alerts': await patch({ alerts: t.checked }); break;
      case 'login': await patch({ launchAtLogin: t.checked }); break;
      case 'live': await patch({ claudeLive: t.checked }); break;
    }
  });

  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !S) return;
    if (view === 'settings') { view = 'main'; render(); } else api.hide();
  });

  api.onState((s) => {
    S = s;
    // Don't redraw under someone who is midway through a form.
    if (S.settings.onboarded && view === 'settings' && document.activeElement && document.activeElement.tagName === 'INPUT') return;
    render();
  });
  api.getState().then((s) => { S = s; render(); });

  // Keep countdowns current while the popover is open.
  setInterval(() => { if (S && S.settings.onboarded && view === 'main' && !document.hidden) render(); }, 30000);
})();

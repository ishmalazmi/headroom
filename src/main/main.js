const { app, BrowserWindow, Tray, Menu, ipcMain, screen, nativeTheme, Notification } = require('electron');
const fs = require('fs');
const os = require('os');
const path = require('path');
const F = require('../shared/format');
const providers = require('./providers');
const { makeIcon } = require('./trayIcon');

if (process.env.HEADROOM_USER_DATA) app.setPath('userData', process.env.HEADROOM_USER_DATA);
if (process.env.HEADROOM_THEME) nativeTheme.themeSource = process.env.HEADROOM_THEME; // 'light' | 'dark', for testing

const MAC = process.platform === 'darwin';
const WIN = process.platform === 'win32';
const LINUX = !MAC && !WIN;
const WIDTH = 400;
const smokeArg = process.argv.find((a) => a.startsWith('--smoke='));
const SMOKE = smokeArg ? smokeArg.slice(8) : null;

const APP_ICON = path.join(__dirname, '..', '..', 'build', 'icon.png');
const HAS_ICON = fs.existsSync(APP_ICON);

const DEFAULTS = {
  onboarded: false,
  tracked: [],
  pinned: null,
  known: [], // agents the user has already been asked about
  display: 'used', // or 'left'
  alerts: true,
  launchAtLogin: false,
  claudeLive: false,
};

let settings = { ...DEFAULTS };
let state = { agents: [], updatedAt: 0 };
let tray = null;
let win = null;
let refreshing = null;
const alerted = new Set();

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json');

function loadSettings() {
  try { settings = { ...DEFAULTS, ...JSON.parse(fs.readFileSync(settingsFile(), 'utf8')) }; } catch {}
}

function saveSettings() {
  try {
    fs.mkdirSync(path.dirname(settingsFile()), { recursive: true });
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2));
  } catch {}
}

function applyLaunchAtLogin() {
  if (!app.isPackaged) return;
  if (LINUX) {
    const file = path.join(os.homedir(), '.config', 'autostart', 'headroom.desktop');
    try {
      if (settings.launchAtLogin) {
        fs.mkdirSync(path.dirname(file), { recursive: true });
        const exec = process.env.APPIMAGE || process.execPath;
        fs.writeFileSync(file, `[Desktop Entry]\nType=Application\nName=Headroom\nExec="${exec}"\nX-GNOME-Autostart-enabled=true\n`);
      } else if (fs.existsSync(file)) fs.unlinkSync(file);
    } catch {}
  } else {
    app.setLoginItemSettings({ openAtLogin: settings.launchAtLogin });
  }
}

function publicState() {
  return {
    platform: process.platform,
    barName: MAC ? 'menu bar' : WIN ? 'taskbar' : 'tray',
    machine: MAC ? 'Mac' : WIN ? 'PC' : 'computer',
    settings,
    agents: state.agents,
    updatedAt: state.updatedAt,
  };
}

function push() {
  if (win && !win.isDestroyed()) win.webContents.send('state', publicState());
}

function pinnedAgent() {
  return state.agents.find((a) => a.id === settings.pinned && a.tracked && a.detected) || null;
}

function updateTray() {
  if (!tray) return;
  const a = pinnedAgent();
  const h = a ? a.headline : null;
  tray.setImage(makeIcon({
    pct: h ? h.pct : null,
    level: h ? h.level : 'none',
    platform: process.platform,
    dark: nativeTheme.shouldUseDarkColors || LINUX,
  }));
  if (MAC) tray.setTitle(h && h.text !== '–' ? ' ' + h.text : '', { fontType: 'monospacedDigit' });
  let tip = 'Headroom';
  if (a && h) {
    if (h.locked) tip = `${a.name}: limit reached, back in ${h.text}`;
    else if (h.pct != null) tip = `${a.name}: ${h.pct}% used${h.sub ? ', ' + h.sub : ''}`;
    else if (h.text !== '–') tip = `${a.name}: ${h.text} ${h.sub}`;
    else tip = `${a.name}: no recent usage`;
  }
  tray.setToolTip(tip);
}

function checkAlerts() {
  if (!settings.alerts || !settings.onboarded || !Notification.isSupported()) return;
  for (const a of state.agents) {
    if (!a.usage) continue;
    for (const w of a.usage.windows) {
      if (w.usedPct == null || w.usedPct < 90) continue;
      const key = `${a.id}:${w.id}:${w.resetsAt}`;
      if (alerted.has(key)) continue;
      alerted.add(key);
      const left = w.resetsAt ? ` It resets in ${F.dur(w.resetsAt - Date.now())}.` : '';
      new Notification({
        title: `${a.name} is at ${Math.round(w.usedPct)}%`,
        body: `You have used most of your ${w.label}.${left}`,
        silent: true,
        icon: HAS_ICON && !MAC ? APP_ICON : undefined, // macOS already shows the app icon
      }).show();
    }
  }
}

async function refresh() {
  if (refreshing) return refreshing;
  refreshing = (async () => {
    try {
      const agents = await providers.collect(settings);
      state = { agents, updatedAt: Date.now() };
      // If the pinned agent went away, fall back to another tracked one.
      if (settings.onboarded && !pinnedAgent()) {
        const next = agents.find((a) => a.tracked && a.detected);
        if (next && settings.pinned !== next.id) { settings.pinned = next.id; saveSettings(); }
      }
      updateTray();
      checkAlerts();
      push();
    } finally {
      refreshing = null;
    }
  })();
  return refreshing;
}

function positionWindow() {
  if (!win) return;
  const [w, h] = win.getSize();
  if (!settings.onboarded) {
    const wa = screen.getPrimaryDisplay().workArea;
    win.setPosition(Math.round(wa.x + (wa.width - w) / 2), Math.round(wa.y + Math.max(40, (wa.height - h) / 3)));
    return;
  }
  const tb = tray ? tray.getBounds() : null;
  const cur = screen.getCursorScreenPoint();
  const anchor = tb && tb.width ? { x: tb.x + tb.width / 2, y: tb.y, h: tb.height } : { x: cur.x, y: cur.y, h: 0 };
  const wa = screen.getDisplayNearestPoint({ x: Math.round(anchor.x), y: Math.round(anchor.y) }).workArea;
  let x = Math.round(anchor.x - w / 2);
  let y = anchor.y < wa.y + wa.height / 2 ? Math.round(anchor.y + anchor.h + 6) : Math.round(anchor.y - h - 6);
  x = Math.max(wa.x + 8, Math.min(x, wa.x + wa.width - w - 8));
  y = Math.max(wa.y + 8, Math.min(y, wa.y + wa.height - h - 8));
  win.setPosition(x, y);
}

function showWindow() {
  if (!win) return;
  // The first-run window behaves like a normal window; the popover floats.
  win.setAlwaysOnTop(settings.onboarded);
  positionWindow();
  win.show();
  win.focus();
  if (Date.now() - state.updatedAt > 15000) refresh();
}

function toggleWindow() {
  if (win && win.isVisible()) win.hide();
  else showWindow();
}

function createWindow() {
  win = new BrowserWindow({
    width: WIDTH,
    height: 420,
    show: false,
    frame: false,
    resizable: false,
    fullscreenable: false,
    minimizable: false,
    maximizable: false,
    skipTaskbar: true,
    icon: HAS_ICON && !MAC ? APP_ICON : undefined,
    alwaysOnTop: true,
    vibrancy: MAC ? 'popover' : undefined,
    visualEffectState: 'active',
    backgroundColor: MAC ? '#00000000' : nativeTheme.shouldUseDarkColors ? '#141B22' : '#F4F6F8',
    webPreferences: {
      // HEADROOM_DEMO=1 skips the bridge so the popover shows its sample data.
      preload: process.env.HEADROOM_DEMO ? undefined : path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      sandbox: true,
    },
  });
  if (MAC) win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  win.loadFile(path.join(__dirname, '..', 'renderer', 'index.html'), { search: !process.env.HEADROOM_DEMO ? '' : process.env.HEADROOM_DEMO.includes('=') ? process.env.HEADROOM_DEMO : 'new=1' });
  if (process.env.HEADROOM_DEMO) win.setSize(WIDTH, 560);
  win.on('blur', () => {
    if (settings.onboarded && !SMOKE && !win.webContents.isDevToolsOpened()) win.hide();
  });
  win.on('closed', () => { win = null; });
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open Headroom', click: showWindow },
    { label: 'Refresh now', click: () => refresh() },
    { type: 'separator' },
    { label: 'Quit Headroom', click: () => app.quit() },
  ]);
}

function createTray() {
  tray = new Tray(makeIcon({ pct: null, level: 'none', platform: process.platform, dark: true }));
  tray.setToolTip('Headroom');
  if (LINUX) {
    // Most Linux trays only open a menu, so the menu is the way in.
    tray.setContextMenu(trayMenu());
  } else {
    tray.on('click', toggleWindow);
    tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
  }
}

function wireIpc() {
  ipcMain.handle('state', () => publicState());
  ipcMain.handle('refresh', async () => { providers.resetLive(); await refresh(); return publicState(); });
  ipcMain.handle('settings', async (_e, patch) => {
    const allowed = ['tracked', 'pinned', 'known', 'display', 'alerts', 'launchAtLogin', 'claudeLive'];
    for (const k of allowed) if (k in patch) settings[k] = patch[k];
    if (settings.pinned && !settings.tracked.includes(settings.pinned)) settings.pinned = settings.tracked[0] || null;
    saveSettings();
    if ('launchAtLogin' in patch) applyLaunchAtLogin();
    if ('claudeLive' in patch) providers.resetLive();
    push();
    updateTray();
    await refresh();
    return publicState();
  });
  ipcMain.handle('onboard', async (_e, { tracked, pinned, claudeLive }) => {
    settings.tracked = tracked;
    settings.pinned = tracked.includes(pinned) ? pinned : tracked[0] || null;
    settings.claudeLive = !!claudeLive;
    settings.known = state.agents.filter((a) => a.detected).map((a) => a.id);
    settings.onboarded = true;
    saveSettings();
    await refresh();
    positionWindow();
    return publicState();
  });
  ipcMain.on('resize', (_e, height) => {
    if (!win) return;
    // Grow to fit the content; only a screen too short for it makes the popover scroll.
    const room = screen.getDisplayMatching(win.getBounds()).workArea.height - 24;
    const h = Math.max(120, Math.min(Math.round(height), room));
    if (win.getSize()[1] !== h) {
      win.setSize(WIDTH, h);
      if (win.isVisible()) positionWindow();
    }
  });
  ipcMain.on('hide', () => { if (win) win.hide(); });
  ipcMain.on('quit', () => app.quit());
}

async function smoke() {
  await refresh();
  win.showInactive();
  await new Promise((r) => setTimeout(r, 1200));
  // Screenshots show the whole view, even where the live popover would scroll.
  const h = await win.webContents.executeJavaScript("document.body.style.maxHeight = 'none'; Math.ceil(document.getElementById('app').getBoundingClientRect().height)");
  if (process.env.HEADROOM_SHOT_CSS) await win.webContents.insertCSS(process.env.HEADROOM_SHOT_CSS);
  // HEADROOM_SHOT_H fixes the height so a row of screenshots lines up.
  win.setSize(WIDTH, Number(process.env.HEADROOM_SHOT_H) || Math.max(120, Math.min(h, 1000)));
  await new Promise((r) => setTimeout(r, 400));
  const img = await win.webContents.capturePage();
  fs.writeFileSync(SMOKE, img.toPNG());
  const a = pinnedAgent();
  console.log('SMOKE', JSON.stringify({
    size: win.getSize(),
    pinned: a && a.id,
    title: a && a.headline.text,
    agents: state.agents.map((x) => [x.id, x.detected, x.tracked, x.headline.text]),
  }));
  app.quit();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', showWindow);
  app.whenReady().then(async () => {
    if (MAC && app.dock) app.dock.hide();
    loadSettings();
    wireIpc();
    createTray();
    createWindow();
    nativeTheme.on('updated', updateTray);
    if (SMOKE) return smoke();
    await refresh();
    // First launch: open by itself so nobody has to hunt for the icon.
    if (!settings.onboarded) showWindow();
    setInterval(refresh, 60 * 1000);
  });
  app.on('window-all-closed', () => {}); // keep running in the tray
}

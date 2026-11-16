// CareerForge desktop: shows an animated splash, starts the bundled Go server
// on a free loopback port (data kept in the user's app-data folder), then opens the UI.
const { app, BrowserWindow, shell, dialog } = require('electron');
const { spawn } = require('node:child_process');
const net = require('node:net');
const path = require('node:path');
const http = require('node:http');

const MIN_SPLASH_MS = 2000;
let server;
let splash;
let win;

function serverBinary() {
  const name = process.platform === 'win32' ? 'careerforge-server.exe' : 'careerforge-server';
  return app.isPackaged ? path.join(process.resourcesPath, 'bin', name) : path.join(__dirname, 'bin', name);
}

function freePort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.unref();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

function waitForServer(port, timeoutMs = 20000) {
  const start = Date.now();
  return new Promise((resolve, reject) => {
    const tryOnce = () => {
      const req = http.get({ host: '127.0.0.1', port, path: '/', timeout: 1000 }, (res) => {
        res.resume();
        resolve();
      });
      req.on('error', retry);
      req.on('timeout', () => { req.destroy(); retry(); });
    };
    const retry = () => {
      if (server && server.exitCode !== null) return reject(new Error('The CareerForge server stopped unexpectedly.'));
      if (Date.now() - start > timeoutMs) return reject(new Error('The CareerForge server did not start in time.'));
      setTimeout(tryOnce, 250);
    };
    tryOnce();
  });
}

function createSplash() {
  splash = new BrowserWindow({
    width: 420,
    height: 320,
    frame: false,
    resizable: false,
    transparent: true,
    alwaysOnTop: true,
    show: false,
    icon: path.join(__dirname, 'emblem.png'),
    webPreferences: { contextIsolation: true },
  });
  splash.loadFile(path.join(__dirname, 'splash.html'));
  splash.once('ready-to-show', () => splash.show());
}

async function boot() {
  const shownAt = Date.now();
  createSplash();

  const port = await freePort();
  const dataDir = app.getPath('userData');
  server = spawn(serverBinary(), [], {
    cwd: dataDir,
    env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CAREERFORGE_ROOT: dataDir },
    windowsHide: true,
    stdio: 'ignore',
  });
  server.on('error', (err) => fail(err));

  try {
    await waitForServer(port);
  } catch (err) {
    return fail(err);
  }

  win = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0e1636',
    title: 'CareerForge',
    icon: path.join(__dirname, 'emblem.png'),
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, preload: path.join(__dirname, 'preload.js') },
  });
  // External links open in the user's browser, not inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${port}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });
  win.loadURL(`http://127.0.0.1:${port}/`);
  win.once('ready-to-show', () => {
    const wait = Math.max(0, MIN_SPLASH_MS - (Date.now() - shownAt));
    setTimeout(() => {
      win.show();
      if (splash && !splash.isDestroyed()) splash.close();
    }, wait);
  });
}

function fail(err) {
  dialog.showErrorBox('CareerForge', String(err && err.message ? err.message : err));
  app.quit();
}

function stopServer() {
  if (server && server.exitCode === null) server.kill();
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (win) {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });
  app.whenReady().then(boot);
  app.on('window-all-closed', () => app.quit());
  app.on('before-quit', stopServer);
  process.on('exit', stopServer);
}

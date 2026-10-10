const { app, BrowserWindow, dialog, shell, Menu, safeStorage } = require('electron');
// Chromium reaches PipeWire/PulseAudio through XDG_RUNTIME_DIR; a launch without it (runuser, cron, some launchers) plays audio into nothing
if (process.platform === 'linux' && process.getuid) { const run = `/run/user/${process.getuid()}`; process.env.XDG_RUNTIME_DIR ||= run; process.env.DBUS_SESSION_BUS_ADDRESS ||= `unix:path=${run}/bus`; }
// start.sh runs `electron main.js`, which names the app "Electron"; pin the folder so dev and the installed app share one data dir
app.setPath('userData', require('path').join(app.getPath('appData'), 'Cram'));
process.env.CRAM_DATA = app.getPath('userData');
const fs = require('fs');
const path = require('path');
const server = require('./server');

app.whenReady().then(() => {
  require('./auth').init(process.env.CRAM_DATA, safeStorage);
  server.openExternal = url => shell.openExternal(url);
  Menu.setApplicationMenu(Menu.buildFromTemplate([{ role: 'editMenu' }, { role: 'viewMenu' }]));
  const ctx = Menu.buildFromTemplate([{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { type: 'separator' }, { role: 'selectAll' }]);
  // Note export: same as aidle's notes:export. PDF is typeset by Chromium off-screen.
  const KINDS = { pdf: { title: 'Export as PDF', ext: 'pdf', filter: { name: 'PDF document', extensions: ['pdf'] } }, md: { title: 'Export as Markdown', ext: 'md', filter: { name: 'Markdown', extensions: ['md'] } } };
  server.exportNote = async ({ body, format, defaultName } = {}) => {
    if (!body) return { ok: false, message: 'Nothing to export.' };
    const kind = KINDS[format] || KINDS.md;
    try {
      const { canceled, filePath } = await dialog.showSaveDialog({ title: kind.title, defaultPath: `${(defaultName || 'note').replace(/[/\\?%*:|"<>]/g, '-')}.${kind.ext}`, filters: [kind.filter] });
      if (canceled || !filePath) return { ok: false, canceled: true };
      if (format !== 'pdf') { fs.writeFileSync(filePath, body, 'utf8'); return { ok: true, path: filePath }; }
      const tmp = path.join(app.getPath('temp'), `cram-export-${Date.now()}.html`);
      fs.writeFileSync(tmp, body, 'utf8');
      const w = new BrowserWindow({ show: false, webPreferences: { javascript: false, sandbox: true } });
      try { await w.loadFile(tmp); fs.writeFileSync(filePath, await w.webContents.printToPDF({ printBackground: true, pageSize: 'A4', margins: { marginType: 'none' } })); }
      finally { w.destroy(); fs.rmSync(tmp, { force: true }); }
      return { ok: true, path: filePath };
    } catch (e) { return { ok: false, message: e.message }; }
  };
  server.showInFolder = p => shell.showItemInFolder(p);
  let win; // the dialog needs a parent window: a parentless GTK chooser can come back empty on this setup
  server.pickPdf = async () => { const r = await dialog.showOpenDialog(win, { properties: ['openFile'], filters: [{ name: 'PDF', extensions: ['pdf'] }] }); console.log('[pick-pdf]', JSON.stringify(r)); return r.canceled ? null : r.filePaths[0]; };
  // A fixed port so `tailscale serve` can point the phone at it; a random one if it is taken (a second copy of Cram)
  const PORT = +process.env.CRAM_PORT || 3999;
  const open = () => {
    server.port = srv.address().port;
    win = new BrowserWindow({
      width: 1200, height: 800, minWidth: 800, minHeight: 500,
      backgroundColor: '#0f1115', autoHideMenuBar: true, title: 'Cram', icon: path.join(__dirname, 'build/icon.png'),
    });
    win.loadURL(`http://127.0.0.1:${server.port}/?key=${server.accessKey()}`);
    win.webContents.on('context-menu', () => ctx.popup());
    // ponytail: match physical key so Ctrl+V works on Arabic/any layout
    const keys = { KeyV: 'paste', KeyC: 'copy', KeyX: 'cut', KeyA: 'selectAll' };
    win.webContents.on('before-input-event', (e, input) => {
      if (input.type === 'keyDown' && (input.control || input.meta) && keys[input.code] && !input.shift) { e.preventDefault(); win.webContents[keys[input.code]](); }
    });
    win.webContents.session.setPermissionRequestHandler((wc, perm, cb) => cb(perm === 'media')); // the mic, for spoken interview answers
    win.webContents.setWindowOpenHandler(({ url }) => { shell.openExternal(url); return { action: 'deny' }; });
  };
  let srv = server.listen(PORT, '127.0.0.1', open).on('error', e => { if (e.code !== 'EADDRINUSE') throw e; srv = server.listen(0, '127.0.0.1', open); });
});
app.on('window-all-closed', () => app.quit());

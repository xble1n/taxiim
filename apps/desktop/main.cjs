// TAXI IM for Windows: a desktop window around the live site, so the desk and
// driver apps, logins and data are exactly the ones on the server. No database
// credentials or API keys are bundled here.
const { app, BrowserWindow, shell, session } = require("electron");

// Override with TAXI_IM_URL for testing against another deployment.
const APP_URL = process.env.TAXI_IM_URL || "https://www.taxiim.online";
const APP_ORIGIN = new URL(APP_URL).origin;

function isAppUrl(url) {
  try {
    const host = new URL(url).hostname;
    return new URL(url).origin === APP_ORIGIN || host === "taxiim.online" || host === "www.taxiim.online";
  } catch {
    return false;
  }
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 360,
    minHeight: 600,
    backgroundColor: "#111113",
    title: "TAXI IM",
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, sandbox: true, nodeIntegration: false },
  });
  // Links to other sites (Google Maps navigation, etc.) open in the default browser.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (isAppUrl(url)) return { action: "allow" };
    void shell.openExternal(url);
    return { action: "deny" };
  });
  win.webContents.on("will-navigate", (event, url) => {
    if (!isAppUrl(url)) {
      event.preventDefault();
      void shell.openExternal(url);
    }
  });
  win.webContents.on("did-fail-load", (_event, code, description, url, isMainFrame) => {
    if (code === -3) return; // aborted navigation
    if (!isMainFrame) return; // an embedded frame failed; the app itself is fine
    const html = `<body style="background:#111113;color:#e7eef8;font:16px system-ui;display:grid;place-items:center;height:100vh;margin:0">
      <div style="max-width:28rem;text-align:center"><h1 style="font-size:20px">TAXI IM cannot reach the server</h1>
      <p style="color:#9aa4b2">${description}. Check the internet connection.</p>
      <button onclick="location.href='${APP_URL}'" style="margin-top:12px;height:44px;padding:0 20px;border:0;border-radius:8px;background:#7ce4f7;cursor:pointer">Try again</button></div></body>`;
    void win.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    console.error("load failed", code, description, url);
  });
  void win.loadURL(APP_URL);
}

app.whenReady().then(() => {
  // Allow location (live map, "locate me") only for the TAXI IM site.
  session.defaultSession.setPermissionRequestHandler((wc, permission, callback) => {
    callback(isAppUrl(wc.getURL()) && ["geolocation", "notifications", "clipboard-sanitized-write"].includes(permission));
  });
  createWindow();
  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit();
});

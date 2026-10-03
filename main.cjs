
const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const { autoUpdater } = require("electron-updater");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const https = require("node:https");

const CLIENT_ID = "1550620411740561568";
const COVER_REGISTRY_URL = "https://raw.githubusercontent.com/blibbbye/Localify/main/covers.json";
const COVER_RAW_BASE = "https://raw.githubusercontent.com/blibbbye/Localify/main/covers/";

let mainWindow = null;
let discordSocket = null;
let discordConnecting = null;
let discordReady = false;
let discordBuffer = Buffer.alloc(0);
let coverRegistry = null;
let coverRegistryPromise = null;
let lastPresenceKey = "";
let lastPresenceAt = 0;

let updaterReady = false;
let updaterTimer = null;

function setupAutoUpdater() {
  if (!app.isPackaged || updaterReady) return;
  updaterReady = true;
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  autoUpdater.on("update-available", () => {});
  autoUpdater.on("update-downloaded", () => {});
  autoUpdater.on("error", () => {});
  const check = () => {
    if (!app.isPackaged) return;
    autoUpdater.checkForUpdates().catch(() => {});
  };
  setTimeout(check, 5000);
  updaterTimer = setInterval(check, 30 * 60 * 1000);
}

function isHttpUrl(value) {
  return value.indexOf("http://") === 0 || value.indexOf("https://") === 0;
}

function makeFrame(opcode, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const frame = Buffer.alloc(body.length + 8);
  frame.writeUInt32LE(opcode, 0);
  frame.writeUInt32LE(body.length, 4);
  body.copy(frame, 8);
  return frame;
}

function disconnectDiscord() {
  try {
    if (discordSocket) discordSocket.destroy();
  } catch (e) {}
  discordSocket = null;
  discordBuffer = Buffer.alloc(0);
  discordReady = false;
}

function attachDiscord(socket, onReady) {
  discordSocket = socket;
  discordBuffer = Buffer.alloc(0);
  discordReady = false;
  if (socket.setNoDelay) socket.setNoDelay(true);

  socket.on("data", function (chunk) {
    try {
      discordBuffer = Buffer.concat([discordBuffer, chunk]);
      while (discordBuffer.length >= 8) {
        const length = discordBuffer.readUInt32LE(4);
        if (discordBuffer.length < 8 + length) break;

        const opcode = discordBuffer.readUInt32LE(0);
        const body = discordBuffer.subarray(8, 8 + length).toString("utf8");
        discordBuffer = discordBuffer.subarray(8 + length);

        if (opcode === 3) {
          try { socket.write(makeFrame(4, JSON.parse(body))); } catch (e) {}
          continue;
        }

        if (opcode === 2) {
          if (typeof onReady === "function") onReady(false);
          continue;
        }

        if (opcode === 1) {
          try {
            const message = JSON.parse(body);
            if (message && message.evt === "READY") {
              discordReady = true;
              if (typeof onReady === "function") onReady(true);
            }
          } catch (e) {}
        }
      }
    } catch (e) {}
  });

  socket.once("error", function () {
    if (discordSocket === socket) {
      if (typeof onReady === "function") onReady(false);
      disconnectDiscord();
    }
  });
  socket.once("close", function () {
    if (discordSocket === socket) {
      if (typeof onReady === "function") onReady(false);
      disconnectDiscord();
    }
  });

  try {
    socket.write(makeFrame(0, { v: 1, client_id: CLIENT_ID }));
  } catch (e) {
    if (typeof onReady === "function") onReady(false);
    disconnectDiscord();
  }
}

function connectPipe(pipe) {
  return new Promise(function (resolve) {
    let done = false;
    let socket = null;

    function finish(ok) {
      if (done) return;
      done = true;
      clearTimeout(timer);
      if (!ok && socket) {
        try { socket.destroy(); } catch (e) {}
      }
      resolve(ok);
    }

    function onConnect() {
      try {
        attachDiscord(socket, finish);
      } catch (e) {
        finish(false);
      }
    }

    function onError() { finish(false); }
    function onClose() { if (!done) finish(false); }

    const timer = setTimeout(function () {
      finish(false);
    }, 3000);

    try {
      socket = net.createConnection({ path: pipe });
      socket.once("connect", onConnect);
      socket.once("error", onError);
      socket.once("close", onClose);
    } catch (e) {
      finish(false);
    }
  });
}

async function connectDiscord() {
  if (discordSocket && !discordSocket.destroyed && discordReady) return true;
  if (discordConnecting) return discordConnecting;

  const slash = String.fromCharCode(92);
  discordConnecting = (async function () {
    for (let i = 0; i < 10; i += 1) {
      const pipeA = slash + slash + "?" + slash + "pipe" + slash + "discord-ipc-" + i;
      const pipeB = slash + slash + "." + slash + "pipe" + slash + "discord-ipc-" + i;
      if (await connectPipe(pipeA) && discordSocket && discordReady) return true;
      if (await connectPipe(pipeB) && discordSocket && discordReady) return true;
    }
    return false;
  })().finally(function () {
    discordConnecting = null;
  });
  return discordConnecting;
}

function download(url) {
  return new Promise(function (resolve, reject) {
    https.get(url, { headers: { "User-Agent": "Localify-Desktop" } }, function (response) {
      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error("HTTP " + response.statusCode));
        return;
      }

      const chunks = [];
      response.on("data", function (chunk) { chunks.push(chunk); });
      response.on("end", function () {
        resolve(Buffer.concat(chunks));
      });
    }).on("error", reject);
  });
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\x27\x60\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

async function getCoverRegistry() {
  if (coverRegistry) return coverRegistry;
  if (coverRegistryPromise) return coverRegistryPromise;

  coverRegistryPromise = (async function () {
    try {
      const localPath = path.join(__dirname, "covers.json");
      if (fs.existsSync(localPath)) {
        const parsed = JSON.parse(fs.readFileSync(localPath, "utf8"));
        coverRegistry = parsed && parsed.covers && typeof parsed.covers === "object" ? parsed.covers : parsed;
        return coverRegistry || {};
      }
    } catch (e) {}

    try {
      const parsed = JSON.parse((await download(COVER_REGISTRY_URL)).toString("utf8"));
      coverRegistry = parsed && parsed.covers && typeof parsed.covers === "object" ? parsed.covers : parsed;
      return coverRegistry || {};
    } catch (e) {}

    coverRegistry = {};
    return coverRegistry;
  })();

  return coverRegistryPromise;
}

async function resolveCover(payload) {
  const supplied = String(payload && payload.coverUrl || "").trim();
  if (isHttpUrl(supplied)) return supplied;

  const album = String(payload && payload.album || "").trim();
  if (!album) return "";

  const registry = await getCoverRegistry();
  const wanted = normalize(album);

  for (const name of Object.keys(registry || {})) {
    if (normalize(name) !== wanted) continue;

    const value = String(registry[name] || "").trim();
    if (!value) return "";
    if (isHttpUrl(value)) return value;

    return COVER_RAW_BASE + encodeURIComponent(value.replace(/^\.\//, ""));
  }

  return "";
}

async function setPresence(payload) {
  if (!payload || !payload.playing) return clearPresence();
  if (!(await connectDiscord())) return false;

  const song = String(payload.song || "Unknown song").slice(0, 128);
  const artist = String(payload.artist || "Unknown Artist").slice(0, 128);
  const cover = await resolveCover(payload);
  const duration = Math.max(0, Number(payload.duration || 0));
  const position = Math.max(0, Number(payload.currentTime || 0));
  const start = Date.now() - Math.round(position * 1000);

  const key = song + "|" + artist + "|" + cover + "|" + Math.floor(position / 5) + "|" + Math.round(duration);
  const now = Date.now();
  if (key === lastPresenceKey && now - lastPresenceAt < 1500) return true;
  lastPresenceKey = key;
  lastPresenceAt = now;

  const activity = {
    type: 2,
    name: song,
    details: "",
    state: artist,
    status_display_type: 1,
    instance: false
  };

  // Discord supports external image URLs for Rich Presence assets.
  if (cover && cover.length <= 300) {
    activity.assets = {
      large_image: cover,
      large_text: "Localify Desktop"
    };
  }

  if (duration > 0) {
    activity.timestamps = {
      start: start,
      end: start + Math.round(duration * 1000)
    };
  }

  try {
    discordSocket.write(makeFrame(1, {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity: activity },
      nonce: String(now)
    }));
    return true;
  } catch (e) {
    disconnectDiscord();
    return false;
  }
}

async function clearPresence() {
  lastPresenceKey = "";
  lastPresenceAt = 0;

  if (!discordSocket || discordSocket.destroyed) return false;

  try {
    discordSocket.write(makeFrame(1, {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity: null },
      nonce: "clear-" + Date.now()
    }));
    return true;
  } catch (e) {
    disconnectDiscord();
    return false;
  }
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 1000,
    minHeight: 680,
    backgroundColor: "#07090c",
    title: "Localify Desktop",
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, "preload.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false
    }
  });

  // Normal right-clicks are disabled throughout the app.
  // Editable inputs still receive a useful native edit menu.
  mainWindow.webContents.on("context-menu", function (event, params) {
    event.preventDefault();
    if (!params.isEditable) return;

    const menu = Menu.buildFromTemplate([
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectall" }
    ]);

    menu.popup({ window: mainWindow });
  });

  mainWindow.webContents.setWindowOpenHandler(function (details) {
    const url = String(details.url || "");
    if (isHttpUrl(url)) shell.openExternal(url).catch(function () {});
    return { action: "deny" };
  });

  mainWindow.once("ready-to-show", function () {
    mainWindow.show();
  });

  mainWindow.loadFile(path.join(__dirname, "index.html"));

  mainWindow.on("closed", function () {
    mainWindow = null;
    clearPresence();
  });
}

app.setAppUserModelId("com.blibbby.localify.desktop");

app.whenReady().then(function () {
  Menu.setApplicationMenu(null);

  ipcMain.handle("discord:setPresence", function (_event, payload) {
    return setPresence(payload);
  });

  ipcMain.handle("discord:clearPresence", function () {
    return clearPresence();
  });

  ipcMain.handle("discord:status", async function () {
    return {
      connected: await connectDiscord(),
      clientId: CLIENT_ID
    };
  });

  setupAutoUpdater();
  createWindow();
  setTimeout(function(){ connectDiscord().catch(function(){}); }, 250);
  setInterval(function(){ if (!discordSocket || discordSocket.destroyed || !discordReady) connectDiscord().catch(function(){}); }, 3000);
});

app.on("before-quit", function () {
  clearPresence();
  disconnectDiscord();
});

app.on("window-all-closed", function () {
  disconnectDiscord();
  if (process.platform !== "darwin") app.quit();
});

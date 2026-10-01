const { app, BrowserWindow, Menu, ipcMain, shell } = require("electron");
const path = require("node:path");
const fs = require("node:fs");
const net = require("node:net");
const https = require("node:https");

const CLIENT_ID = "1550620411740561568";
const SOURCE_RAW = "https://raw.githubusercontent.com/blibbbye/Localify/main/";

let win = null;
let discordSocket = null;
let discordConnectPromise = null;
let discordBuffer = Buffer.alloc(0);
let coversCache = null;
let coversPromise = null;
let lastActivityKey = "";
let lastActivityAt = 0;

function rpcFrame(op, payload) {
  const body = Buffer.from(JSON.stringify(payload), "utf8");
  const frame = Buffer.alloc(8 + body.length);
  frame.writeUInt32LE(op, 0);
  frame.writeUInt32LE(body.length, 4);
  body.copy(frame, 8);
  return frame;
}

function closeDiscord() {
  try { discordSocket?.destroy(); } catch {}
  discordSocket = null;
  discordBuffer = Buffer.alloc(0);
}

function attachDiscord(socket) {
  discordSocket = socket;
  discordBuffer = Buffer.alloc(0);
  socket.setNoDelay?.(true);

  socket.on("data", chunk => {
    try {
      discordBuffer = Buffer.concat([discordBuffer, chunk]);
      while (discordBuffer.length >= 8) {
        const length = discordBuffer.readUInt32LE(4);
        if (discordBuffer.length < 8 + length) break;

        const opcode = discordBuffer.readUInt32LE(0);
        const body = discordBuffer.subarray(8, 8 + length).toString("utf8");
        discordBuffer = discordBuffer.subarray(8 + length);

        if (opcode === 3) {
          try { socket.write(rpcFrame(4, JSON.parse(body))); } catch {}
        }
      }
    } catch {}
  });

  const gone = () => {
    if (discordSocket === socket) closeDiscord();
  };
  socket.once("error", gone);
  socket.once("close", gone);

  try {
    socket.write(rpcFrame(0, { v: 1, client_id: CLIENT_ID }));
  } catch {
    gone();
  }
}

function connectPipe(pipe) {
  return new Promise(resolve => {
    let done = false;
    let socket = null;

    const finish = ok => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        socket?.removeListener("connect", onConnect);
        socket?.removeListener("error", onError);
        socket?.removeListener("close", onClose);
      } catch {}
      if (!ok) {
        try { socket?.destroy(); } catch {}
      }
      resolve(ok);
    };

    const onConnect = () => {
      try {
        attachDiscord(socket);
        finish(true);
      } catch {
        finish(false);
      }
    };
    const onError = () => finish(false);
    const onClose = () => { if (!done) finish(false); };
    const timer = setTimeout(() => finish(false), 800);

    try {
      socket = net.createConnection({ path: pipe });
    } catch {
      finish(false);
      return;
    }

    socket.once("connect", onConnect);
    socket.once("error", onError);
    socket.once("close", onClose);
  });
}

async function connectDiscord() {
  if (discordSocket && !discordSocket.destroyed) return true;
  if (discordConnectPromise) return discordConnectPromise;

  discordConnectPromise = (async () => {
    for (let i = 0; i < 10; i++) {
      const pipes = [
        "\\\\?\\pipe\\discord-ipc-" + i,
        "\\\\.\\pipe\\discord-ipc-" + i
      ];
      for (const pipe of pipes) {
        if (await connectPipe(pipe) && discordSocket) return true;
      }
    }
    return false;
  })().finally(() => {
    discordConnectPromise = null;
  });

  return discordConnectPromise;
}

function httpsGet(url) {
  return new Promise((resolve, reject) => {
    https.get(url, { headers: { "User-Agent": "Localify-Desktop" } }, res => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error("HTTP " + res.statusCode));
        return;
      }
      const chunks = [];
      res.on("data", chunk => chunks.push(chunk));
      res.on("end", () => resolve(Buffer.concat(chunks)));
    }).on("error", reject);
  });
}

async function loadCovers() {
  if (coversCache) return coversCache;
  if (coversPromise) return coversPromise;

  coversPromise = (async () => {
    try {
      const localPath = path.join(__dirname, "covers.json");
      if (fs.existsSync(localPath)) {
        const raw = JSON.parse(fs.readFileSync(localPath, "utf8"));
        coversCache = raw?.covers && typeof raw.covers === "object" ? raw.covers : raw;
        return coversCache || {};
      }
    } catch {}

    try {
      const raw = JSON.parse((await httpsGet(SOURCE_RAW + "covers.json")).toString("utf8"));
      coversCache = raw?.covers && typeof raw.covers === "object" ? raw.covers : raw;
      return coversCache || {};
    } catch {}

    coversCache = {};
    return coversCache;
  })();

  return coversPromise;
}

function normalize(value) {
  return String(value || "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[’'\\x60]/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function coverUrlFromFile(file) {
  const name = String(file || "").replace(/^\\.\\//, "");
  if (!name) return "";
  if (/^https?:\\/\\//i.test(name)) return name;
  return SOURCE_RAW + "covers/" + encodeURIComponent(name);
}

async function resolveCover(payload) {
  const supplied = String(payload?.coverUrl || "").trim();
  if (/^https?:\\/\\//i.test(supplied)) return supplied;

  const album = String(payload?.album || "").trim();
  if (!album) return "";

  const covers = await loadCovers();
  const key = normalize(album);

  for (const [name, value] of Object.entries(covers || {})) {
    if (normalize(name) === key && value) return coverUrlFromFile(value);
  }
  return "";
}

async function setPresence(payload) {
  if (!payload?.playing) return clearPresence();
  if (!(await connectDiscord())) return false;

  const cover = await resolveCover(payload);
  const duration = Number(payload.duration || 0);
  const position = Math.max(0, Number(payload.currentTime || 0));

  const activity = {
    type: 2,
    name: String(payload.song || "Unknown song").slice(0, 128),
    details: "",
    state: String(payload.artist || "Unknown Artist").slice(0, 128),
    status_display_type: 1,
    instance: false
  };

  if (cover && cover.length <= 800) {
    activity.assets = {
      large_image: cover,
      large_text: "Localify Desktop"
    };
  }

  const start = Date.now() - Math.round(position * 1000);
  if (duration > 0) {
    activity.timestamps = {
      start,
      end: start + Math.round(duration * 1000)
    };
  }

  const activityKey = [
    activity.name,
    activity.state,
    cover,
    Math.floor(position / 5),
    Math.round(duration)
  ].join("|");

  const now = Date.now();
  if (activityKey === lastActivityKey && now - lastActivityAt < 1500) return true;
  lastActivityKey = activityKey;
  lastActivityAt = now;

  try {
    discordSocket.write(rpcFrame(1, {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity },
      nonce: String(now)
    }));
    return true;
  } catch {
    closeDiscord();
    return false;
  }
}

async function clearPresence() {
  lastActivityKey = "";
  lastActivityAt = 0;
  if (!(await connectDiscord())) return false;

  try {
    discordSocket.write(rpcFrame(1, {
      cmd: "SET_ACTIVITY",
      args: { pid: process.pid, activity: null },
      nonce: "clear-" + Date.now()
    }));
    return true;
  } catch {
    closeDiscord();
    return false;
  }
}

function createWindow() {
  win = new BrowserWindow({
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

  // No generic right-click menu on the player.
  // Editable text fields still get native Cut/Copy/Paste/Select All.
  win.webContents.on("context-menu", (event, params) => {
    event.preventDefault();
    if (!params.isEditable) return;

    const editMenu = Menu.buildFromTemplate([
      { role: "undo" },
      { role: "redo" },
      { type: "separator" },
      { role: "cut" },
      { role: "copy" },
      { role: "paste" },
      { role: "selectall" }
    ]);
    editMenu.popup({ window: win });
  });

  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\\/\\//i.test(url)) shell.openExternal(url).catch(() => {});
    return { action: "deny" };
  });

  win.once("ready-to-show", () => win.show());
  win.loadFile(path.join(__dirname, "index.html"));

  win.on("closed", () => {
    win = null;
    void clearPresence();
  });
}

app.setAppUserModelId("com.blibbby.localify.desktop");

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  ipcMain.handle("discord:setPresence", (_event, payload) => setPresence(payload));
  ipcMain.handle("discord:clearPresence", () => clearPresence());
  ipcMain.handle("discord:status", async () => ({
    connected: await connectDiscord(),
    clientId: CLIENT_ID
  }));

  createWindow();
});

app.on("before-quit", () => {
  void clearPresence();
  closeDiscord();
});

app.on("window-all-closed", () => {
  closeDiscord();
  if (process.platform !== "darwin") app.quit();
});

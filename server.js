// server.js — Byzas Agora (Planets + Stylized Avatars)
const express = require("express");
const http = require("http");
const path = require("path");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: { origin: "*", methods: ["GET","POST"] }, // prototip: açık
});

const PUBLIC_DIR = path.join(__dirname, "public");
app.use(express.static(PUBLIC_DIR));
app.get("/", (_req, res) => res.sendFile(path.join(PUBLIC_DIR, "index.html")));

const ROOM = "agora";
const TICK_HZ = 10;

// --- Gezegenler (isim, renk, sahne yarıçapı, tetik yarıçapı) ---
const PLANETS = [
  { name: "Astra",  color: 0xffcf5a, x:  10, z:  -5, radius: 2.2, r: 3.0 },
  { name: "Nyx",    color: 0x8a6cff, x: -12, z:  -8, radius: 2.8, r: 3.5 },
  { name: "Verda",  color: 0x39d98a, x:   4, z:  12, radius: 1.8, r: 2.6 },
  { name: "Cinder", color: 0xff6b6b, x:  -9, z:   9, radius: 2.4, r: 3.2 }
];

// Hotspot’ları gezegenlerden üret + bir “Totem” bırak
const hotspots = [
  { name: "Totem", x: 0, z: 0, r: 3 },
  ...PLANETS.map(p => ({ name: `Planet:${p.name}`, x: p.x, z: p.z, r: p.r }))
];

function randSpawn() {
  return { x: (Math.random()-0.5)*8, y:0, z:(Math.random()-0.5)*8 };
}
function todayKey(){
  const d=new Date(); return `${d.getUTCFullYear()}-${d.getUTCMonth()+1}-${d.getUTCDate()}`;
}

const players = new Map(); // socketId -> player

io.on("connection", (socket) => {
  const spawn = randSpawn();
  const you = {
    id: socket.id, ...spawn, ry:0,
    name: `Yogi-${socket.id.slice(0,4)}`,
    rank: "Observer",
    points: 0,
    emote: null, emoteUntil: 0,
    visited: {}, greetCount: 0, greetDone: false,
    lastChatTs: 0, dailyKey: null
  };
  players.set(socket.id, you);
  socket.join(ROOM);

  // Günlük +10
  const key = todayKey();
  if (you.dailyKey !== key) { you.dailyKey = key; you.points += 10; socket.emit("points:update", { total: you.points, delta:+10, reason:"Daily check-in" }); }

  // Bootstrap
  socket.emit("bootstrap", {
    you,
    players: Array.from(players.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id,p]) => ({ id, x:p.x, y:p.y, z:p.z, ry:p.ry, name:p.name, rank:p.rank, emote:p.emote })),
    hotspots,
    planets: PLANETS // istemci gezegenleri sahneye çizecek
  });

  socket.to(ROOM).emit("player-joined", { id: you.id, x:you.x, y:you.y, z:you.z, ry:you.ry, name:you.name, rank:you.rank });

  socket.on("state", (data) => {
    const p = players.get(socket.id); if (!p) return;
    if (typeof data.x === "number") p.x = data.x;
    if (typeof data.y === "number") p.y = data.y;
    if (typeof data.z === "number") p.z = data.z;
    if (typeof data.ry === "number") p.ry = data.ry;
  });

  socket.on("profile:update", ({ name, rank }) => {
    const p = players.get(socket.id); if (!p) return;
    if (typeof name === "string") {
      const clean = name.trim().slice(0,20) || p.name; p.name = clean;
      io.to(ROOM).emit("player:name", { id: p.id, name: p.name });
    }
    if (typeof rank === "string") { p.rank = rank; io.to(ROOM).emit("player:rank", { id:p.id, rank:p.rank }); }
  });

  socket.on("chat:send", ({ text }) => {
    const p = players.get(socket.id); if (!p) return;
    const now = Date.now(); if (now - (p.lastChatTs||0) < 1200) return;
    p.lastChatTs = now;
    const msg = (text||"").toString().slice(0,240).trim(); if (!msg) return;

    // slash emote
    const lower = msg.toLowerCase();
    const emoteCmd = ["/wave","/dance","/sit","/clap","/point","/cheer"].find(c => lower.startsWith(c));
    if (emoteCmd) { playEmote(p, emoteCmd.slice(1)); return; }

    io.to(ROOM).emit("chat:msg", { from:{ id:p.id, name:p.name, rank:p.rank }, text: msg, ts: now });

    if (!p._saidHello && /selam|hello|hi|merhaba/i.test(msg)) {
      p._saidHello = todayKey(); p.points+=1;
      socket.emit("points:update", { total:p.points, delta:+1, reason:"Selamlaştığın için" });
    }
  });

  socket.on("emote:play", (type) => {
    const p = players.get(socket.id); if (!p) return;
    const ok = new Set(["wave","dance","sit","clap","point","cheer"]);
    if (!ok.has(type)) return; playEmote(p, type);
  });

  function playEmote(p, type){
    p.emote = type; p.emoteUntil = Date.now()+1200;
    io.to(ROOM).emit("emote", { id:p.id, type, until:p.emoteUntil });
    if (type === "wave") {
      const near = Array.from(players.values()).some(o => o.id!==p.id && ((o.x-p.x)**2+(o.z-p.z)**2)<=36);
      if (near && !p.greetDone) {
        p.greetCount += 1;
        io.to(p.id).emit("quest:update", { code:"greet3", progress:p.greetCount, goal:3 });
        if (p.greetCount >= 3) {
          p.greetDone = true; p.points += 10;
          io.to(p.id).emit("points:update", { total:p.points, delta:+10, reason:"3 kişiyle selamlaştın" });
        }
      }
    }
  }

  socket.on("hotspot:entered", ({ name }) => {
    const p = players.get(socket.id); if (!p) return;
    const hs = hotspots.find(h => h.name === name); if (!hs) return;
    const d2 = (p.x-hs.x)**2 + (p.z-hs.z)**2;
    if (d2 > (hs.r+0.8)**2) return; // doğrulama
    if (p.visited[name]) return;
    p.visited[name] = true; p.points += 5;
    io.to(p.id).emit("points:update", { total:p.points, delta:+5, reason:`${name} bölgesini keşfettin` });
    io.to(p.id).emit("quest:update", { code:`visit:${name}`, progress:1, goal:1 });
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    socket.to(ROOM).emit("player-left", socket.id);
  });
});

setInterval(() => {
  const snap = Array.from(players.entries()).map(([id,p])=>({
    id, x:p.x, y:p.y, z:p.z, ry:p.ry, name:p.name, rank:p.rank,
    emote: (p.emoteUntil > Date.now() ? p.emote : null)
  }));
  io.to(ROOM).emit("snapshot", { players: snap });
}, 1000 / TICK_HZ);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Byzas Agora listening on :${PORT}`));

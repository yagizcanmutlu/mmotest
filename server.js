// server.js
const express = require("express");
const http = require("http");
const { Server } = require("socket.io");

const app = express();
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

app.use(express.static("public"));

const TICK_RATE = 10; // sunucunun yayın frekansı (Hz)
const players = new Map(); // socketId -> {x,y,z,ry,hp,name}
let npc = { x: 6, y: 0, z: -6, ry: 0 }; // basit bir zombi

io.on("connection", (socket) => {
  // yeni oyuncuyu kaydet
  const spawn = {
    x: (Math.random() - 0.5) * 10,
    y: 0,
    z: (Math.random() - 0.5) * 10,
    ry: 0,
    hp: 100,
    name: `Player-${socket.id.slice(0, 4)}`
  };
  players.set(socket.id, spawn);

  // yeni gelen oyuncuya mevcut herkesi yolla
  socket.emit("bootstrap", {
    you: { id: socket.id, ...spawn },
    players: Array.from(players.entries())
      .filter(([id]) => id !== socket.id)
      .map(([id, p]) => ({ id, ...p })),
    npc
  });

  // herkese "yeni biri geldi" de
  socket.broadcast.emit("player-joined", { id: socket.id, ...spawn });

  // istemciden gelen durum (client-authoritative, prototip için)
  socket.on("state", (data) => {
    const p = players.get(socket.id);
    if (!p) return;
    // basit doğrulama
    if (typeof data.x === "number") p.x = data.x;
    if (typeof data.y === "number") p.y = data.y;
    if (typeof data.z === "number") p.z = data.z;
    if (typeof data.ry === "number") p.ry = data.ry;
    if (typeof data.hp === "number") p.hp = Math.max(0, Math.min(100, data.hp));
  });

  socket.on("disconnect", () => {
    players.delete(socket.id);
    io.emit("player-left", socket.id);
  });
});

// Çok basit NPC “yaklaşma” davranışı (her 100ms)
setInterval(() => {
  // en yakın oyuncuya yürü
  const arr = Array.from(players.values());
  if (arr.length) {
    let closest = null;
    let bestD2 = Infinity;
    for (const p of arr) {
      const dx = p.x - npc.x;
      const dz = p.z - npc.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) { bestD2 = d2; closest = p; }
    }
    if (closest) {
      const dx = closest.x - npc.x;
      const dz = closest.z - npc.z;
      const len = Math.hypot(dx, dz) || 1;
      const speed = 0.015; // yavaş yürüyüş
      npc.x += (dx / len) * speed * 16; // ~16ms varsayımı ile
      npc.z += (dz / len) * speed * 16;
      npc.ry = Math.atan2(dx, dz);
    }
  }
}, 100);

// Düzenli durum yayını
setInterval(() => {
  const snapshot = {
    players: Array.from(players.entries()).map(([id, p]) => ({ id, ...p })),
    npc
  };
  io.emit("snapshot", snapshot);
}, 1000 / TICK_RATE);

const PORT = process.env.PORT || 3000;
server.listen(PORT, () => console.log(`Server listening on :${PORT}`));

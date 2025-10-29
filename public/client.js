/* global THREE, io */
(() => {
  // --- UI EL ---
  const root = document.getElementById("root");
  const cta = document.getElementById("cta");
  const playBtn = document.getElementById("playBtn");
  const nameInput = document.getElementById("nameInput");
  const pointsEl = document.getElementById("points");
  const chatLog = document.getElementById("chatLog");
  const chatText = document.getElementById("chatText");
  const chatSend = document.getElementById("chatSend");
  const toast = document.getElementById("toast");

  // --- SOCKET ---
  const socket = io(); // aynı origin

  // --- THREE SCENE ---
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x090a14, 20, 120);

  const camera = new THREE.PerspectiveCamera(75, root.clientWidth / root.clientHeight, 0.1, 600);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0x87a8ff, 0x070712, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0x8fd0ff, 0.6);
  dir.position.set(6,10,4);
  scene.add(dir);

  // Zemini ve basit neon diskleri
  const gGround = new THREE.PlaneGeometry(600, 600);
  const mGround = new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 1.0 });
  const ground = new THREE.Mesh(gGround, mGround);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Gökyüzü noktaları
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute("position",
      new THREE.Float32BufferAttribute(
        new Array(3000).fill(0).flatMap(()=>[(Math.random()-0.5)*350, 30+Math.random()*90, (Math.random()-0.5)*350]),3)),
    new THREE.PointsMaterial({ size: 0.6, color: 0x8cbcff })
  );
  scene.add(stars);

  // --- HELPERS ---
  function makeCapsule(color = 0x66ffbb) {
    const g = new THREE.CapsuleGeometry(0.35, 1.0, 6, 12);
    const m = new THREE.MeshStandardMaterial({ color, roughness:.85, metalness:.12 });
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    const grp = new THREE.Group();
    mesh.position.y = 0.65;
    grp.add(mesh);
    return { grp, mesh };
  }

  function makeNameSprite(label) {
    const padX = 10, padY = 4;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 24px Arial";
    const w = Math.max(64, ctx.measureText(label).width + padX*2);
    const h = 34 + padY*2;
    canvas.width = w; canvas.height = h;
    ctx.font = "bold 24px Arial";
    ctx.fillStyle = "rgba(0,0,0,0.5)";
    ctx.strokeStyle = "rgba(20,100,255,0.9)";
    ctx.lineWidth = 2;
    ctx.fillRect(0,0,w,h);
    ctx.strokeRect(0,0,w,h);
    ctx.fillStyle = "#bfe4ff";
    ctx.fillText(label, padX, 26+padY/2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthWrite:false });
    const sp = new THREE.Sprite(mat);
    sp.scale.set(w/100, h/100, 1);
    sp.position.set(0, 1.6, 0);
    return sp;
  }

  function showToast(text) {
    toast.textContent = text;
    toast.style.display = "block";
    setTimeout(()=>toast.style.display = "none", 1600);
  }

  // --- LOCAL PLAYER ---
  const local = {
    id: null,
    name: null,
    yaw: 0,
    vel: new THREE.Vector3(),
    group: null,
    mesh: null,
    points: 0,
    visited: {},
  };
  { const {grp,mesh} = makeCapsule(0x66ffbb); local.group = grp; local.mesh = mesh; scene.add(grp); }

  // --- REMOTES ---
  const remotes = new Map(); // id -> {group,mesh,name,tag}
  function ensureRemote(p) {
    let R = remotes.get(p.id);
    if (!R) {
      const {grp,mesh} = makeCapsule(0x88aaff);
      grp.position.set(p.x, 0, p.z);
      const tag = makeNameSprite(p.name || `Yogi-${p.id.slice(0,4)}`);
      grp.add(tag);
      scene.add(grp);
      R = { group: grp, mesh, name: p.name, tag };
      remotes.set(p.id, R);
    }
    return R;
  }

  function updateNameTag(R, name) {
    R.group.remove(R.tag);
    R.tag.material.map.dispose();
    const tag = makeNameSprite(name);
    R.group.add(tag);
    R.tag = tag;
    R.name = name;
  }

  // --- HOTSPOTS (sahnede göstermek için) ---
  const hotspotMeshByName = new Map();
  function addHotspot(h) {
    const geo = new THREE.CylinderGeometry(h.r, h.r, 0.2, 48);
    const mat = new THREE.MeshStandardMaterial({ color: 0x233a88, emissive: 0x2244ff, emissiveIntensity: 0.7, transparent:true, opacity:0.45 });
    const m = new THREE.Mesh(geo, mat);
    m.position.set(h.x, 0.1, h.z);
    scene.add(m);
    hotspotMeshByName.set(h.name, m);
  }

  // --- INPUT ---
  const keys = new Set();
  let chatFocus = false;
  window.addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      // chat odak
      chatFocus = !chatFocus;
      if (chatFocus) chatText.focus(); else chatText.blur();
      return;
    }
    if (chatFocus) return;
    keys.add(e.code);

    // Emote kısayolları
    const map = {
      Digit1: "wave",
      Digit2: "dance",
      Digit3: "sit",
      Digit4: "clap",
      Digit5: "point",
      Digit6: "cheer",
    };
    if (map[e.code]) {
      socket.emit("emote:play", map[e.code]);
    }
  });
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  // Chat gönder
  function sendChat() {
    const t = chatText.value.trim();
    if (!t) return;
    socket.emit("chat:send", { text: t });
    chatText.value = "";
  }
  chatSend.addEventListener("click", sendChat);
  chatText.addEventListener("keydown", (e)=>{ if (e.key === "Enter") sendChat(); });

  // Pointer lock (oyuna giriş)
  playBtn.addEventListener("click", () => {
    cta.style.display = "none";
    const desired = (nameInput.value || "").trim().slice(0,20);
    if (desired) socket.emit("profile:update", { name: desired });
    renderer.domElement.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement !== renderer.domElement) {
      cta.style.display = "flex";
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === renderer.domElement && !chatFocus) {
      local.yaw -= e.movementX * 0.0025;
    }
  });

  // --- SOCKET EVENTS ---
  socket.on("bootstrap", ({ you, players, hotspots }) => {
    local.id = you.id;
    local.name = you.name;
    local.points = you.points || 0;
    pointsEl.textContent = `Points: ${local.points}`;
    local.group.position.set(you.x, 0, you.z);
    local.yaw = you.ry || 0;

    (hotspots || []).forEach(addHotspot);
    (players || []).forEach(p => {
      const R = ensureRemote(p);
      updateNameTag(R, p.name || R.name);
    });
  });

  socket.on("player-joined", (p) => {
    if (p.id === local.id) return;
    const R = ensureRemote(p);
    updateNameTag(R, p.name || R.name);
  });
  socket.on("player-left", (id) => {
    const R = remotes.get(id);
    if (R) { scene.remove(R.group); remotes.delete(id); }
  });

  socket.on("player:name", ({id, name}) => {
    const R = remotes.get(id);
    if (R) updateNameTag(R, name);
  });
  socket.on("player:rank", ({id, rank}) => {
    // MVP: rank görseli eklemiyoruz; ileride nameplate'e ikon
  });

  socket.on("chat:msg", ({from, text}) => {
    const p = document.createElement("p");
    p.innerHTML = `<b>[${from.rank}] ${from.name}:</b> ${text}`;
    chatLog.appendChild(p);
    chatLog.scrollTop = chatLog.scrollHeight;
  });

  socket.on("points:update", ({ total, delta, reason }) => {
    local.points = total;
    pointsEl.textContent = `Points: ${local.points}`;
    showToast(`${delta>0?'+':''}${delta}  ${reason}`);
  });
  socket.on("quest:update", ({code, progress, goal}) => {
    showToast(`Görev: ${code} ${progress}/${goal}`);
  });

  socket.on("emote", ({ id, type, until }) => {
    const target = (id === local.id) ? { group: local.group, mesh: local.mesh } : remotes.get(id);
    if (!target) return;
    // Basit animasyon: hafif zıplama / renk vurgu
    const start = performance.now();
    const end = until;
    const baseColor = target.mesh.material.color.clone();
    function anim() {
      const t = performance.now();
      if (t > end) { target.mesh.material.color.copy(baseColor); target.group.position.y = 0; return; }
      const s = Math.sin((t - start)/120) * 0.08;
      target.group.position.y = Math.max(0, s);
      target.mesh.material.color.lerp(new THREE.Color(0x66ccff), 0.15);
      requestAnimationFrame(anim);
    }
    anim();
  });

  socket.on("snapshot", ({ players }) => {
    const list = players || [];
    for (const p of list) {
      if (p.id === local.id) continue;
      const R = ensureRemote(p);
      R.group.position.lerp(new THREE.Vector3(p.x, 0, p.z), 0.2);
      R.group.rotation.y = THREE.MathUtils.lerp(R.group.rotation.y, p.ry || 0, 0.2);
      if (R.name !== p.name && p.name) updateNameTag(R, p.name);
    }
  });

  // --- GAME LOOP ---
  let last = performance.now();
  let netAcc = 0;
  const tmpV = new THREE.Vector3();
  const speedWalk = 3.2;
  const speedRun = 6;

  // Hotspot ziyaret kontrolü (client-side trigger)
  function checkHotspots() {
    hotspotMeshByName.forEach((mesh, name) => {
      if (local.visited[name]) return;
      const d = mesh.position.distanceTo(local.group.position);
      if (d <= (mesh.geometry.parameters.radiusTop || 2.5) + 0.5) {
        local.visited[name] = true;
        socket.emit("hotspot:entered", { name });
      }
    });
  }

  function tick(now) {
    const dt = Math.min(0.05, (now - last)/1000);
    last = now;

    // movement
    if (!chatFocus) {
      const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
      const strafe  = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);
      const spd = keys.has("ShiftLeft") ? speedRun : speedWalk;
      if (forward || strafe) {
        tmpV.set(strafe, 0, forward).normalize();
        const sin = Math.sin(local.yaw), cos = Math.cos(local.yaw);
        const dx = tmpV.x * cos - tmpV.z * sin;
        const dz = tmpV.x * sin + tmpV.z * cos;
        local.group.position.x += dx * spd * dt;
        local.group.position.z += dz * spd * dt;
      }
      local.group.rotation.y = local.yaw;
    }

    // camera follow
    const camDist = 3.6;
    const cx = local.group.position.x - Math.sin(local.yaw) * camDist;
    const cz = local.group.position.z - Math.cos(local.yaw) * camDist;
    camera.position.lerp(new THREE.Vector3(cx, 2.0, cz), 0.15);
    camera.lookAt(local.group.position.x, local.group.position.y + 0.8, local.group.position.z);

    // network state
    netAcc += dt;
    if (netAcc > 0.08 && local.id) {
      netAcc = 0;
      socket.emit("state", {
        x: local.group.position.x,
        y: 0,
        z: local.group.position.z,
        ry: local.yaw
      });
    }

    // hotspot checks
    checkHotspots();

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // resize
  window.addEventListener("resize", () => {
    renderer.setSize(root.clientWidth, root.clientHeight);
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
  });
})();

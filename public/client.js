/* global THREE, io */
(() => {
  // ------- UI -------
  const root = document.getElementById("root");
  const cta = document.getElementById("cta");
  const playBtn = document.getElementById("playBtn");
  const nameInput = document.getElementById("nameInput");
  const pointsEl = document.getElementById("points");
  const chatLog = document.getElementById("chatLog");
  const chatText = document.getElementById("chatText");
  const chatSend = document.getElementById("chatSend");
  const toast = document.getElementById("toast");

  const socket = io(); // aynı origin

  // ------- THREE -------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x090a14, 20, 120);

  const camera = new THREE.PerspectiveCamera(75, root.clientWidth / root.clientHeight, 0.1, 600);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0x87a8ff, 0x070712, 1.0);
  const dir  = new THREE.DirectionalLight(0x8fd0ff, 0.6);
  dir.position.set(6,10,4);
  scene.add(hemi, dir);

  // Zemin
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 1.0 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Yıldızlar
  const starGeom = new THREE.BufferGeometry();
  const starPos = [];
  for (let i=0;i<3000;i++){
    starPos.push((Math.random()-0.5)*350, 30+Math.random()*90, (Math.random()-0.5)*350);
  }
  starGeom.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeom, new THREE.PointsMaterial({ size:0.6, color:0x8cbcff }));
  scene.add(stars);

  // ------- Helpers -------
  function makeNameSprite(label, color="#bfe4ff") {
    const padX = 10, padY = 4;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 24px Arial";
    const w = Math.max(64, ctx.measureText(label).width + padX*2);
    const h = 34 + padY*2;
    canvas.width = w; canvas.height = h;
    ctx.font = "bold 24px Arial";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.strokeStyle = "rgba(20,100,255,0.9)";
    ctx.lineWidth = 2;
    ctx.fillRect(0,0,w,h);
    ctx.strokeRect(0,0,w,h);
    ctx.fillStyle = color;
    ctx.fillText(label, padX, 26+padY/2);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthWrite:false }));
    sp.scale.set(w/100, h/100, 1);
    sp.position.set(0, 1.6, 0);
    return sp;
  }
  function showToast(text){ toast.textContent = text; toast.style.display="block"; setTimeout(()=>toast.style.display="none", 1600); }

  // ------- Stilize Karakter (capsule + sphere + accessory) -------
  function buildStylizedChar(primaryColor = 0xffe4c4 /*bisque-ish*/, accentColor = 0xffffff) {
    const grp = new THREE.Group();

    // Gövde
    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 0.7, 8, 16),
      new THREE.MeshStandardMaterial({ color: primaryColor, roughness:.85, metalness:.12 })
    );
    torso.castShadow = true; torso.position.y = 0.0;
    grp.add(torso);

    // Bacaklar
    const legMat = new THREE.MeshStandardMaterial({ color: primaryColor, roughness:.85 });
    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.18, 0.5, 6, 12), legMat.clone());
    const legR = legL.clone();
    legL.position.set( 0.22, -1.0, 0);
    legR.position.set(-0.22, -1.0, 0);
    grp.add(legL, legR);

    // Baş
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 20), new THREE.MeshStandardMaterial({ color: primaryColor }));
    head.position.set(0, 1.2, 0);
    grp.add(head);

    // Gözler
    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07, 12, 12), eyeMat);
    const eyeR = eyeL.clone();
    eyeL.position.set( 0.18, 1.30, 0.40);
    eyeR.position.set(-0.18, 1.30, 0.40);
    grp.add(eyeL, eyeR);

    // Ağız (küçük beyaz küre)
    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.15, 12, 12), new THREE.MeshStandardMaterial({ color: accentColor }));
    mouth.position.set(0, -0.3, -0.5);
    torso.add(mouth);

    // Omuzlar / Kollar
    const armMat = new THREE.MeshStandardMaterial({ color: primaryColor });
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.15, 0.8, 6, 12), armMat);
    const armR = armL.clone();
    armL.position.set(-0.4, 0.5, 0); armL.rotation.z = -Math.PI/8;
    armR.position.set( 0.4, 0.5, 0);  armR.rotation.z =  Math.PI/8;
    grp.add(armL, armR);

    // Sırt çantası
    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.8, 0.3), new THREE.MeshPhongMaterial({ specular: "silver", shininess: 100, color: 0xffffff }));
    pack.position.set(0, 0.3, -0.5); pack.castShadow = true; pack.receiveShadow = true;
    grp.add(pack);

    // Kask (şeffaf kubbe)
    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 24, 24),
      new THREE.MeshPhysicalMaterial({ color: 0xffffff, specularColor: "black", ior: 1, transparent: true, transmission: 1, roughness: 0, metalness: 0, thickness: 0.12, side: THREE.DoubleSide })
    );
    dome.position.set(0, 1.6, 0);
    grp.add(dome);

    // Kalp rozeti (basit torus + küre kombinasyonu, hafif stil)
    const heart = new THREE.Group();
    const heartCore = new THREE.Mesh(new THREE.SphereGeometry(0.08, 12, 12), new THREE.MeshStandardMaterial({ color: 0xff2e2e }));
    heartCore.position.set(0, 0, 0.02);
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.14, 0.02, 10, 24), new THREE.MeshStandardMaterial({ color: 0xff5555, metalness:.1, roughness:.4 }));
    heart.add(ring, heartCore);
    heart.scale.set(0.9,0.9,0.9);
    heart.position.set(0.07, 0.35, 0.52);
    heart.rotation.z = Math.PI;
    grp.add(heart);

    // Genel ölçek ve konum
    grp.scale.set(0.20, 0.20, 0.20);
    grp.position.set(0, 0, 0);

    return { group: grp, torso };
  }

  // ------- Local / Remote -------
  const local = { id:null, name:null, yaw:0, group:null, torso:null, points:0, visited:{} };
  {
    const { group, torso } = buildStylizedChar(0xffe4c4);
    local.group = group; local.torso = torso; scene.add(group);
  }
  const remotes = new Map(); // id -> { group, torso, tag, name }
  function ensureRemote(p){
    let R = remotes.get(p.id);
    if (!R) {
      const { group, torso } = buildStylizedChar(0xadd8e6);
      group.position.set(p.x, 0, p.z);
      const tag = makeNameSprite(p.name || `Yogi-${p.id.slice(0,4)}`);
      group.add(tag);
      scene.add(group);
      R = { group, torso, tag, name: p.name };
      remotes.set(p.id, R);
    }
    return R;
  }
  function updateNameTag(R, name){
    R.group.remove(R.tag);
    if (R.tag && R.tag.material && R.tag.material.map) R.tag.material.map.dispose();
    const tag = makeNameSprite(name);
    R.group.add(tag);
    R.tag = tag; R.name = name;
  }

  // ------- Hotspots & Planets -------
  const hotspotInfo = new Map(); // name -> { pos: THREE.Vector3, r: number }
  function addHotspotDisk(name, x, z, r){
    // küçük neon disk (Totem için)
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.2, 48),
      new THREE.MeshStandardMaterial({ color: 0x233a88, emissive: 0x2244ff, emissiveIntensity:0.7, transparent:true, opacity:0.45 })
    );
    m.position.set(x, 0.1, z); scene.add(m);
    hotspotInfo.set(name, { pos: new THREE.Vector3(x,0,z), r });
  }

  const planetMeshes = []; // { name, mesh, label }
  const moonTex = new THREE.TextureLoader().load("https://happy358.github.io/Images/textures/lunar_color.jpg", (t)=>{ t.colorSpace = THREE.SRGBColorSpace; });

  function addPlanet(p){
    const geo = new THREE.SphereGeometry(p.radius, 40, 40);
    const mat = new THREE.MeshPhongMaterial({
      color: p.color,
      map: moonTex, bumpMap: moonTex, bumpScale: 0.6
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, -3.0 + p.radius*0.2, p.z); // hafif çukur hissi
    mesh.rotation.x = -Math.PI/10;
    mesh.castShadow = true; mesh.receiveShadow = true;
    scene.add(mesh);

    const label = makeNameSprite(p.name, "#9ef");
    label.position.set(0, p.radius + 0.8, 0);
    mesh.add(label);

    planetMeshes.push({ name: p.name, mesh, label });
    // hotspot girişinde tetik için
    hotspotInfo.set(`Planet:${p.name}`, { pos: new THREE.Vector3(p.x,0,p.z), r: p.r });
  }

  // ------- Input -------
  const keys = new Set();
  let chatFocus = false;
  window.addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      chatFocus = !chatFocus; if (chatFocus) chatText.focus(); else chatText.blur(); return;
    }
    if (chatFocus) return;
    keys.add(e.code);
    const em = { Digit1:"wave", Digit2:"dance", Digit3:"sit", Digit4:"clap", Digit5:"point", Digit6:"cheer" };
    if (em[e.code]) socket.emit("emote:play", em[e.code]);
  });
  window.addEventListener("keyup", (e)=> keys.delete(e.code));

  function sendChat(){
    const t = chatText.value.trim(); if (!t) return;
    socket.emit("chat:send", { text:t }); chatText.value="";
  }
  chatSend.addEventListener("click", sendChat);
  chatText.addEventListener("keydown", (e)=>{ if (e.key==="Enter") sendChat(); });

  playBtn.addEventListener("click", () => {
    cta.style.display = "none";
    const desired = (nameInput.value||"").trim().slice(0,20);
    if (desired) socket.emit("profile:update", { name: desired });
    renderer.domElement.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement !== renderer.domElement) cta.style.display = "flex";
  });
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === renderer.domElement && !chatFocus) {
      local.yaw -= e.movementX * 0.0025;
    }
  });

  // ------- Socket events -------
  socket.on("bootstrap", ({ you, players, hotspots, planets }) => {
    local.id = you.id; local.name = you.name; local.points = you.points||0;
    pointsEl.textContent = `Points: ${local.points}`;
    local.group.position.set(you.x, 0, you.z);
    local.group.rotation.y = you.ry || 0;

    // Hotspot’lar
    (hotspots||[]).forEach(h => {
      if (h.name === "Totem") addHotspotDisk(h.name, h.x, h.z, h.r);
      else hotspotInfo.set(h.name, { pos: new THREE.Vector3(h.x,0,h.z), r: h.r }); // gezegenler için disk çizmeden
    });

    // Gezegenler (sahnede görünür)
    (planets||[]).forEach(addPlanet);

    // Diğer oyuncular
    (players||[]).forEach(p => { const R = ensureRemote(p); updateNameTag(R, p.name || R.name); });
  });

  socket.on("player-joined", (p) => { if (p.id!==local.id) { const R = ensureRemote(p); updateNameTag(R, p.name || R.name); } });
  socket.on("player-left", (id) => { const R = remotes.get(id); if (R){ scene.remove(R.group); remotes.delete(id); } });
  socket.on("player:name", ({id, name}) => { const R = remotes.get(id); if (R) updateNameTag(R, name); });

  socket.on("chat:msg", ({ from, text }) => {
    const p = document.createElement("p");
    p.innerHTML = `<b>[${from.rank}] ${from.name}:</b> ${text}`;
    chatLog.appendChild(p); chatLog.scrollTop = chatLog.scrollHeight;
  });

  socket.on("points:update", ({ total, delta, reason }) => {
    local.points = total; pointsEl.textContent = `Points: ${local.points}`;
    showToast(`${delta>0?'+':''}${delta}  ${reason}`);
  });
  socket.on("quest:update", ({code, progress, goal}) => showToast(`Görev: ${code} ${progress}/${goal}`));

  socket.on("emote", ({ id, type, until }) => {
    const target = (id===local.id) ? { group: local.group, torso: local.torso } : remotes.get(id);
    if (!target) return;
    const start = performance.now(); const end = until; const base = target.torso.material.color.clone();
    (function anim(){
      const t = performance.now();
      if (t> end) { target.torso.material.color.copy(base); target.group.position.y = 0; return; }
      target.group.position.y = Math.max(0, Math.sin((t-start)/120)*0.08);
      target.torso.material.color.lerp(new THREE.Color(0x66ccff), 0.15);
      requestAnimationFrame(anim);
    })();
  });

  socket.on("snapshot", ({ players }) => {
    (players||[]).forEach(p=>{
      if (p.id===local.id) return;
      const R = ensureRemote(p);
      R.group.position.lerp(new THREE.Vector3(p.x,0,p.z), 0.2);
      R.group.rotation.y = THREE.MathUtils.lerp(R.group.rotation.y, p.ry||0, 0.2);
      if (R.name !== p.name && p.name) updateNameTag(R, p.name);
    });
  });

  // ------- Game loop -------
  let last = performance.now();
  let netAcc = 0;
  const tmpV = new THREE.Vector3();
  const speedWalk=3.2, speedRun=6;

  function checkHotspots(){
    hotspotInfo.forEach((info, name)=>{
      if (local.visited[name]) return;
      const d = info.pos.distanceTo(local.group.position);
      if (d <= info.r + 0.5) {
        local.visited[name] = true;
        socket.emit("hotspot:entered", { name });
      }
    });
  }

  function tick(now){
    const dt = Math.min(0.05, (now-last)/1000); last = now;

    // hareket
    if (!chatFocus) {
      const forward = (keys.has("KeyW")?1:0) - (keys.has("KeyS")?1:0);
      const strafe  = (keys.has("KeyD")?1:0) - (keys.has("KeyA")?1:0);
      const spd = keys.has("ShiftLeft") ? speedRun : speedWalk;
      if (forward || strafe) {
        tmpV.set(strafe,0,forward).normalize();
        const sin = Math.sin(local.group.rotation.y), cos = Math.cos(local.group.rotation.y);
        const dx = tmpV.x * cos - tmpV.z * sin;
        const dz = tmpV.x * sin + tmpV.z * cos;
        local.group.position.x += dx * spd * dt;
        local.group.position.z += dz * spd * dt;
      }
    }

    // kamera
    const camDist = 3.6;
    const cx = local.group.position.x - Math.sin(local.group.rotation.y) * camDist;
    const cz = local.group.position.z - Math.cos(local.group.rotation.y) * camDist;
    camera.position.lerp(new THREE.Vector3(cx, 2.0, cz), 0.15);
    camera.lookAt(local.group.position.x, local.group.position.y + 0.8, local.group.position.z);

    // gezegenlere hafif dönüş
    for (const p of planetMeshes) p.mesh.rotation.y -= 0.0012;

    // ağ
    netAcc += dt;
    if (netAcc > 0.08 && local.id) {
      netAcc = 0;
      socket.emit("state", { x:local.group.position.x, y:0, z:local.group.position.z, ry: local.group.rotation.y });
    }

    // hotspot kontrol
    checkHotspots();

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // resize
  window.addEventListener("resize", ()=>{
    renderer.setSize(root.clientWidth, root.clientHeight);
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
  });
})();

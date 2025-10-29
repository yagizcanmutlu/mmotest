/* global THREE, io */
(() => {
  // ==== UI REFS ====
  const root = document.getElementById("root");
  const cta = document.getElementById("cta");
  const playBtn = document.getElementById("playBtn");
  const nameInput = document.getElementById("nameInput");
  const pointsEl = document.getElementById("points");
  const chatLog = document.getElementById("chatLog");
  const chatText = document.getElementById("chatText");
  const chatSend = document.getElementById("chatSend");
  const toast = document.getElementById("toast");
  const joy = document.getElementById("joystick");
  const stick = document.getElementById("stick");
  const lookpad = document.getElementById("lookpad");

  const socket = io(); // same origin

  // ==== THREE SCENE ====
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

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(600, 600),
    new THREE.MeshStandardMaterial({ color: 0x0c0f14, roughness: 1.0 })
  );
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Stars
  const starGeom = new THREE.BufferGeometry();
  const starPos = [];
  for (let i=0;i<3000;i++){
    starPos.push((Math.random()-0.5)*350, 30+Math.random()*90, (Math.random()-0.5)*350);
  }
  starGeom.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
  const stars = new THREE.Points(starGeom, new THREE.PointsMaterial({ size:0.6, color:0x8cbcff }));
  scene.add(stars);

  // ==== HELPERS ====
  function makeNameSprite(label, color="#bfe4ff") {
    const padX=8, padY=4;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 18px Arial";                      // küçük font
    const w = Math.max(56, ctx.measureText(label).width + padX*2);
    const h = 28 + padY*2;
    canvas.width = w; canvas.height = h;
    ctx.font = "bold 18px Arial";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.strokeStyle = "rgba(20,100,255,0.9)";
    ctx.lineWidth = 2;
    ctx.fillRect(0,0,w,h);
    ctx.strokeRect(0,0,w,h);
    ctx.fillStyle = color;
    ctx.fillText(label, padX, 22);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthWrite:false, depthTest:false }); // her zaman görünür
    const sp = new THREE.Sprite(mat);
    sp.scale.set(w/300, h/300, 1);                     // ufak ölçek
    sp.position.set(0, 1.85, 0);                       // karakter üstü
    return sp;
  }
  function showToast(text){ toast.textContent=text; toast.style.display="block"; setTimeout(()=>toast.style.display="none", 1500); }

  // ==== Stylized Character ====
  function buildStylizedChar(primaryColor = 0xffe4c4, accentColor = 0xffffff) {
    const grp = new THREE.Group();

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 0.7, 8, 16),
      new THREE.MeshStandardMaterial({ color: primaryColor, roughness:.85, metalness:.12 })
    );
    torso.castShadow = true;
    grp.add(torso);

    const legMat = new THREE.MeshStandardMaterial({ color: primaryColor, roughness:.85 });
    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(0.18,0.5,6,12), legMat.clone());
    const legR = legL.clone(); legL.position.set( 0.22,-1.0,0); legR.position.set(-0.22,-1.0,0);
    grp.add(legL, legR);

    const head = new THREE.Mesh(new THREE.SphereGeometry(0.5, 20, 20), new THREE.MeshStandardMaterial({ color: primaryColor }));
    head.position.set(0,1.2,0); grp.add(head);

    const eyeMat = new THREE.MeshStandardMaterial({ color: 0x111111 });
    const eyeL = new THREE.Mesh(new THREE.SphereGeometry(0.07,12,12), eyeMat);
    const eyeR = eyeL.clone(); eyeL.position.set( 0.18,1.30,0.40); eyeR.position.set(-0.18,1.30,0.40);
    grp.add(eyeL, eyeR);

    const mouth = new THREE.Mesh(new THREE.SphereGeometry(0.15,12,12), new THREE.MeshStandardMaterial({ color: accentColor }));
    mouth.position.set(0,-0.3,-0.5); torso.add(mouth);

    const armMat = new THREE.MeshStandardMaterial({ color: primaryColor });
    const armL = new THREE.Mesh(new THREE.CapsuleGeometry(0.15,0.8,6,12), armMat);
    const armR = armL.clone(); armL.position.set(-0.4,0.5,0); armL.rotation.z=-Math.PI/8; armR.position.set(0.4,0.5,0); armR.rotation.z=Math.PI/8;
    grp.add(armL, armR);

    const pack = new THREE.Mesh(new THREE.BoxGeometry(0.7,0.8,0.3), new THREE.MeshPhongMaterial({ specular:"silver", shininess:100, color:0xffffff }));
    pack.position.set(0,0.3,-0.5); pack.castShadow=true; pack.receiveShadow=true; grp.add(pack);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 24, 24),
      new THREE.MeshPhysicalMaterial({ color:0xffffff, specularColor:"black", ior:1, transparent:true, transmission:1, roughness:0, metalness:0, thickness:0.12, side:THREE.DoubleSide })
    );
    dome.position.set(0,1.6,0); grp.add(dome);

    grp.scale.set(0.20,0.20,0.20);
    return { group: grp, torso };
  }

  // ==== Local / Remote ====
  const local = { id:null, name:null, yaw:0, group:null, torso:null, tag:null, points:0, visited:{} };
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
      R = { group, torso, tag, name: p.name || `Yogi-${p.id.slice(0,4)}` };
      scene.add(group);
      remotes.set(p.id, R);
    }
    return R;
  }
  function updateNameTag(holder, name){
    if (holder.tag) {
      holder.group.remove(holder.tag);
      holder.tag.material.map.dispose();
    }
    holder.tag = makeNameSprite(name);
    holder.group.add(holder.tag);
    holder.name = name;
  }
  function getDisplayName(id){
    if (id===local.id) return local.name || "You";
    const R = remotes.get(id); return (R && R.name) || `Yogi-${String(id).slice(0,4)}`;
  }

  // ==== Hotspots & Planets ====
  const hotspotInfo = new Map(); // name -> { pos: THREE.Vector3, r: number }
  function addHotspotDisk(name, x, z, r){
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.2, 48),
      new THREE.MeshStandardMaterial({ color:0x233a88, emissive:0x2244ff, emissiveIntensity:0.7, transparent:true, opacity:0.45 })
    );
    m.position.set(x,0.1,z); scene.add(m);
    hotspotInfo.set(name, { pos:new THREE.Vector3(x,0,z), r });
  }

  const planetMeshes = [];
  const moonTex = new THREE.TextureLoader().load("https://happy358.github.io/Images/textures/lunar_color.jpg", t=>{
    t.colorSpace = THREE.SRGBColorSpace;
  });
  function addPlanet(p){
    const geo = new THREE.SphereGeometry(p.radius, 40, 40);
    const mat = new THREE.MeshPhongMaterial({ color: p.color, map: moonTex, bumpMap: moonTex, bumpScale: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, -3.0 + p.radius*0.2, p.z);
    mesh.rotation.x = -Math.PI/10;
    mesh.castShadow = true; mesh.receiveShadow = true;
    const label = makeNameSprite(p.name, "#9ef");
    label.position.set(0, p.radius + 0.8, 0);
    mesh.add(label);
    scene.add(mesh);
    planetMeshes.push({ name:p.name, mesh, label });
    hotspotInfo.set(`Planet:${p.name}`, { pos:new THREE.Vector3(p.x,0,p.z), r:p.r });
  }

  // ==== INPUT ====
  const keys = new Set();
  let chatFocus = false;
  window.addEventListener("keydown", (e)=>{
    if (e.code === "Enter") {
      chatFocus = !chatFocus; if (chatFocus) chatText.focus(); else chatText.blur(); return;
    }
    if (chatFocus) return;
    keys.add(e.code);
    const em = { Digit1:"wave", Digit2:"dance", Digit3:"sit", Digit4:"clap", Digit5:"point", Digit6:"cheer" };
    if (em[e.code]) socket.emit("emote:play", em[e.code]);
    if (e.code === "KeyQ") local.yaw += 0.06;
    if (e.code === "KeyE") local.yaw -= 0.06;
  });
  window.addEventListener("keyup", (e)=> keys.delete(e.code));

  // Pointer-lock bakış (desktop)
  playBtn.addEventListener("click", () => {
    cta.style.display = "none";
    const desired = (nameInput.value||"").trim().slice(0,20);
    if (desired) { socket.emit("profile:update", { name: desired }); local.name = desired; if (local.tag) updateNameTag(local, desired); }
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

  // Drag-to-look (touch & mouse) — sağ alan
  let lookActive = false, lastLX = 0;
  function lookStart(x){ lookActive = true; lastLX = x; }
  function lookMove(x){ if (!lookActive) return; const dx = x - lastLX; lastLX = x; local.yaw -= dx * 0.003; }
  function lookEnd(){ lookActive = false; }
  // Mouse
  lookpad.addEventListener("mousedown", (e)=>lookStart(e.clientX));
  window.addEventListener("mousemove", (e)=>lookMove(e.clientX));
  window.addEventListener("mouseup", lookEnd);
  // Touch
  lookpad.addEventListener("touchstart", (e)=>{ if (e.touches[0]) lookStart(e.touches[0].clientX); }, {passive:false});
  lookpad.addEventListener("touchmove",  (e)=>{ if (e.touches[0]) lookMove(e.touches[0].clientX); }, {passive:false});
  lookpad.addEventListener("touchend", lookEnd);

  // Mouse wheel zoom
  let camDist = 3.6;
  window.addEventListener("wheel", (e)=>{
    camDist += e.deltaY * 0.002;
    camDist = Math.min(10, Math.max(2, camDist));
  }, {passive:true});

  // Mobile joystick
  let joyActive = false, joyCenter = {x:0,y:0}, joyVec = {x:0,y:0};
  function setStick(x,y){ stick.style.transform = `translate(${x}px, ${y}px)`; }
  function joyReset(){ joyActive=false; joyVec.x=0; joyVec.y=0; setStick(-50,-50); } // back to center (since width/height 56 ~ ~50 offset)
  joyReset();

  function joyStart(cx,cy){ joyActive=true; const rect = joy.getBoundingClientRect(); joyCenter.x = rect.left + rect.width/2; joyCenter.y = rect.top + rect.height/2; updateJoy(cx,cy); }
  function updateJoy(px,py){
    const dx = px - joyCenter.x;
    const dy = py - joyCenter.y;
    const rMax = 44; // radius limit
    const len = Math.hypot(dx,dy) || 1;
    const k = Math.min(1, rMax/len);
    const nx = dx * k, ny = dy * k;
    setStick(nx-28, ny-28);
    joyVec.x = nx / rMax;  // strafe
    joyVec.y = -ny / rMax; // forward
  }
  // Mouse
  joy.addEventListener("mousedown", (e)=>{ e.preventDefault(); joyStart(e.clientX,e.clientY); });
  window.addEventListener("mousemove", (e)=>{ if (joyActive) updateJoy(e.clientX,e.clientY); });
  window.addEventListener("mouseup", joyReset);
  // Touch
  joy.addEventListener("touchstart", (e)=>{ const t=e.touches[0]; if (t) joyStart(t.clientX,t.clientY); }, {passive:false});
  joy.addEventListener("touchmove", (e)=>{ const t=e.touches[0]; if (t) updateJoy(t.clientX,t.clientY); }, {passive:false});
  joy.addEventListener("touchend", joyReset);

  // ==== SOCKET EVENTS ====
  socket.on("bootstrap", ({ you, players, hotspots, planets }) => {
    local.id = you.id; local.name = you.name; local.points = you.points||0;
    pointsEl.textContent = `Points: ${local.points}`;
    local.group.position.set(you.x, 0, you.z);
    local.yaw = you.ry || 0;
    // local name tag
    updateNameTag(local, local.name || `Yogi-${local.id?.slice(0,4)}`);

    (hotspots||[]).forEach(h=>{
      if (h.name==="Totem") addHotspotDisk(h.name, h.x, h.z, h.r);
      else hotspotInfo.set(h.name, { pos:new THREE.Vector3(h.x,0,h.z), r:h.r });
    });
    (planets||[]).forEach(addPlanet);
    (players||[]).forEach(p=>{ const R = ensureRemote(p); updateNameTag(R, p.name || R.name); });
  });

  socket.on("player-joined", (p)=>{ if (p.id!==local.id){ const R = ensureRemote(p); updateNameTag(R, p.name || R.name); }});
  socket.on("player-left", (id)=>{ const R=remotes.get(id); if (R){ scene.remove(R.group); remotes.delete(id);} });
  socket.on("player:name", ({id,name})=>{
    if (id===local.id){ local.name = name; updateNameTag(local, name); }
    const R=remotes.get(id); if (R) updateNameTag(R, name);
  });

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

  // Emote animasyonu – token’lı (takılmayı engeller) + chat’e bildirim
  const emoteTokens = new Map(); // id -> n
  socket.on("emote", ({ id, type, until }) => {
    const target = (id===local.id) ? { holder: local, group: local.group, torso: local.torso } : remotes.get(id);
    if (!target) return;

    // Chat bildirimi
    const p = document.createElement("p");
    p.innerHTML = `<i style="opacity:.8">[emote] ${getDisplayName(id)}: /${type}</i>`;
    chatLog.appendChild(p); chatLog.scrollTop = chatLog.scrollHeight;

    const base = target.torso.material.color.clone();
    const token = (emoteTokens.get(id) || 0) + 1;
    emoteTokens.set(id, token);

    const duration = Math.max(600, Math.min(1500, (until ? (until - Date.now()) : 1200)));
    const start = performance.now();
    function anim(){
      if (emoteTokens.get(id) !== token) { // yeni emote geldiyse eskiyi durdur
        target.torso.material.color.copy(base);
        target.group.position.y = 0;
        return;
      }
      const t = performance.now();
      const done = (t - start)/duration;
      if (done >= 1) {
        target.torso.material.color.copy(base);
        target.group.position.y = 0;
        return;
      }
      target.group.position.y = Math.max(0, Math.sin((t - start)/120)*0.08);
      target.torso.material.color.lerp(new THREE.Color(0x66ccff), 0.15);
      requestAnimationFrame(anim);
    }
    anim();
  });

  socket.on("snapshot", ({ players }) => {
    (players||[]).forEach(p=>{
      if (p.id===local.id) return;
      const R = ensureRemote(p);
      R.group.position.lerp(new THREE.Vector3(p.x,0,p.z), 0.2);
      if (typeof p.ry === "number") R.group.rotation.y = THREE.MathUtils.lerp(R.group.rotation.y, p.ry, 0.2);
      if (R.name !== p.name && p.name) updateNameTag(R, p.name);
    });
  });

  // ==== GAME LOOP ====
  let last = performance.now();
  let netAcc = 0;
  const tmpV = new THREE.Vector3();
  const speedWalk = 3.2, speedRun = 6;

  function checkHotspots(){
    hotspotInfo.forEach((info, name)=>{
      if (local.visited[name]) return;
      const d = info.pos.distanceTo(local.group.position);
      if (d <= info.r + 0.5) { local.visited[name]=true; socket.emit("hotspot:entered", { name }); }
    });
  }

  function tick(now){
    const dt = Math.min(0.05, (now-last)/1000); last = now;

    // --- yön (WASD + joystick) ---
    const kForward = (keys.has("KeyW")?1:0) - (keys.has("KeyS")?1:0);
    const kStrafe  = (keys.has("KeyD")?1:0) - (keys.has("KeyA")?1:0);
    let forward = kForward + joyVec.y;
    let strafe  = kStrafe  + joyVec.x;
    forward = Math.max(-1, Math.min(1, forward));
    strafe  = Math.max(-1, Math.min(1, strafe));

    const spd = (keys.has("ShiftLeft") ? speedRun : speedWalk) * (Math.hypot(strafe,forward) > 1 ? (1/Math.hypot(strafe,forward)) : 1);

    if (forward || strafe) {
      tmpV.set(strafe,0,forward).normalize();
      const sin = Math.sin(local.yaw), cos = Math.cos(local.yaw);
      const dx = tmpV.x * cos - tmpV.z * sin;
      const dz = tmpV.x * sin + tmpV.z * cos;
      local.group.position.x += dx * spd * dt;
      local.group.position.z += dz * spd * dt;
    }

    // yaw'ı gruba uygula (mouse/drag ile değişiyor)
    local.group.rotation.y = local.yaw;

    // Kamera takibi + zoom
    const cx = local.group.position.x - Math.sin(local.yaw) * camDist;
    const cz = local.group.position.z - Math.cos(local.yaw) * camDist;
    camera.position.lerp(new THREE.Vector3(cx, 2.0, cz), 0.15);
    camera.lookAt(local.group.position.x, local.group.position.y + 0.8, local.group.position.z);

    // Planets idle rotation
    for (const p of planetMeshes) p.mesh.rotation.y -= 0.0012;

    // Ağ
    netAcc += dt;
    if (netAcc > 0.08 && local.id) {
      netAcc = 0;
      socket.emit("state", { x:local.group.position.x, y:0, z:local.group.position.z, ry: local.yaw });
    }

    // Hotspots
    checkHotspots();

    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  requestAnimationFrame(tick);

  // Resize
  window.addEventListener("resize", ()=>{
    renderer.setSize(root.clientWidth, root.clientHeight);
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
  });

  // Chat helpers
  function sendChat(){ const t = chatText.value.trim(); if (!t) return; socket.emit("chat:send", { text:t }); chatText.value=""; }
  chatSend.addEventListener("click", sendChat);
  chatText.addEventListener("keydown", (e)=>{ if (e.key === "Enter") sendChat(); });
})();

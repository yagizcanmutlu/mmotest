/* global THREE, io */
(() => {
  // ====== Space Base Floor Shader ======
  function createSpaceBaseFloor(THREE, {
    size = 280,
    tilesPerUnit = 2.5,
    emissiveStrength = 1.6,
    stripeDensity = 7.0,
    lightColor = "#99c9ff",
    metalA = "#77808a",
    metalB = "#262b31",
    caution = "#ffcf5a"
  } = {}) {
    const cLight = new THREE.Color(lightColor);
    const cA = new THREE.Color(metalA);
    const cB = new THREE.Color(metalB);
    const cC = new THREE.Color(caution);

    const geo = new THREE.PlaneGeometry(size, size, 1, 1);
    geo.rotateX(-Math.PI / 2);

    const mat = new THREE.ShaderMaterial({
      uniforms: {
        uTime: { value: 0 },
        uTiles: { value: tilesPerUnit },
        uEmi: { value: emissiveStrength },
        uStripe: { value: stripeDensity },
        uLight: { value: new THREE.Vector3(cLight.r, cLight.g, cLight.b) },
        uA: { value: new THREE.Vector3(cA.r, cA.g, cA.b) },
        uB: { value: new THREE.Vector3(cB.r, cB.g, cB.b) },
        uC: { value: new THREE.Vector3(cC.r, cC.g, cC.b) },
        uSize: { value: size }
      },
      vertexShader: `
        varying vec2 vUv;
        varying vec3 vPos;
        void main(){
          vUv = uv;
          vPos = (modelMatrix * vec4(position,1.0)).xyz;
          gl_Position = projectionMatrix * viewMatrix * vec4(vPos,1.0);
        }
      `,
      fragmentShader: `
        precision highp float;
        varying vec2 vUv;
        varying vec3 vPos;
        uniform float uTime, uTiles, uEmi, uStripe, uSize;
        uniform vec3 uLight, uA, uB, uC;

        float gridLine(float x,float w){ return smoothstep(0.0,w,x) - smoothstep(1.0-w,1.0,x); }
        float checker(vec2 uv){
          vec2 f = floor(uv);
          return mod(f.x + f.y, 2.0);
        }
        float saw(float x){ return fract(x); }
        float pulse(float x){ return smoothstep(0.0,0.15,x) * (1.0 - smoothstep(0.85,1.0,x)); }

        void main(){
          // Tiled UV
          vec2 tuv = vUv * uTiles * (uSize/100.0);

          // Base metal checker
          float ck = checker(tuv);
          vec3 base = mix(uA, uB, ck);

          // Thin neon grid lines
          vec2 fracUv = fract(tuv);
          float glx = step(fracUv.x, 0.02) + step(0.98, fracUv.x);
          float gly = step(fracUv.y, 0.02) + step(0.98, fracUv.y);
          float grid = clamp(glx + gly, 0.0, 1.0);

          // Scanning stripes
          float scan = 0.0;
          scan += 0.35 * sin(tuv.x * uStripe + uTime*1.6);
          scan += 0.25 * sin(tuv.y * (uStripe*0.85) - uTime*1.2);
          scan = clamp(scan*0.5 + 0.5, 0.0, 1.0);

          // Center caution ring
          float r = length(vPos.xz);
          float cautionMask = smoothstep(35.0, 30.0, r) * (1.0 - smoothstep(30.0, 25.0, r));
          // diagonal stripes
          float diag = step(0.5, fract((vPos.x + vPos.z)*0.12 + uTime*0.5));
          vec3 cautionCol = mix(uC*0.4, uC, 0.7*diag) * cautionMask;

          // Emissive glow
          vec3 neon = uLight * (grid*0.9 + scan*0.6) * uEmi;

          vec3 col = base + neon + cautionCol;
          // Subtle vignette
          float vig = smoothstep(uSize*0.45, uSize*0.25, r);
          col *= mix(0.95, 1.0, vig);

          gl_FragColor = vec4(col, 1.0);
        }
      `,
      lights: false,
      fog: true
    });

    const mesh = new THREE.Mesh(geo, mat);
    mesh.receiveShadow = true;

    return {
      mesh,
      update(time /*, camera */) {
        mat.uniforms.uTime.value = time;
      }
    };
  }

  // ====== UI refs ======
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

  const socket = io();

  // Device: joystick sadece mobilde
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (joy) joy.style.display = isTouch ? "block" : "none";

  // ====== THREE setup ======
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x090a14, 30, 160);

  const camera = new THREE.PerspectiveCamera(75, root.clientWidth / root.clientHeight, 0.1, 1200);
  camera.position.set(0, 1.6, 4);

  // Işıklar
  const hemi = new THREE.HemisphereLight(0x87a8ff, 0x070712, 0.8);
  const dir  = new THREE.DirectionalLight(0xffffff, 1.0);
  dir.position.set(3, 6, 2);
  dir.castShadow = true;
  dir.shadow.mapSize.set(1024,1024);
  scene.add(hemi, dir);

  // === Space Base zemin (mavi eski zemin kaldırıldı) ===
  const clock = new THREE.Clock();
  const floor = createSpaceBaseFloor(THREE, {
    size: 280,
    tilesPerUnit: 2.5,
    emissiveStrength: 1.6,
    stripeDensity: 7.0,
    lightColor: "#99c9ff",
    metalA: "#77808a",
    metalB: "#262b31",
    caution: "#ffcf5a"
  });
  scene.add(floor.mesh);

  // Stars
  {
    const starGeom = new THREE.BufferGeometry();
    const starPos = [];
    for (let i=0;i<3000;i++){
      starPos.push((Math.random()-0.5)*500, 60+Math.random()*140, (Math.random()-0.5)*500);
    }
    starGeom.setAttribute("position", new THREE.Float32BufferAttribute(starPos, 3));
    const stars = new THREE.Points(starGeom, new THREE.PointsMaterial({ size:0.7, color:0x8cbcff }));
    scene.add(stars);
  }

  // ===== Helpers =====
  function makeNameSprite(label, color="#bfe4ff") {
    const padX=10, padY=6;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    ctx.font = "bold 22px Arial";
    const w = Math.max(100, ctx.measureText(label).width + padX*2);
    const h = 32 + padY*2;
    canvas.width = w; canvas.height = h;
    ctx.font = "bold 22px Arial";
    ctx.fillStyle = "rgba(0,0,0,0.55)";
    ctx.strokeStyle = "rgba(20,100,255,0.9)";
    ctx.lineWidth = 2;
    ctx.fillRect(0,0,w,h);
    ctx.strokeRect(0,0,w,h);
    ctx.fillStyle = color;
    ctx.fillText(label, padX, 26);
    const tex = new THREE.CanvasTexture(canvas);
    tex.minFilter = THREE.LinearFilter; tex.magFilter = THREE.LinearFilter;
    const mat = new THREE.SpriteMaterial({ map: tex, depthWrite:false, depthTest:false });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 9999;
    sp.scale.set(w/90, h/90, 1);
    sp.position.set(0, 2.15, 0);
    return sp;
  }
  function showToast(text){ toast.textContent=text; toast.style.display="block"; setTimeout(()=>toast.style.display="none", 1500); }

  // ===== Stylized Character + Jetpack =====
  function buildStylizedChar(primaryColor = 0xffe4c4, accentColor = 0xffffff) {
    const grp = new THREE.Group();

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 0.7, 8, 16),
      new THREE.MeshStandardMaterial({ color: primaryColor, roughness:.85, metalness:.12 })
    );
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
    pack.position.set(0,0.3,-0.5); grp.add(pack);

    // Jet flame group (başta gizli)
    const flameGrp = new THREE.Group();
    flameGrp.position.set(0,-0.05,-0.65);
    const coneOuter = new THREE.Mesh(
      new THREE.ConeGeometry(0.28, 1.1, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xff7a1a, transparent:true, opacity:0.7, blending:THREE.AdditiveBlending, depthWrite:false })
    );
    coneOuter.rotation.x = -Math.PI/2;
    const coneInner = new THREE.Mesh(
      new THREE.ConeGeometry(0.16, 0.8, 16, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffffff, transparent:true, opacity:0.9, blending:THREE.AdditiveBlending, depthWrite:false })
    );
    coneInner.rotation.x = -Math.PI/2;
    const jetLight = new THREE.PointLight(0xffa050, 0, 2.8);
    jetLight.position.set(0,-0.1,-0.2);
    flameGrp.add(coneOuter, coneInner, jetLight);
    flameGrp.visible = false;
    pack.add(flameGrp);

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 24, 24),
      new THREE.MeshPhysicalMaterial({ color:0xffffff, specularColor:"black", ior:1, transparent:true, transmission:1, roughness:0, metalness:0, thickness:0.12, side:THREE.DoubleSide })
    );
    dome.position.set(0,1.6,0); grp.add(dome);

    grp.scale.set(0.20,0.20,0.20);
    return { group: grp, torso, head, armL, armR, legL, legR, pack, flameGrp };
  }

  // ===== Local/Remote =====
  const local = { id:null, name:null, yaw:0, parts:null, tag:null, points:0, visited:{}, vy:0, jet:false };
  {
    const parts = buildStylizedChar(0xffe4c4);
    local.parts = parts; scene.add(parts.group);
  }
  const remotes = new Map();
  function ensureRemote(p){
    let R = remotes.get(p.id);
    if (!R) {
      const parts = buildStylizedChar(0xadd8e6);
      parts.group.position.set(p.x, p.y||0, p.z);
      const tag = makeNameSprite(p.name || `Yogi-${p.id.slice(0,4)}`);
      parts.group.add(tag);
      R = { parts, tag, name: p.name || `Yogi-${p.id.slice(0,4)}` };
      scene.add(parts.group);
      remotes.set(p.id, R);
    }
    return R;
  }
  function updateNameTag(holder, name){
    if (holder.tag) {
      holder.parts.group.remove(holder.tag);
      holder.tag.material.map.dispose();
    }
    holder.tag = makeNameSprite(name);
    holder.parts.group.add(holder.tag);
    holder.name = name;
  }
  function getDisplayName(id){
    if (id===local.id) return local.name || "You";
    const R = remotes.get(id); return (R && R.name) || `Yogi-${String(id).slice(0,4)}`;
  }

  // ===== Hotspots & Planets (HALO YOK, daha uzak & büyük) =====
  const hotspotInfo = new Map();
  function addHotspotDisk(name, x, z, r){
    const m = new THREE.Mesh(
      new THREE.CylinderGeometry(r, r, 0.2, 48),
      new THREE.MeshStandardMaterial({ color:0x233a88, emissive:0x2244ff, emissiveIntensity:0.7, transparent:true, opacity:0.45 })
    );
    m.position.set(x,0.1,z); scene.add(m);
    hotspotInfo.set(name, { pos:new THREE.Vector3(x,0,z), r });
  }

  const PLANET_DISTANCE_SCALE = 1.9;
  const PLANET_RADIUS_SCALE = 1.55;

  const planetMeshes = [];
  const moonTex = new THREE.TextureLoader().load("https://happy358.github.io/Images/textures/lunar_color.jpg", t=>{
    t.colorSpace = THREE.SRGBColorSpace;
  });
  function addPlanet(p){
    const baseR = p.radius || 6;
    const R = baseR * PLANET_RADIUS_SCALE;
    const geo = new THREE.SphereGeometry(R, 40, 40);
    const mat = new THREE.MeshPhongMaterial({ color: p.color || 0xffffff, map: moonTex, bumpMap: moonTex, bumpScale: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    const X = (p.x||0) * PLANET_DISTANCE_SCALE;
    const Z = (p.z||0) * PLANET_DISTANCE_SCALE;
    mesh.position.set(X, R + 0.1, Z); // zemin üstünde
    mesh.rotation.x = -Math.PI/10;
    mesh.castShadow = true; mesh.receiveShadow = true;

    const label = makeNameSprite(p.name || "Planet", "#9ef");
    label.position.set(0, R + 0.8, 0);
    mesh.add(label);

    scene.add(mesh);
    planetMeshes.push({ name:p.name, mesh, label, R });
    hotspotInfo.set(`Planet:${p.name||"P"}`, { pos:new THREE.Vector3(X,0,Z), r:(p.r || (R + 12)) });
  }

  // ===== Input =====
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
    // Q/E: küçük yaw atımları
    if (e.code === "KeyQ") local.yaw += 0.06;
    if (e.code === "KeyE") local.yaw -= 0.06;
    if (e.code === "Space") local.jet = true; // jetpack ON
  });
  window.addEventListener("keyup", (e)=> {
    keys.delete(e.code);
    if (e.code === "Space") local.jet = false; // jetpack OFF
  });

  // Pointer-lock look (desktop)
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
      local.yaw -= e.movementX * 0.0025; // sola hareket -> sola bakış
    }
  });

  // Drag look (sağ alan)
  let lookActive = false, lastLX = 0;
  function lookStart(x){ lookActive = true; lastLX = x; }
  function lookMove(x){ if (!lookActive) return; const dx = x - lastLX; lastLX = x; local.yaw -= dx * 0.003; }
  function lookEnd(){ lookActive = false; }
  if (lookpad){
    lookpad.addEventListener("mousedown", (e)=>lookStart(e.clientX));
    window.addEventListener("mousemove", (e)=>lookMove(e.clientX));
    window.addEventListener("mouseup", lookEnd);
    lookpad.addEventListener("touchstart", (e)=>{ const t=e.touches[0]; if (t) lookStart(t.clientX); }, {passive:false});
    lookpad.addEventListener("touchmove",  (e)=>{ const t=e.touches[0]; if (t) lookMove(t.clientX); }, {passive:false});
    lookpad.addEventListener("touchend", lookEnd);
  }

  // Zoom
  let camDist = 3.8;
  window.addEventListener("wheel", (e)=>{
    camDist += e.deltaY * 0.002;
    camDist = Math.min(14, Math.max(2, camDist));
  }, {passive:true});

  // Mobile joystick (solda) — SADECE MOBİL ve merkezde
  let joyActive = false, joyCenter = {x:0,y:0}, joyVec = {x:0,y:0};
  const stickHalf = () => (stick ? stick.getBoundingClientRect().width/2 : 0);
  function setStick(px,py){ if (!stick) return; stick.style.transform = `translate(${px - stickHalf()}px, ${py - stickHalf()}px)`; }
  function joyReset(){ joyActive=false; joyVec.x=0; joyVec.y=0; setStick(0,0); }
  if (isTouch && joy && stick){
    setTimeout(joyReset, 0); // başlangıçta tam merkez
    function joyStart(cx,cy){ joyActive=true; const rect = joy.getBoundingClientRect(); joyCenter.x = rect.left + rect.width/2; joyCenter.y = rect.top + rect.height/2; updateJoy(cx,cy); }
    function updateJoy(px,py){
      const dx = px - joyCenter.x, dy = py - joyCenter.y;
      const rMax = 44, len = Math.hypot(dx,dy) || 1, k = Math.min(1, rMax/len);
      const nx = dx * k, ny = dy * k;
      setStick(nx, ny);
      joyVec.x = nx / rMax;      // +sağ
      joyVec.y = -ny / rMax;     // +ileri
    }
    joy.addEventListener("mousedown", (e)=>{ e.preventDefault(); joyStart(e.clientX,e.clientY); });
    window.addEventListener("mousemove", (e)=>{ if (joyActive) updateJoy(e.clientX,e.clientY); });
    window.addEventListener("mouseup", joyReset);
    joy.addEventListener("touchstart", (e)=>{ const t=e.touches[0]; if (t) joyStart(t.clientX,t.clientY); }, {passive:false});
    joy.addEventListener("touchmove", (e)=>{ const t=e.touches[0]; if (t) updateJoy(t.clientX,t.currentTarget?e.touches[0].clientY:e.touches[0].clientY); }, {passive:false});
    joy.addEventListener("touchend", joyReset);
  }

  // ===== Sockets =====
  socket.on("bootstrap", ({ you, players, hotspots, planets }) => {
    local.id = you.id; local.name = you.name; local.points = you.points||0;
    pointsEl.textContent = `Points: ${local.points}`;
    local.parts.group.position.set(you.x, you.y||0, you.z);
    local.yaw = you.ry || 0;
    updateNameTag(local, local.name || `Yogi-${local.id?.slice(0,4)}`);

    (hotspots||[]).forEach(h=>{
      if (h.name==="Totem") addHotspotDisk(h.name, h.x, h.z, h.r);
      else hotspotInfo.set(h.name, { pos:new THREE.Vector3(h.x,0,h.z), r:h.r });
    });
    (planets||[]).forEach(addPlanet);
    (players||[]).forEach(p=>{ const R = ensureRemote(p); updateNameTag(R, p.name || R.name); });
  });

  socket.on("player-joined", (p)=>{ if (p.id!==local.id){ const R = ensureRemote(p); updateNameTag(R, p.name || R.name); }});
  socket.on("player-left", (id)=>{ const R=remotes.get(id); if (R){ scene.remove(R.parts.group); remotes.delete(id);} });
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

  // ==== Emote'ler (farklı animasyonlar) ====
  const emoteTokens = new Map();
  function resetPose(parts){
    parts.armL.rotation.set(0,0,-Math.PI/8);
    parts.armR.rotation.set(0,0, Math.PI/8);
    parts.legL.rotation.set(0,0,0);
    parts.legR.rotation.set(0,0,0);
    parts.torso.rotation.set(0,0,0);
    parts.group.position.y = Math.max(0, parts.group.position.y);
  }
  function playEmote(parts, id, type, ms=1200){
    const baseColor = parts.torso.material.color.clone();
    const token = (emoteTokens.get(id) || 0) + 1;
    emoteTokens.set(id, token);
    const t0 = performance.now();

    function wave(t){
      const k = Math.sin((t-t0)/130);
      parts.armR.rotation.x = -0.6 + 0.4*Math.sin((t-t0)/90);
      parts.armR.rotation.z =  0.8 + 0.1*k;
      parts.torso.rotation.y =  0.1*k;
    }
    function dance(t){
      const k = Math.sin((t-t0)/160);
      parts.group.position.y += 0.001*Math.sin((t-t0)/120);
      parts.torso.rotation.z = 0.25*k;
      parts.armL.rotation.x = 0.6*k; parts.armR.rotation.x = -0.6*k;
    }
    function sit(t){
      parts.legL.rotation.x = -1.0; parts.legR.rotation.x = -1.0;
      parts.torso.rotation.x = -0.3;
      parts.group.position.y = Math.max(0.0, parts.group.position.y - 0.002);
    }
    function clap(t){
      const k = 0.6 + 0.6*Math.sin((t-t0)/90);
      parts.armL.rotation.x = 0.2; parts.armR.rotation.x = 0.2;
      parts.armL.rotation.y = 0.8*k; parts.armR.rotation.y = -0.8*k;
      parts.torso.rotation.y = 0.05*Math.sin((t-t0)/120);
    }
    function point(t){
      parts.armR.rotation.x = -1.2; parts.armR.rotation.y = 0.3;
      parts.torso.rotation.y = 0.15; parts.torso.rotation.x = -0.1;
    }
    function cheer(t){
      const k = Math.sin((t-t0)/110);
      parts.armL.rotation.x = -1.6; parts.armR.rotation.x = -1.6;
      parts.group.position.y += 0.0015*Math.max(0.0, k);
    }

    const fn = { wave, dance, sit, clap, point, cheer }[type] || dance;

    (function anim(){
      if (emoteTokens.get(id) !== token) { parts.torso.material.color.copy(baseColor); resetPose(parts); return; }
      const t = performance.now();
      const done = (t - t0) / ms;
      fn(t);
      parts.torso.material.color.lerp(new THREE.Color(0x66ccff), 0.15);
      if (done >= 1) { parts.torso.material.color.copy(baseColor); resetPose(parts); return; }
      requestAnimationFrame(anim);
    })();
  }

  socket.on("emote", ({ id, type, until }) => {
    const target = (id===local.id) ? { parts: local.parts } : remotes.get(id);
    if (!target) return;
    const p = document.createElement("p");
    p.innerHTML = `<i style="opacity:.8">[emote] ${getDisplayName(id)}: /${type}</i>`;
    chatLog.appendChild(p); chatLog.scrollTop = chatLog.scrollHeight;

    playEmote(target.parts, id, type, Math.max(700, Math.min(1600, (until ? (until - Date.now()) : 1200))));
  });

  socket.on("snapshot", ({ players }) => {
    (players||[]).forEach(p=>{
      if (p.id===local.id) return;
      const R = ensureRemote(p);
      R.parts.group.position.lerp(new THREE.Vector3(p.x, p.y||0, p.z), 0.2);
      if (typeof p.ry === "number") R.parts.group.rotation.y = THREE.MathUtils.lerp(R.parts.group.rotation.y, p.ry, 0.2);
      if (R.name !== p.name && p.name) updateNameTag(R, p.name);
    });
  });

  // ===== Movement + Flight Physics =====
  let last = performance.now();
  let netAcc = 0;
  const speedWalk = 3.2, speedRun = 6.0;
  const GRAVITY = -12.5;     // biraz güçlü yerçekimi
  const JET_FORCE = 18.0;    // space basılıyken yukarı itki
  const AIR_DAMP = 0.995;

  // Hotspot proximity
  function checkHotspots(){
    hotspotInfo.forEach((info, name)=>{
      if (local.visited[name]) return;
      const d = info.pos.distanceTo(local.parts.group.position);
      if (d <= info.r + 0.5) { local.visited[name]=true; socket.emit("hotspot:entered", { name }); }
    });
  }

  // Jet görsel güncelleme
  function updateJetVisual(active, t){
    const g = local.parts.flameGrp;
    if (!g) return;
    g.visible = active;
    if (active){
      const s = 0.9 + 0.12*Math.sin(t*25) + 0.05*Math.random();
      g.children[0].scale.setScalar(s);
      g.children[1].scale.setScalar(s*0.85);
      const light = g.children[2];
      light.intensity = 1.4 + 0.6*Math.sin(t*40);
    }
  }

  function tick(now){
    const dt = Math.min(0.05, (now-last)/1000); last = now;
    const t = clock.getElapsedTime();

    // Yön — W/S ileri-geri, A/D strafe (bakışa göre)
    const kForward = (keys.has("KeyW")?1:0) - (keys.has("KeyS")?1:0);
    const kStrafeKB  = (keys.has("KeyD")?1:0) - (keys.has("KeyA")?1:0); // D=+1, A=-1
    const kStrafe = kStrafeKB + joyVec.x;

    let forward = kForward + joyVec.y;
    let strafe  = kStrafe;
    forward = Math.max(-1, Math.min(1, forward));
    strafe  = Math.max(-1, Math.min(1, strafe));
    const mag = Math.hypot(strafe,forward) || 1;
    const spd = (keys.has("ShiftLeft") ? speedRun : speedWalk) * (mag>1 ? 1/mag : 1);

    if (forward || strafe) {
      const sin = Math.sin(local.yaw), cos = Math.cos(local.yaw);
      const dx = forward * sin - strafe * cos;  // A/D düzeltilmiş eksen
      const dz = forward * cos + strafe * sin;
      local.parts.group.position.x += dx * spd * dt;
      local.parts.group.position.z += dz * spd * dt;
    }

    // Jetpack fizik
    if (local.jet) {
      local.vy += JET_FORCE * dt;
    } else {
      local.vy += GRAVITY * dt;
    }
    local.vy *= AIR_DAMP;
    local.parts.group.position.y += local.vy * dt;

    // Zemine çarpma
    if (local.parts.group.position.y < 0) {
      local.parts.group.position.y = 0;
      if (local.vy < 0) local.vy = 0;
    }

    // Yaw uygula
    local.parts.group.rotation.y = local.yaw;

    // Kamera & zoom
    const camX = local.parts.group.position.x - Math.sin(local.yaw) * camDist;
    const camZ = local.parts.group.position.z - Math.cos(local.yaw) * camDist;
    const camY = 1.6 + Math.min(6, local.parts.group.position.y * 0.25);
    camera.position.lerp(new THREE.Vector3(camX, camY, camZ), 0.15);
    camera.lookAt(
      local.parts.group.position.x,
      local.parts.group.position.y + 0.8,
      local.parts.group.position.z
    );

    // Gezegenler (dönüş)
    for (const p of planetMeshes) p.mesh.rotation.y -= 0.0012;

    // Jet görseli
    updateJetVisual(local.jet, t);

    // Ağ
    netAcc += dt;
    if (netAcc > 0.08 && local.id) {
      netAcc = 0;
      socket.emit("state", {
        x: local.parts.group.position.x,
        y: local.parts.group.position.y,
        z: local.parts.group.position.z,
        ry: local.yaw
      });
    }

    checkHotspots();

    // Floor animate
    floor.update(clock.getElapsedTime(), camera);

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

  // Chat
  function sendChat(){ const t = chatText.value.trim(); if (!t) return; socket.emit("chat:send", { text:t }); chatText.value=""; }
  chatSend.addEventListener("click", sendChat);
  chatText.addEventListener("keydown", (e)=>{ if (e.key === "Enter") sendChat(); });
})();

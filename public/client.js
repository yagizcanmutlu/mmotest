/* global THREE, io */
(() => {
  // UI
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

  // THREE
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

  // Helpers
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

  // Stylized Character (parça referanslarıyla)
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

    const dome = new THREE.Mesh(
      new THREE.SphereGeometry(1.0, 24, 24),
      new THREE.MeshPhysicalMaterial({ color:0xffffff, specularColor:"black", ior:1, transparent:true, transmission:1, roughness:0, metalness:0, thickness:0.12, side:THREE.DoubleSide })
    );
    dome.position.set(0,1.6,0); grp.add(dome);

    grp.scale.set(0.20,0.20,0.20);
    return { group: grp, torso, head, armL, armR, legL, legR };
  }

  // Local/Remote
  const local = { id:null, name:null, yaw:0, parts:null, tag:null, points:0, visited:{} };
  {
    const parts = buildStylizedChar(0xffe4c4);
    local.parts = parts; scene.add(parts.group);
  }
  const remotes = new Map();
  function ensureRemote(p){
    let R = remotes.get(p.id);
    if (!R) {
      const parts = buildStylizedChar(0xadd8e6);
      parts.group.position.set(p.x, 0, p.z);
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

  // Hotspots & Planets (HALO YOK)
  const hotspotInfo = new Map();
  // === SpaceBase Disc + LED Ring (hotspot pad) ================================
  const _spaceBaseHotspotMeshes = new Map();

  // === SpaceBase Disc (FULL INSIDE FILL + LED RING, anti z-fighting) =========
  function _createSpaceBaseDiscMesh(radius, opts = {}) {
    const params = {
      tilesPerUnit: 2.9,
      groove: 0.03,
      bevel: 0.015,
      stripeDensity: 7.0,
      emissiveK: 1.35,
      caution: new THREE.Color("#ffd166"),
      baseColor: 0x1b2432,
      ringColor: 0x66ccff,
      ringInner: 0.86,   // LED iç yarıçapı (radius * ringInner)
      ringOuter: 1.02,   // LED dış yarıçapı
      fillGap: 0.000,    // disk ile LED arasında çok ince boşluk
      ...opts
    };

    // --- İç Disk ---
    const fillR = radius * (params.ringInner - params.fillGap); // neredeyse içi komple doldur
    const diskGeo = new THREE.CircleGeometry(fillR, 128);
    const diskMat = new THREE.MeshStandardMaterial({
      color: params.baseColor,
      roughness: 0.8,
      metalness: 0.2,
      polygonOffset: true,
      polygonOffsetFactor: -2,   // zeminin üstüne it
      polygonOffsetUnits: 2
    });

    diskMat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uTiles = { value: params.tilesPerUnit };
      shader.uniforms.uGroove = { value: params.groove };
      shader.uniforms.uBevel = { value: params.bevel };
      shader.uniforms.uStripeDensity = { value: params.stripeDensity };
      shader.uniforms.uEmissiveK = { value: params.emissiveK };
      shader.uniforms.uCaution = { value: params.caution };

      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `
          #include <common>
          varying vec3 vWPos;
        `)
        .replace('#include <worldpos_vertex>', `
          #include <worldpos_vertex>
          vWPos = worldPosition.xyz;
        `);

      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `
          #include <common>
          varying vec3 vWPos;
          uniform float uTime, uTiles, uGroove, uBevel, uStripeDensity, uEmissiveK;
          uniform vec3 uCaution;

          float hash21(vec2 p){
            p = fract(p*vec2(123.34,456.21));
            p += dot(p, p+45.32);
            return fract(p.x*p.y);
          }
          float grooveMask(vec2 p){
            vec2 gv = fract(p) - 0.5;
            vec2 dv = (0.5 - abs(gv));
            float edge = min(dv.x, dv.y);
            return 1.0 - smoothstep(uGroove-uBevel, uGroove+uBevel, edge);
          }
          float cautionStripes(vec2 p){
            vec2 cell = floor(p);
            vec2 gv = fract(p) - 0.5;
            float rnd = hash21(cell);
            if (rnd < 0.66) return 0.0;
            float dens = uStripeDensity + floor(rnd*3.0);
            float dir = (rnd>0.82)? 1.0 : -1.0;
            float ramp = (abs(gv.x)>abs(gv.y)) ? gv.y : gv.x;
            float s = fract(ramp*dens + (uTime*0.28)*dir);
            float bar = step(0.5, s);
            float edgeBand = smoothstep(0.12, 0.10, min(0.5-abs(gv.x), 0.5-abs(gv.y)));
            return bar * edgeBand;
          }
        `)
        .replace('#include <map_fragment>', `
          #include <map_fragment>
          vec2 p = vWPos.xz * uTiles;

          float g = grooveMask(p);
          diffuseColor.rgb *= (1.0 - g*0.18);

          float s = cautionStripes(p);
          float pulse = 0.6 + 0.4 * sin(uTime*3.0 + (p.x+p.y));
          vec3 emiss = uCaution * (s * uEmissiveK * pulse);

          diffuseColor.rgb = mix(diffuseColor.rgb, diffuseColor.rgb*0.75 + uCaution*0.25, s*0.85);
          diffuseColor.rgb += emiss;

          // Hafif merkez vinyet
          float r = length(p) * 0.02;
          diffuseColor.rgb *= (1.03 - 0.08 * smoothstep(0.0, 1.2, r));
        `);

      diskMat.userData._shader = shader;
    };

    const disk = new THREE.Mesh(diskGeo, diskMat);
    disk.rotation.x = -Math.PI/2;
    disk.position.y = 0.03;      // zeminin ÜSTÜNDE
    disk.receiveShadow = true;
    disk.renderOrder = 2;

    // --- LED Ring ---
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * params.ringInner, radius * params.ringOuter, 128),
      new THREE.MeshBasicMaterial({
        color: params.ringColor,
        transparent: true,
        opacity: 0.55,
        blending: THREE.AdditiveBlending,
        side: THREE.DoubleSide,
        depthWrite: false
      })
    );
    ring.rotation.x = -Math.PI/2;
    ring.position.y = 0.035;
    ring.renderOrder = 3;

    const group = new THREE.Group();
    group.add(disk, ring);

    group.onBeforeRender = () => {
      const t = performance.now()*0.001;
      const sh = disk.material.userData._shader;
      if (sh) sh.uniforms.uTime.value = t;
      ring.material.opacity = 0.35 + 0.35*(0.5+0.5*Math.sin(t*2.6));
    };

    return group;
  }

  function addHotspotDisk(name, x, z, r){
    // öncekini temizle
    const prev = _spaceBaseHotspotMeshes.get(name);
    if (prev) { scene.remove(prev); prev.traverse(o=>{
      if (o.isMesh){ o.geometry.dispose(); o.material.dispose?.(); }
    }); }

    const grp = _createSpaceBaseDiscMesh(r);
    grp.position.set(x, 0, z);
    scene.add(grp);

    _spaceBaseHotspotMeshes.set(name, grp);
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
    mesh.position.set(p.x, p.radius + 0.1, p.z);
    mesh.rotation.x = -Math.PI/10;
    mesh.castShadow = true; mesh.receiveShadow = true;

    const label = makeNameSprite(p.name, "#9ef");
    label.position.set(0, p.radius + 0.8, 0);
    mesh.add(label);

    scene.add(mesh);
    planetMeshes.push({ name:p.name, mesh, label });
    hotspotInfo.set(`Planet:${p.name}`, { pos:new THREE.Vector3(p.x,0,p.z), r:p.r || (p.radius + 10) });
  }

  // Input
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
    // Q = sola, E = sağa (mouse ile tutarlı)
    if (e.code === "KeyQ") local.yaw += 0.06;
    if (e.code === "KeyE") local.yaw -= 0.06;
  });
  window.addEventListener("keyup", (e)=> keys.delete(e.code));

  // Pointer-lock look (desktop) — mouse sola çevirince sola dönsün
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
      local.yaw -= e.movementX * 0.0025; // sağa hareket → sağa bakış
    }
  });

  // Drag look (sağ alan) — aynı yönde
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
  let camDist = 3.6;
  window.addEventListener("wheel", (e)=>{
    camDist += e.deltaY * 0.002;
    camDist = Math.min(10, Math.max(2, camDist));
  }, {passive:true});

  // Mobile joystick (solda) — SADECE MOBİL ve merkezde
  let joyActive = false, joyCenter = {x:0,y:0}, joyVec = {x:0,y:0};
  const stickHalf = () => (stick ? stick.getBoundingClientRect().width/2 : 0);
  function setStick(px,py){ if (!stick) return; stick.style.transform = `translate(${px - stickHalf()}px, ${py - stickHalf()}px)`; }
  function joyReset(){ joyActive=false; joyVec.x=0; joyVec.y=0; setStick(0,0); }
  if (isTouch && joy && stick){
    // başlangıçta tam merkez
    setTimeout(joyReset, 0);
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
    joy.addEventListener("touchmove", (e)=>{ const t=e.touches[0]; if (t) updateJoy(t.clientX,t.clientY); }, {passive:false});
    joy.addEventListener("touchend", joyReset);
  }

  // Sockets
  socket.on("bootstrap", ({ you, players, hotspots, planets }) => {
    // --- senin mevcut kullanıcı bootstrap'in ---
    local.id = you.id; 
    local.name = you.name; 
    local.points = you.points || 0;
    pointsEl.textContent = `Points: ${local.points}`;
    local.parts.group.position.set(you.x, 0, you.z);
    local.yaw = you.ry || 0;
    updateNameTag(local, local.name || `Yogi-${local.id?.slice(0,4)}`);

    // --- PAD yerleştirme (Totem filtresi yok) ---
    const PAD_KEYWORDS = ["totem","spawn","pad","platform","agora","hub","dock","deck"];
    let padCount = 0;

    (hotspots || []).forEach(h => {
      const name = h.name || "";
      const r = h.r || 12;
      const isPad = PAD_KEYWORDS.some(k => name.toLowerCase().includes(k));

      if (isPad) {
        addHotspotDisk(name, h.x, h.z, r);
        padCount++;
      }
      // hotspot tetik/puan mantığı için veriyi her durumda yaz
      hotspotInfo.set(name, { pos: new THREE.Vector3(h.x, 0, h.z), r });
    });

    // Sahne pad göndermediyse: oyuncunun spawn noktasına bir tane bırak
    if (padCount === 0) {
      const p = local.parts.group.position;
      addHotspotDisk("AgoraPad", p.x, p.z, 12);
    }

    // --- gezegenler & oyuncular ---
    (planets || []).forEach(addPlanet);
    (players || []).forEach(p => { 
      const R = ensureRemote(p); 
      updateNameTag(R, p.name || R.name); 
    });
  });

  socket.on("player-joined", (p) => { 
    if (p.id !== local.id){ 
      const R = ensureRemote(p); 
      updateNameTag(R, p.name || R.name); 
    }
  });

  socket.on("player-left", (id) => { 
    const R = remotes.get(id); 
    if (R){ scene.remove(R.parts.group); remotes.delete(id); } 
  });

  socket.on("player:name", ({id,name}) => {
    if (id === local.id){ 
      local.name = name; 
      updateNameTag(local, name); 
    }
    const R = remotes.get(id); 
    if (R) updateNameTag(R, name);
  });

  socket.on("chat:msg", ({ from, text }) => {
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

  socket.on("quest:update", ({code, progress, goal}) => 
    showToast(`Görev: ${code} ${progress}/${goal}`)
  );

  // ==== Emote animasyonları (farklı hareketler) ====
  const emoteTokens = new Map();
  function resetPose(parts){
    parts.armL.rotation.set(0,0,-Math.PI/8);
    parts.armR.rotation.set(0,0, Math.PI/8);
    parts.legL.rotation.set(0,0,0);
    parts.legR.rotation.set(0,0,0);
    parts.torso.rotation.set(0,0,0);
    parts.group.position.y = 0;
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
      parts.group.position.y = 0.08*Math.max(0, Math.sin((t-t0)/120));
      parts.torso.rotation.z = 0.25*k;
      parts.armL.rotation.x = 0.6*k; parts.armR.rotation.x = -0.6*k;
    }
    function sit(t){
      parts.legL.rotation.x = -1.0; parts.legR.rotation.x = -1.0;
      parts.torso.rotation.x = -0.3;
      parts.group.position.y = -0.2;
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
      parts.group.position.y = 0.10*Math.max(0, k);
    }

    const fn = {
      wave, dance, sit, clap, point, cheer
    }[type] || dance;

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
    // chat bildirimi
    const p = document.createElement("p");
    p.innerHTML = `<i style="opacity:.8">[emote] ${getDisplayName(id)}: /${type}</i>`;
    chatLog.appendChild(p); chatLog.scrollTop = chatLog.scrollHeight;

    playEmote(target.parts, id, type, Math.max(700, Math.min(1600, (until ? (until - Date.now()) : 1200))));
  });

  socket.on("snapshot", ({ players }) => {
    (players||[]).forEach(p=>{
      if (p.id===local.id) return;
      const R = ensureRemote(p);
      R.parts.group.position.lerp(new THREE.Vector3(p.x,0,p.z), 0.2);
      if (typeof p.ry === "number") R.parts.group.rotation.y = THREE.MathUtils.lerp(R.parts.group.rotation.y, p.ry, 0.2);
      if (R.name !== p.name && p.name) updateNameTag(R, p.name);
    });
  });

  // Loop
  let last = performance.now();
  let netAcc = 0;
  const speedWalk = 3.2, speedRun = 6;

  function checkHotspots(){
    hotspotInfo.forEach((info, name)=>{
      if (local.visited[name]) return;
      const d = info.pos.distanceTo(local.parts.group.position);
      if (d <= info.r + 0.5) { local.visited[name]=true; socket.emit("hotspot:entered", { name }); }
    });
  }

  function tick(now){
    const dt = Math.min(0.05, (now-last)/1000); last = now;

    // Yön — FARE NEREYE BAKIYORSA W O YÖNE
    const kForward = (keys.has("KeyW")?1:0) - (keys.has("KeyS")?1:0);
    const kStrafeKB  = (keys.has("KeyD")?1:0) - (keys.has("KeyA")?1:0); // D=+1 (sağ), A=-1 (sol)
    const kStrafe = kStrafeKB + joyVec.x;

    let forward = kForward + joyVec.y;
    let strafe  = kStrafe;
    forward = Math.max(-1, Math.min(1, forward));
    strafe  = Math.max(-1, Math.min(1, strafe));

    const mag = Math.hypot(strafe,forward) || 1;
    const spd = (keys.has("ShiftLeft") ? speedRun : speedWalk) * (mag>1 ? 1/mag : 1);

    if (forward || strafe) {
      // STRAFE işareti kullanıcı beklentisine göre düzeltildi:
      // dx = f*sin  - s*cos
      // dz = f*cos  + s*sin
      const sin = Math.sin(local.yaw), cos = Math.cos(local.yaw);
      const dx = forward * sin - strafe * cos;
      const dz = forward * cos + strafe * sin;
      local.parts.group.position.x += dx * spd * dt;
      local.parts.group.position.z += dz * spd * dt;
    }

    // Yaw uygula
    local.parts.group.rotation.y = local.yaw;

    // Kamera & zoom
    const camX = local.parts.group.position.x - Math.sin(local.yaw) * camDist;
    const camZ = local.parts.group.position.z - Math.cos(local.yaw) * camDist;
    camera.position.lerp(new THREE.Vector3(camX, 2.0, camZ), 0.15);
    camera.lookAt(local.parts.group.position.x, local.parts.group.position.y + 0.8, local.parts.group.position.z);

    // Gezegenler (halo yok)
    for (const p of planetMeshes) p.mesh.rotation.y -= 0.0012;

    // Ağ
    netAcc += dt;
    if (netAcc > 0.08 && local.id) {
      netAcc = 0;
      socket.emit("state", { x:local.parts.group.position.x, y:0, z:local.parts.group.position.z, ry: local.yaw });
    }

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

  // Chat
  function sendChat(){ const t = chatText.value.trim(); if (!t) return; socket.emit("chat:send", { text:t }); chatText.value=""; }
  chatSend.addEventListener("click", sendChat);
  chatText.addEventListener("keydown", (e)=>{ if (e.key === "Enter") sendChat(); });
})();

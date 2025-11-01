// client.js
import * as THREE from '/vendor/three/build/three.module.js';
import { GLTFLoader }  from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '/vendor/three/examples/jsm/loaders/DRACOLoader.js';

/* global io */
(() => {
  // ---------- UI ----------
  const root      = document.getElementById("root");
  const cta       = document.getElementById("cta");
  const playBtn   = document.getElementById("playBtn");
  const nameInput = document.getElementById("nameInput");
  const pointsEl  = document.getElementById("points");
  const chatLog   = document.getElementById("chatLog");
  const chatText  = document.getElementById("chatText");
  const chatSend  = document.getElementById("chatSend");
  const toast     = document.getElementById("toast");
  const joy       = document.getElementById("joystick");
  const stick     = document.getElementById("stick");
  const lookpad   = document.getElementById("lookpad");
  const hudGender = document.getElementById("hudGender"); // yoksa sorun olmaz

  // ---------- Gender seçimi (gender radios varsa onları, yoksa avatar radios fallback) ----------
  const genderRadios = document.querySelectorAll('input[name="gender"]');
  const avatarRadios = document.querySelectorAll('input[name="avatar"]');

  function detectGender() {
    const gr = [...genderRadios].find(r => r.checked);
    if (gr) return gr.value; // 'male' | 'female'
    const ar = [...avatarRadios].find(r => r.checked);
    if (ar) return (ar.value === '2') ? 'male' : 'female'; // Avatar 2 = erkek fallback
    return 'female';
  }
  let selectedGender = detectGender();
  [...genderRadios, ...avatarRadios].forEach(r =>
    r.addEventListener('change', () => { selectedGender = detectGender(); updateHUDGender(selectedGender); })
  );

  function updateHUDGender(g){
    if(!hudGender) return;
    const male = (g === 'male');
    hudGender.textContent = male ? '♂ Erkek' : '♀ Kadın';
    hudGender.classList.toggle('-male', male);
    hudGender.classList.toggle('-female', !male);
  }

  const socket = io();

  // ---------- Cihaz ----------
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (joy) joy.style.display = isTouch ? "block" : "none";

  // ---------- THREE ----------
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x090a14, 20, 120);

  const camera = new THREE.PerspectiveCamera(75, root.clientWidth / root.clientHeight, 0.1, 600);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0x87a8ff, 0x070712, 1.0);
  const dir  = new THREE.DirectionalLight(0x8fd0ff, 0.6);
  dir.position.set(6,10,4);
  dir.castShadow = true;
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
  scene.add(new THREE.Points(starGeom, new THREE.PointsMaterial({ size:0.6, color:0x8cbcff })));

  // ---------- Helpers ----------
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
    const mat = new THREE.SpriteMaterial({ map: tex, depthWrite:false, depthTest:false, transparent:true });
    const sp = new THREE.Sprite(mat);
    sp.renderOrder = 9999;
    sp.scale.set(w/90, h/90, 1);
    sp.position.set(0, 2.15, 0);
    return sp;
  }
  function showToast(text){ if(!toast) return; toast.textContent=text; toast.style.display="block"; setTimeout(()=>toast.style.display="none", 1500); }

  function enableShadows(root){
    root?.traverse?.(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
  }
  function disposeGroup(g){
    if (!g) return;
    g.traverse(o=>{
      if (o.isMesh){
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach(m=>m?.dispose?.());
        else o.material?.dispose?.();
      }
    });
  }
  function placeOnGround(obj, targetY = 0){
    const bbox = new THREE.Box3().setFromObject(obj);
    const minY = bbox.min.y;
    obj.position.y += (targetY - minY);
  }

  // ---------- GLTF/DRACO ----------
  let gltfLoader = null;
  let baseCharGLB = null;           // cyberpunk erkek
  let wantMaleGLB = false;          // erkek seçildiyse ve GLB henüz yoksa sonra swap

  try {
    gltfLoader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/vendor/three/examples/jsm/libs/draco/'); // sondaki / önemli
    gltfLoader.setDRACOLoader(draco);
  } catch (e) {
    console.warn('[Agora] GLTFLoader init başarısız:', e);
  }

  // Karakter GLB preload
  if (gltfLoader) {
    gltfLoader.load('/models/readyplayermale_cyberpunk.glb', (gltf)=>{
      baseCharGLB = gltf.scene;
      enableShadows(baseCharGLB);
      // Eğer kullanıcı erkek seçtiyse ve şu an stilize ise, GLB’ye geçir
      if (wantMaleGLB && local.parts && !local.parts.isGLB) swapLocalToGLB();
    }, undefined, (e)=>console.error('Karakter GLB preload hatası:', e));
  }

  // Araba (sahne dekoru) — *karakter GLB test spawn KALDIRILDI*
  if (gltfLoader) {
    gltfLoader.load('/models/cyberpunk_car.glb', (g) => {
      const car = g.scene;
      car.scale.setScalar(0.9);
      enableShadows(car);
      placeOnGround(car, 0);
      car.position.set(6, car.position.y, -6);
      car.rotation.y = Math.PI/6;
      scene.add(car);
    }, undefined, (err)=>{
      console.warn('Araba GLB yüklenemedi, placeholder konuyor:', err);
      const body = new THREE.Mesh(new THREE.BoxGeometry(2.4,0.6,5), new THREE.MeshStandardMaterial({metalness:.6, roughness:.4, color:0x223a5a}));
      const wheel = new THREE.Mesh(new THREE.CylinderGeometry(0.6,0.6,0.4,24), new THREE.MeshStandardMaterial({color:0x111111}));
      wheel.rotation.z = Math.PI/2;
      const car = new THREE.Group();
      car.add(body);
      [[1.2,-0.3, 2.0],[-1.2,-0.3, 2.0],[1.2,-0.3,-2.0],[-1.2,-0.3,-2.0]].forEach(p=>{ const w = wheel.clone(); w.position.set(...p); car.add(w); });
      placeOnGround(car, 0);
      car.position.set(6, car.position.y, -6);
      scene.add(car);
    });
  }

  // ---------- Karakter kurucuları ----------
  function buildPlayerFromGLB(name = "Player"){
    if (!baseCharGLB) {
      const dummy = new THREE.Group();
      const tag = makeNameSprite(name);
      dummy.add(tag);
      return { group: dummy, tag, isGLB:true, torso:{material:{color:new THREE.Color(0xffffff)}}, armL:null, armR:null, legL:null, legR:null };
    }
    const holder = new THREE.Group();
    const clone = baseCharGLB.clone(true);
    enableShadows(clone);

    // boy normalize ~1.75m ve zemine oturt
    const bbox = new THREE.Box3().setFromObject(clone);
    const height = Math.max(0.0001, bbox.max.y - bbox.min.y);
    const scale = 1.75 / height;
    clone.scale.setScalar(scale);
    placeOnGround(clone, 0);

    holder.add(clone);
    const tag = makeNameSprite(name);
    tag.position.y = 2.15;
    holder.add(tag);
    return { group: holder, tag, isGLB:true, torso:{material:{color:new THREE.Color(0xffffff)}}, armL:null, armR:null, legL:null, legR:null };
  }

  function buildStylizedChar(primaryColor = 0xffe4c4, accentColor = 0xffffff, opts={}){
    const scale = opts.scale ?? 0.20;
    const legH = opts.legH ?? 0.5;
    const legR = opts.legR ?? 0.18;

    const grp = new THREE.Group();

    const torso = new THREE.Mesh(
      new THREE.CapsuleGeometry(0.5, 0.7, 8, 16),
      new THREE.MeshStandardMaterial({ color: primaryColor, roughness:.85, metalness:.12 })
    );
    grp.add(torso);

    const legMat = new THREE.MeshStandardMaterial({ color: primaryColor, roughness:.85 });
    const legL = new THREE.Mesh(new THREE.CapsuleGeometry(legR, legH, 6, 12), legMat.clone());
    const legRMesh = legL.clone(); legL.position.set( 0.22,-1.0,0); legRMesh.position.set(-0.22,-1.0,0);
    grp.add(legL, legRMesh);

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
      new THREE.MeshPhysicalMaterial({ color:0xffffff, ior:1, transparent:true, transmission:1, roughness:0, metalness:0, thickness:0.12, side:THREE.DoubleSide })
    );
    dome.position.set(0,1.6,0); grp.add(dome);

    grp.scale.set(scale, scale, scale);
    return { group: grp, torso, head, armL, armR, legL, legR: legRMesh };
  }

  // ---------- Yerel & Uzak oyuncular ----------
  const local = { id:null, name:null, yaw:0, parts:null, tag:null, points:0, visited:{}, gender:'female', x:0, z:0 };
  { const parts = buildStylizedChar(0xffe4c4); local.parts = parts; scene.add(parts.group); }
  const remotes = new Map();

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

  function ensureRemote(p){
    let R = remotes.get(p.id);
    if (R) return R;

    let parts;
    if (p.gender === 'male' && baseCharGLB){
      parts = buildPlayerFromGLB(p.name || `Yogi-${String(p.id).slice(0,4)}`);
    } else {
      const isFemale = (p.gender !== 'male');
      const bodyCol = isFemale ? 0xffd7d0 : 0xadd8e6;
      const accent  = isFemale ? 0xff3a66 : 0xffffff;
      parts = buildStylizedChar(bodyCol, accent, { scale: 0.22, legH: 0.7, legR: 0.19 });
    }

    parts.group.position.set(p.x||0, 0, p.z||0);
    const tag = makeNameSprite(p.name || `Yogi-${String(p.id).slice(0,4)}`);
    parts.group.add(tag);

    R = { id: p.id, parts, tag, name: p.name || `Yogi-${String(p.id).slice(0,4)}`, gender: p.gender || 'female' };
    scene.add(parts.group);
    remotes.set(p.id, R);
    return R;
  }

  // --- Avatar swap ---
  function swapLocalToGLB(){
    if (!baseCharGLB) { wantMaleGLB = true; return; }
    if (local.parts?.isGLB) return;

    const pos = local.parts.group.position.clone();
    const yaw = local.parts.group.rotation.y;
    scene.remove(local.parts.group);
    disposeGroup(local.parts.group);

    const built = buildPlayerFromGLB(local.name || "You");
    local.parts = built;
    scene.add(built.group);
    built.group.position.copy(pos);
    built.group.rotation.y = yaw;
    if (local.name) updateNameTag(local, local.name);
  }

  function swapLocalAvatar(gender='female'){
    local.gender = gender;
    updateHUDGender(gender);

    // Erkek: GLB (varsa), yoksa stilize ve GLB gelince swap
    if (gender === 'male') {
      if (baseCharGLB) { swapLocalToGLB(); return; }
      wantMaleGLB = true;
    }

    // Kadın (veya erkek GLB henüz yok): stilize
    const prev = local.parts;
    const pos = prev?.group?.position?.clone?.() || new THREE.Vector3(local.x||0, 0, local.z||0);
    const yaw = local.yaw || 0;

    if (prev){ scene.remove(prev.group); disposeGroup(prev.group); }

    const isFemale = (gender === 'female');
    const bodyCol = isFemale ? 0xffd7d0 : 0xffe4c4;
    const accent  = isFemale ? 0xff3a66 : 0xffffff;

    const parts = buildStylizedChar(bodyCol, accent, { scale: 0.22, legH: 0.7, legR: 0.19 });
    local.parts = parts;
    scene.add(parts.group);
    parts.group.position.copy(pos);
    parts.group.rotation.y = yaw;
    if (local.name) updateNameTag(local, local.name);
  }

  // ---------- Hotspots & Planets ----------
  const hotspotInfo = new Map();
  const _spaceBaseHotspotMeshes = new Map();
  function _createSpaceBaseDiscMesh(radius, opts = {}) {
    const params = {
      tilesPerUnit: 2.8, groove: 0.03, bevel: 0.015, stripeDensity: 7.0, emissiveK: 1.35,
      caution: new THREE.Color("#ffd166"), baseColor: 0x131a24, ...opts
    };
    const mat = new THREE.MeshStandardMaterial({ color: params.baseColor, roughness: 0.95, metalness: 0.08 });
    mat.onBeforeCompile = (shader) => {
      shader.uniforms.uTime = { value: 0 };
      shader.uniforms.uTiles = { value: params.tilesPerUnit };
      shader.uniforms.uGroove = { value: params.groove };
      shader.uniforms.uBevel = { value: params.bevel };
      shader.uniforms.uStripeDensity = { value: params.stripeDensity };
      shader.uniforms.uEmissiveK = { value: params.emissiveK };
      shader.uniforms.uCaution = { value: params.caution };
      shader.vertexShader = shader.vertexShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;`)
        .replace('#include <worldpos_vertex>', `#include <worldpos_vertex>\nvec4 wp4 = modelMatrix * vec4( transformed, 1.0 );\n#ifdef USE_INSTANCING\nwp4 = instanceMatrix * wp4;\n#endif\nvWPos = wp4.xyz;`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <common>', `#include <common>\nvarying vec3 vWPos;\nuniform float uTime,uTiles,uGroove,uBevel,uStripeDensity,uEmissiveK;\nuniform vec3 uCaution;\nfloat hash21(vec2 p){p=fract(p*vec2(123.34,456.21));p+=dot(p,p+45.32);return fract(p.x*p.y);}float grooveMask(vec2 p){vec2 gv=fract(p)-0.5;vec2 dv=(0.5-abs(gv));float edge=min(dv.x,dv.y);return 1.0-smoothstep(uGroove-uBevel,uGroove+uBevel,edge);}float cautionStripes(vec2 p){vec2 cell=floor(p);vec2 gv=fract(p)-0.5;float rnd=hash21(cell);if(rnd<0.66)return 0.0;float dens=uStripeDensity+floor(rnd*3.0);float dir=(rnd>0.82)?1.0:-1.0;float ramp=(abs(gv.x)>abs(gv.y))?gv.y:gv.x;float s=fract(ramp*dens+(uTime*0.28)*dir);float bar=step(0.5,s);float edgeBand=smoothstep(0.12,0.10,min(0.5-abs(gv.x),0.5-abs(gv.y)));return bar*edgeBand;}`);
      shader.fragmentShader = shader.fragmentShader
        .replace('#include <map_fragment>', `#include <map_fragment>\nvec2 p=vWPos.xz*uTiles;float g=grooveMask(p);diffuseColor.rgb*= (1.0 - g*0.18);float s=cautionStripes(p);float pulse=0.6+0.4*sin(uTime*3.0+(p.x+p.y));vec3 emiss=uCaution*(s*uEmissiveK*pulse);diffuseColor.rgb=mix(diffuseColor.rgb,diffuseColor.rgb*0.75+uCaution*0.25,s*0.85);diffuseColor.rgb+=emiss;`);
      mat.userData._shader = shader;
    };
    const disc = new THREE.Mesh(new THREE.CircleGeometry(radius, 96), mat);
    disc.rotation.x = -Math.PI/2; disc.position.y = 0.01; disc.receiveShadow = true;
    const ring = new THREE.Mesh(new THREE.RingGeometry(radius*0.94, radius*1.02, 128),
      new THREE.MeshBasicMaterial({ color:0x66ccff, transparent:true, opacity:0.55, blending:THREE.AdditiveBlending, side:THREE.DoubleSide, depthWrite:false }));
    ring.rotation.x = -Math.PI/2; ring.position.y = 0.015;
    const group = new THREE.Group(); group.add(disc, ring);
    group.onBeforeRender = () => {
      const t = performance.now()*0.001;
      const sh = disc.material.userData._shader; if (sh) sh.uniforms.uTime.value = t;
      ring.material.opacity = 0.35 + 0.35*(0.5+0.5*Math.sin(t*2.6));
    };
    return group;
  }
  function addHotspotDisk(name, x, z, r){
    const prev = _spaceBaseHotspotMeshes.get(name);
    if (prev) { scene.remove(prev); prev.traverse(o=>{ if (o.isMesh){ o.geometry.dispose(); o.material.dispose?.(); } }); }
    const grp = _createSpaceBaseDiscMesh(r);
    grp.position.set(x, 0, z);
    scene.add(grp);
    _spaceBaseHotspotMeshes.set(name, grp);
    hotspotInfo.set(name, { pos:new THREE.Vector3(x,0,z), r });
  }

  const planetMeshes = [];
  const moonTex = new THREE.TextureLoader().load("https://happy358.github.io/Images/textures/lunar_color.jpg", t=>{ t.colorSpace = THREE.SRGBColorSpace; });
  const PLANET_SIZE_MUL = 1.8;
  function addPlanet(p){
    const R = (p.radius || 20) * (p.scale || PLANET_SIZE_MUL);
    const geo = new THREE.SphereGeometry(R, 48, 48);
    const mat = new THREE.MeshPhongMaterial({ color: p.color, map: moonTex, bumpMap: moonTex, bumpScale: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(p.x, R + 0.1, p.z);
    mesh.rotation.x = -Math.PI/10;
    mesh.castShadow = true; mesh.receiveShadow = true;
    const label = makeNameSprite(p.name, "#9ef"); label.position.set(0, R + 0.8, 0);
    mesh.add(label);
    scene.add(mesh);
    planetMeshes.push({ name: p.name, mesh, label, R });
    hotspotInfo.set(`Planet:${p.name}`, { pos: new THREE.Vector3(p.x, 0, p.z), r: (p.r ? p.r * (p.scale || PLANET_SIZE_MUL) : (R + 10)) });
  }

  // ---------- Input ----------
  const keys = new Set();
  let chatFocus = false;

  window.addEventListener("keydown", (e)=>{
    if (e.code === "Enter") {
      chatFocus = !chatFocus; if (chatFocus) chatText?.focus(); else chatText?.blur(); return;
    }
    if (chatFocus) return;
    keys.add(e.code);
    const em = { Digit1:"wave", Digit2:"dance", Digit3:"sit", Digit4:"clap", Digit5:"point", Digit6:"cheer" };
    if (em[e.code]) socket.emit("emote:play", em[e.code]);
    if (e.code === "KeyQ") local.yaw += 0.06;
    if (e.code === "KeyE") local.yaw -= 0.06;
  });
  window.addEventListener("keyup", (e)=> keys.delete(e.code));

  // Pointer-lock look
  if (playBtn) playBtn.addEventListener("click", () => {
    const desired = (nameInput?.value||"").trim().slice(0,20);
    if (desired) { local.name = desired; if (local.tag) updateNameTag(local, desired); }

    selectedGender = detectGender();
    swapLocalAvatar(selectedGender);          // erkekse GLB (varsa), değilse stilize
    socket.emit("profile:update", { name: desired || undefined, gender: selectedGender });
    socket.emit("join", { name: desired || undefined, gender: selectedGender });

    if (cta) cta.style.display = "none";
    renderer.domElement.requestPointerLock();
  });

  document.addEventListener("pointerlockchange", () => {
    if (!cta) return;
    if (document.pointerLockElement !== renderer.domElement) cta.style.display = "flex";
  });

  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === renderer.domElement && !chatFocus) {
      local.yaw -= e.movementX * 0.0025;
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
  let camDist = 3.6;
  window.addEventListener("wheel", (e)=>{
    camDist = Math.min(10, Math.max(2, camDist + e.deltaY * 0.002));
  }, {passive:true});

  // Mobile joystick
  let joyActive = false, joyCenter = {x:0,y:0}, joyVec = {x:0,y:0};
  const stickHalf = () => (stick ? stick.getBoundingClientRect().width/2 : 0);
  function setStick(px,py){ if (!stick) return; stick.style.transform = `translate(${px - stickHalf()}px, ${py - stickHalf()}px)`; }
  function joyReset(){ joyActive=false; joyVec.x=0; joyVec.y=0; setStick(0,0); }
  if (isTouch && joy && stick){
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

  // ---------- Sockets ----------
  socket.on("bootstrap", ({ you, players, hotspots, planets }) => {
    local.id = you.id;
    local.name = you.name;
    local.points = you.points || 0;
    pointsEl && (pointsEl.textContent = `Points: ${local.points}`);

    local.x = you.x; local.z = you.z; local.yaw = you.ry || 0;

    if (you.gender === 'female' || you.gender === 'male') {
      selectedGender = you.gender;
      updateHUDGender(selectedGender);
    }
    swapLocalAvatar(selectedGender);

    local.parts.group.position.set(local.x, 0, local.z);
    updateNameTag(local, local.name || `Yogi-${local.id?.slice(0,4)}`);

    const PAD_KEYWORDS = ["totem","spawn","pad","platform","agora","hub","dock","deck"];
    let padCount = 0;

    (hotspots || []).forEach(h => {
      const name = h.name || "";
      const r = h.r || 12;
      const isPad = PAD_KEYWORDS.some(k => name.toLowerCase().includes(k));
      if (isPad) { addHotspotDisk(name, h.x, h.z, r); padCount++; }
      hotspotInfo.set(name, { pos: new THREE.Vector3(h.x, 0, h.z), r });
    });

    if (padCount === 0) {
      const p = local.parts.group.position;
      addHotspotDisk("AgoraPad", p.x, p.z, 12);
    }

    (planets || []).forEach(addPlanet);
    (players || []).forEach(p => { if (p.id!==local.id){ const R = ensureRemote(p); updateNameTag(R, p.name || R.name); }});
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
    if (id === local.id){ local.name = name; updateNameTag(local, name); }
    const R = remotes.get(id); if (R) updateNameTag(R, name);
  });

  socket.on("chat:msg", ({ from, text }) => {
    if (!chatLog) return;
    const p = document.createElement("p");
    p.innerHTML = `<b>[${from.rank}] ${from.name}:</b> ${text}`;
    chatLog.appendChild(p);
    chatLog.scrollTop = chatLog.scrollHeight;
  });

  socket.on("points:update", ({ total, delta, reason }) => {
    local.points = total;
    pointsEl && (pointsEl.textContent = `Points: ${local.points}`);
    showToast(`${delta>0?'+':''}${delta}  ${reason}`);
  });

  socket.on("quest:update", ({code, progress, goal}) => showToast(`Görev: ${code} ${progress}/${goal}`));

  // Emote — GLB için güvenli (opsiyonel zincir)
  const emoteTokens = new Map();
  function resetPose(parts){
    parts.armL?.rotation?.set?.(0,0,-Math.PI/8);
    parts.armR?.rotation?.set?.(0,0, Math.PI/8);
    parts.legL?.rotation?.set?.(0,0,0);
    parts.legR?.rotation?.set?.(0,0,0);
    parts.torso?.rotation?.set?.(0,0,0);
    parts.group.position.y = 0;
  }
  function playEmote(parts, id, type, ms=1200){
    const baseColor = parts.torso?.material?.color?.clone?.() || new THREE.Color(0xffffff);
    const token = (emoteTokens.get(id) || 0) + 1; emoteTokens.set(id, token);
    const t0 = performance.now();
    const fns = {
      wave(t){ const k=Math.sin((t-t0)/130); parts.armR && (parts.armR.rotation.x=-0.6+0.4*Math.sin((t-t0)/90), parts.armR.rotation.z=0.8+0.1*k); parts.torso && (parts.torso.rotation.y=0.1*k); },
      dance(t){ const k=Math.sin((t-t0)/160); parts.group.position.y=0.08*Math.max(0,Math.sin((t-t0)/120)); parts.torso && (parts.torso.rotation.z=0.25*k); if (parts.armL){ parts.armL.rotation.x=0.6*k; } if (parts.armR){ parts.armR.rotation.x=-0.6*k; } },
      sit(){ if (parts.legL){ parts.legL.rotation.x=-1.0; } if (parts.legR){ parts.legR.rotation.x=-1.0; } parts.torso && (parts.torso.rotation.x=-0.3); parts.group.position.y=-0.2; },
      clap(t){ const k=0.6+0.6*Math.sin((t-t0)/90); if (parts.armL && parts.armR){ parts.armL.rotation.x=0.2; parts.armR.rotation.x=0.2; parts.armL.rotation.y=0.8*k; parts.armR.rotation.y=-0.8*k; } parts.torso && (parts.torso.rotation.y=0.05*Math.sin((t-t0)/120)); },
      point(){ if (parts.armR){ parts.armR.rotation.x=-1.2; parts.armR.rotation.y=0.3; } parts.torso && (parts.torso.rotation.y=0.15, parts.torso.rotation.x=-0.1); },
      cheer(t){ const k=Math.sin((t-t0)/110); if (parts.armL && parts.armR){ parts.armL.rotation.x=-1.6; parts.armR.rotation.x=-1.6; } parts.group.position.y=0.10*Math.max(0,k); }
    };
    const fn = fns[type] || fns.dance;
    (function anim(){
      if (emoteTokens.get(id) !== token) { parts.torso?.material?.color?.copy?.(baseColor); resetPose(parts); return; }
      const t = performance.now();
      fn(t);
      parts.torso?.material?.color?.lerp?.(new THREE.Color(0x66ccff), 0.15);
      if ((t - t0) >= ms) { parts.torso?.material?.color?.copy?.(baseColor); resetPose(parts); return; }
      requestAnimationFrame(anim);
    })();
  }

  socket.on("emote", ({ id, type, until }) => {
    const target = (id===local.id) ? { parts: local.parts } : remotes.get(id);
    if (!target) return;
    const p = document.createElement("p");
    p.innerHTML = `<i style="opacity:.8">[emote] ${getDisplayName(id)}: /${type}</i>`;
    chatLog?.appendChild(p); chatLog && (chatLog.scrollTop = chatLog.scrollHeight);
    playEmote(target.parts, id, type, Math.max(700, Math.min(1600, (until ? (until - Date.now()) : 1200))));
  });

  socket.on("snapshot", ({ players }) => {
    (players||[]).forEach(p=>{
      if (p.id===local.id) return;
      const R = ensureRemote(p);
      R.parts.group.position.lerp(new THREE.Vector3(p.x,0,p.z), 0.2);
      if (typeof p.ry === "number") R.parts.group.rotation.y = THREE.MathUtils.lerp(R.parts.group.rotation.y, p.ry, 0.2);
      if (R.name !== p.name && p.name) updateNameTag(R, p.name);

      // Uzak oyuncu gender değişimi
      if (p.gender && p.gender !== R.gender){
        const pos = R.parts.group.position.clone();
        const yaw = R.parts.group.rotation.y;
        scene.remove(R.parts.group); disposeGroup(R.parts.group);
        let parts;
        if (p.gender === 'male' && baseCharGLB) parts = buildPlayerFromGLB(R.name);
        else {
          const isFemale = (p.gender !== 'male');
          const bodyCol = isFemale ? 0xffd7d0 : 0xadd8e6;
          const accent  = isFemale ? 0xff3a66 : 0xffffff;
          parts = buildStylizedChar(bodyCol, accent, { scale: 0.22, legH: 0.7, legR: 0.19 });
        }
        parts.group.position.copy(pos);
        parts.group.rotation.y = yaw;
        parts.group.add(R.tag);
        scene.add(parts.group);
        R.parts = parts; R.gender = p.gender;
      }
    });
  });

  // ---------- Loop ----------
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

    // hareket
    const kForward = (keys.has("KeyW")?1:0) - (keys.has("KeyS")?1:0);
    const kStrafe  = (keys.has("KeyD")?1:0) - (keys.has("KeyA")?1:0);
    let forward = Math.max(-1, Math.min(1, kForward + (joyVec.y||0)));
    let strafe  = Math.max(-1, Math.min(1, kStrafe  + (joyVec.x||0)));

    const mag = Math.hypot(strafe,forward) || 1;
    const spd = (keys.has("ShiftLeft") ? speedRun : speedWalk) * (mag>1 ? 1/mag : 1);
    if (forward || strafe) {
      const sin = Math.sin(local.yaw), cos = Math.cos(local.yaw);
      local.parts.group.position.x += (forward * sin - strafe * cos) * spd * dt;
      local.parts.group.position.z += (forward * cos + strafe * sin) * spd * dt;
    }

    local.parts.group.rotation.y = local.yaw;

    // kamera
    const camX = local.parts.group.position.x - Math.sin(local.yaw) * camDist;
    const camZ = local.parts.group.position.z - Math.cos(local.yaw) * camDist;
    camera.position.lerp(new THREE.Vector3(camX, 2.0, camZ), 0.15);
    camera.lookAt(local.parts.group.position.x, local.parts.group.position.y + 0.8, local.parts.group.position.z);

    // gezegenler
    for (const p of planetMeshes) p.mesh.rotation.y -= 0.0012;

    // ağ güncellemesi
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

  // ---------- Resize ----------
  window.addEventListener("resize", ()=>{
    renderer.setSize(root.clientWidth, root.clientHeight);
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
  });

  // ---------- Chat ----------
  function sendChat(){ const t = chatText?.value.trim(); if (!t) return; socket.emit("chat:send", { text:t }); chatText.value=""; }
  chatSend?.addEventListener("click", sendChat);
  chatText?.addEventListener("keydown", (e)=>{ if (e.key === "Enter") sendChat(); });
})();

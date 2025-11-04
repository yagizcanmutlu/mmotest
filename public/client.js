// client.js
import * as THREE from '/vendor/three/build/three.module.js';
import { GLTFLoader }  from '/vendor/three/examples/jsm/loaders/GLTFLoader.js';
import { DRACOLoader } from '/vendor/three/examples/jsm/loaders/DRACOLoader.js';

/* global io */
(() => {
  // ⛔ client.js birden fazla kez çalışıyorsa hemen çık
  if (window.__AGORA_CLIENT_RUNNING__) {
    console.warn("[Agora] client already running — aborting duplicate init");
    return;
  }
  window.__AGORA_CLIENT_RUNNING__ = true;

  // UI
  const root     = document.getElementById("root");
  const cta      = document.getElementById("cta");
  const playBtn  = document.getElementById("playBtn");
  const nameInput= document.getElementById("nameInput");
  const pointsEl = document.getElementById("points");
  const chatLog  = document.getElementById("chatLog");
  const chatText = document.getElementById("chatText");
  const chatSend = document.getElementById("chatSend");
  const toast    = document.getElementById("toast");
  const joy      = document.getElementById("joystick");
  const stick    = document.getElementById("stick");
  const lookpad  = document.getElementById("lookpad");


    // 🔰 Global state (erken deklarasyon)
  const local = {
    id:null, name:null, yaw:0, parts:null, tag:null,
    points:0, visited:{}, x:0, z:0, gender:'unknown'
  };


    // Dünya sınırı (pad merkezine göre)
  let worldCenter = new THREE.Vector3(0, 0, 0);
  const WORLD_BOUNDS = {
    radius: 160,   // izin verilen yarıçap (metre)
    soft: 20       // kenarda “yumuşak bölge” (uayrı uyarı/fade için)
  };

    // === Dünya Sınırı Görseli (Kırmızı Ring) ===
  let boundaryRing = null;
  let SHOW_WORLD_RING = true;

  function ensureBoundaryRing(){
    if (!SHOW_WORLD_RING){
      if (boundaryRing) boundaryRing.visible = false;
      return;
    }
    // yoksa oluştur, varsa güncelle
    if (!boundaryRing){
      const geo = new THREE.RingGeometry(WORLD_BOUNDS.radius - 0.12, WORLD_BOUNDS.radius + 0.12, 128);
      const mat = new THREE.MeshBasicMaterial({
        color: 0xff3355, transparent: true, opacity: 0.55, depthWrite: false
      });
      boundaryRing = new THREE.Mesh(geo, mat);
      boundaryRing.rotation.x = -Math.PI/2;
      boundaryRing.position.set(worldCenter.x, 0.045, worldCenter.z);
      boundaryRing.renderOrder = 9998;
      scene.add(boundaryRing);
    } else {
      boundaryRing.visible = true;
      boundaryRing.position.set(worldCenter.x, 0.045, worldCenter.z);
      boundaryRing.geometry.dispose();
      boundaryRing.geometry = new THREE.RingGeometry(WORLD_BOUNDS.radius - 0.12, WORLD_BOUNDS.radius + 0.12, 128);
    }
  }


  // Kenarda oyuncuyu içeri çeken basit kelepçe (clamp).
  // Pozisyonu içeri “sınır çemberine” projeler ve 1..0 arası bir yavaşlatma katsayısı döner.
  function enforceWorldBounds(pos){
    const dx = pos.x - worldCenter.x;
    const dz = pos.z - worldCenter.z;
    const d  = Math.hypot(dx, dz);
    const R  = WORLD_BOUNDS.radius;
    if (d <= R) return 1;

    // Dışarı taşmış: konumu sınır çemberinin üzerine al
    const k = Math.max(0.0001, R / d);
    pos.x = worldCenter.x + dx * k;
    pos.z = worldCenter.z + dz * k;

    // Kenar bölgesindeki yavaşlatma (istersen hız ölçeği olarak da kullanabilirsin)
    const over = d - R;
    return Math.max(0, 1 - over / Math.max(1, WORLD_BOUNDS.soft));
  }


  // === CİNSİYET KALDIRILDI — yalnızca isim, wallet ve NFT ile giriş ===
  function startGameFromPayload(pl = {}) {
    const name   = (pl.playerName || '').trim() || 'Player';
    const gender = pl.gender || 'unknown';
    const wallet = pl.wallet || null;
    const nft    = pl.nft || null;

    local.gender = gender;
    if (name) {
      if (local?.parts?.group) updateNameTag(local, name);
      else local._pendingName = name; // ⬅ etiket beklesin
    }

    socket.emit("profile:update", { name, gender, wallet, nft });
    socket.emit("join",           { name, gender, wallet, nft });

    if (cta) cta.style.display = "none";
    try { renderer.domElement.requestPointerLock(); } catch(e){}

    window.__AGORA_SELECTED_NFT__ = nft || null;
  }



  // 1) index.html'den gelen event ile başlat
  window.addEventListener('agoraInit', (e) => {
    const pl = e?.detail || {};
    window.agoraInjectedPayload = pl;     // cache
    startGameFromPayload(pl);
  });

  // 2) Fallback: Her ihtimale karşı, event gelmezse "Giriş" click'i lokal payload kurup başlatsın
  if (playBtn) playBtn.addEventListener('click', () => {
    // Eğer index.html zaten agoraInit yolladıysa, burada tekrar başlatma.
    if (window.agoraInjectedPayload) return;

    const desiredName = (nameInput?.value || '').trim().slice(0, 20) || 'Player';
    // Formda gender kaldırıldıysa 'unknown' ya da 'male' ver; varsa radio’dan oku:
    const genderInput = document.querySelector('input[name="gender"]:checked');
    const gender = (genderInput?.value) || 'unknown';

    const pl = {
      playerName: desiredName,
      gender,
      wallet: window.walletFromHost || null,
      nft: window.selectedNFT || null   // index.html bu değişkenleri set ediyorsa
    };

    window.agoraInjectedPayload = pl;
    console.log('[fallback] payload:', pl);
    startGameFromPayload(pl);
  });

    // === Alioba avatar (tek GLB, çoklu klip) entegrasyonu ===
  let avatarGLB = null;         // sahnedeki gerçek GLB kökü
  let mixer = null;             // AnimationMixer
  let actions = {};             // { walk, run, dance, clap, idle, ... }
  let currentAction = null;     // aktif action
  let currentActionName = null;
  let usingGLBAvatar = false;

  function normClipName(name='') {
    const s = name.toLowerCase();
    if (s.includes('idle') || s.includes('stand')) return 'idle';
    if (s.includes('back') && s.includes('run'))  return 'runBack';
    if (s.includes('run'))                        return 'run';
    if (s.includes('walk'))                       return 'walk';
    if (s.includes('hip_hop') || s.includes('dance')) return 'dance';
    if (s.includes('clap'))                       return 'clap';
    return name.replace(/\s+/g,'_').toLowerCase();
  }

  function buildActionsFromClips(root, clips=[]) {
    mixer = new THREE.AnimationMixer(root);
    actions = {}; currentAction = null; currentActionName = null;

    clips.forEach((clip) => {
      const name = normClipName(clip.name || '');
      const act  = mixer.clipAction(clip);
      act.clampWhenFinished = false;
      act.loop = THREE.LoopRepeat;
      actions[name] = act;
    });

    // Idle yoksa, yürüyüşü düşük hızda "idle" gibi kullan
    if (!actions.idle && actions.walk) {
      actions.idle = actions.walk;
      actions.idle.timeScale = 0.35;
    }
  }

  function playAction(name, fade=0.18, speed=1.0) {
    const next = actions[name];
    if (!next) return;
    next.enabled = true;
    next.timeScale = speed;
    next.reset();

    if (currentAction && currentAction !== next) {
      currentAction.crossFadeTo(next, fade, false);
      next.play();
    } else if (!currentAction) {
      next.play();
    }
    currentAction = next;
    currentActionName = name;
  }

  function installAvatarRoot(root, targetHeight=1.75) {
    // Ölçek/pivot düzelt
    root.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
    const bb = new THREE.Box3().setFromObject(root);
    const size = bb.getSize(new THREE.Vector3());
    const s = targetHeight / Math.max(size.y, 1e-6);
    root.scale.setScalar(s);
    const bb2 = new THREE.Box3().setFromObject(root);
    root.position.y += -bb2.min.y + 0.02;

    // Eski stylized karakteri kaldır ve local.parts.group = root olacak şekilde devret
    if (local?.parts?.group) scene.remove(local.parts.group);

    // Oyuncu objesi olarak root'u kullan
    local.parts = { group: root };
    scene.add(root);
    usingGLBAvatar = true;
  }

  function swapLocalAvatarFromGLB(url) {
    if (!gltfLoader) return;
    gltfLoader.load(url, (gltf) => {
      avatarGLB && scene.remove(avatarGLB);   // önceki varsa kaldır
      avatarGLB = gltf.scene;

      // Hedef boyu m cinsinden ver (1.30–1.45 iyi aralık)
      const ALIOBA_TARGET_HEIGHT = 0.30;
      installAvatarRoot(avatarGLB, ALIOBA_TARGET_HEIGHT);

      buildActionsFromClips(avatarGLB, gltf.animations || []);


      // başlangıç animasyonu
      if (actions.idle) playAction('idle', 0.12, 1.0);
      else if (actions.walk) playAction('walk', 0.12, 0.6);
    }, undefined, (err) => {
      console.error('[Alioba] GLB load error:', err);
    });
  }


  // === Registry & Collisions ===
  const npcRegistry = new Map();             // key -> THREE.Group (root)
  const colliders  = [];                     // { key, root, r, padding }
  const PLAYER_RADIUS = 0.45;
  let COLLISION_ENABLED = true;

  const DEBUG_COLLIDERS = true;              // görünmez duvar teşhisi için
  const MAX_COLLIDER_RADIUS = 12;
  let colliderDebug = null;

  const zoneDebug = new THREE.Group(); // sahneye ekleme YOK
  zoneDebug.visible = false; // başlangıçta kapalı

  function toggleBoundaryDebug() {
    if (!zoneDebug) return;
    zoneDebug.visible = !zoneDebug.visible;
    showToast(zoneDebug.visible ? 'Sınır çizgileri: AÇIK' : 'Sınır çizgileri: KAPALI');
  }



    // ======= AŞAMA: MERDİVEN/DUVAR SİSTEMİ =======
  const AABB_WALLS = [];   // {name,minX,maxX,minZ,maxZ,yMin,yMax}
  const HEIGHT_ZONES = []; // {name,minX,maxX,minZ,maxZ,y0,y1,axis} axis: 'x' | 'z' | null

  function addWallRect(name, x1, z1, x2, z2, yMin=-1, yMax=3){
    const minX = Math.min(x1,x2), maxX = Math.max(x1,x2);
    const minZ = Math.min(z1,z2), maxZ = Math.max(z1,z2);
    AABB_WALLS.push({ name, minX, maxX, minZ, maxZ, yMin, yMax });
    // debug çizgisi
    if (DEBUG_COLLIDERS){
      const g = new THREE.BufferGeometry().setFromPoints([
        new THREE.Vector3(minX,0.05,minZ), new THREE.Vector3(maxX,0.05,minZ),
        new THREE.Vector3(maxX,0.05,minZ), new THREE.Vector3(maxX,0.05,maxZ),
        new THREE.Vector3(maxX,0.05,maxZ), new THREE.Vector3(minX,0.05,maxZ),
        new THREE.Vector3(minX,0.05,maxZ), new THREE.Vector3(minX,0.05,minZ),
      ]);
      const m = new THREE.LineBasicMaterial({ color: 0xff3a66, transparent:true, opacity:0.8 });
      zoneDebug.add(new THREE.LineSegments(g, m));
    }
  }

  function addHeightZoneRect(name, x1, z1, x2, z2, y0=0, y1=1, axis=null){
    const minX = Math.min(x1,x2), maxX = Math.max(x1,x2);
    const minZ = Math.min(z1,z2), maxZ = Math.max(z1,z2);
    HEIGHT_ZONES.push({ name, minX, maxX, minZ, maxZ, y0, y1, axis });
    // debug dolgusu
    if (DEBUG_COLLIDERS){
      const geo = new THREE.PlaneGeometry(maxX-minX, maxZ-minZ);
      const mat = new THREE.MeshBasicMaterial({ color:0x33ffaa, transparent:true, opacity:0.18, side:THREE.DoubleSide });
      const mesh = new THREE.Mesh(geo, mat);
      mesh.rotation.x = -Math.PI/2;
      mesh.position.set((minX+maxX)/2, 0.02, (minZ+maxZ)/2);
      zoneDebug.add(mesh);
    }
  }

  function insideRect(x,z, r){
    return (x >= r.minX && x <= r.maxX && z >= r.minZ && z <= r.maxZ);
  }

  // Yükseklik hedefi (merdiven/ramp/saha)
  function targetYAt(x,z){
    let bestY = 0;
    for (const h of HEIGHT_ZONES){
      if (!insideRect(x,z,h)) continue;
      if (!h.axis){ bestY = Math.max(bestY, h.y1); continue; }
      // eğim: dikdörtgen boyunca 0→1
      if (h.axis === 'z'){
        const t = (z - h.minZ) / Math.max(1e-6, (h.maxZ - h.minZ));
        bestY = Math.max(bestY, h.y0 + t*(h.y1 - h.y0));
      } else {
        const t = (x - h.minX) / Math.max(1e-6, (h.maxX - h.minX));
        bestY = Math.max(bestY, h.y0 + t*(h.y1 - h.y0));
      }
    }
    return bestY;
  }

  // Dikdörtgen duvar çarpışması (XZ)
  function collidesRectAt(nx, nz, py){
    for (const r of AABB_WALLS){
      if (py < r.yMin || py > r.yMax) continue;
      if (nx >= r.minX && nx <= r.maxX && nz >= r.minZ && nz <= r.maxZ) return true;
    }
    return false;
  }






  // === GROUND CONFIG ===
  const GROUND_MODE = "custom"; // "custom" | "mars"
  const GROUND_CUSTOM_URL  = "/textures/floor.webp";
  const GROUND_CUSTOM_REPEAT = 18;
  const GROUND_NORMAL_URL  = "https://cdn.prod.website-files.com/67fb1cd83af51c4fe96dacb2/69057eed2a91dc8d9d0f1bdc_floor.webp";
  const GROUND_MARS_URL    = "https://raw.githubusercontent.com/pmndrs/drei-assets/master/textures/planets/mars_albedo.jpg";
  const GROUND_MARS_NORMAL = "https://raw.githubusercontent.com/pmndrs/drei-assets/master/textures/planets/mars_normal.jpg";
  const GROUND_MARS_REPEAT = 22;

  const SHOW_PADS = false;

  const socket = io();
  const isTouch = ('ontouchstart' in window) || (navigator.maxTouchPoints > 0);
  if (joy) joy.style.display = isTouch ? "block" : "none";

  // THREE renderer/scene/camera
  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.clippingPlanes = [];
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.add(zoneDebug);

  scene.fog = new THREE.Fog(0x090a14, 20, 120);
  colliderDebug = new THREE.Group();
  scene.add(colliderDebug);

  const camera = new THREE.PerspectiveCamera(75, root.clientWidth / root.clientHeight, 0.1, 600);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0x87a8ff, 0x070712, 1.0);
  const dir  = new THREE.DirectionalLight(0x8fd0ff, 0.6);
  dir.castShadow = true;
  dir.shadow.bias = -0.0003;
  dir.shadow.normalBias = 0.02;
  dir.position.set(6,10,4);
  scene.add(hemi, dir);

  // Ground (textured)
  const tLoader = new THREE.TextureLoader();
  const maxAniso = renderer.capabilities.getMaxAnisotropy();

  function loadTiledTexture(url, repeat=12){
    const tex = tLoader.load(url, t => {
      t.colorSpace = THREE.SRGBColorSpace;
      t.generateMipmaps = true;
      t.anisotropy = maxAniso;
      t.wrapS = t.wrapT = THREE.RepeatWrapping;
      t.minFilter = THREE.LinearMipmapLinearFilter;
      t.magFilter = THREE.LinearFilter;
      t.needsUpdate = true;
    });
    tex.repeat.set(repeat, repeat);
    return tex;
  }

  let baseURL, normalURL, rep;
  if (GROUND_MODE === "mars") {
    baseURL = GROUND_MARS_URL; normalURL = GROUND_MARS_NORMAL; rep = GROUND_MARS_REPEAT;
  } else {
    baseURL = GROUND_CUSTOM_URL; normalURL = GROUND_NORMAL_URL || null; rep = GROUND_CUSTOM_REPEAT;
  }

  const groundMap = loadTiledTexture(baseURL, rep);
  const groundNormal = normalURL ? loadTiledTexture(normalURL, rep) : null;

  const groundMat = new THREE.MeshStandardMaterial({
    map: groundMap,
    normalMap: groundNormal || undefined,
    roughness: 1.0,
    metalness: 0.0
  });

  const ground = new THREE.Mesh(new THREE.PlaneGeometry(1200, 1200, 1, 1), groundMat);
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

  scene.fog = new THREE.Fog(0x05060a, 8, 140);
  stars.material.size = 0.45;

  // === PERF LOGGER ===
  let _fpsEWMA = 0, _fpsLast = performance.now();
  setInterval(() => {
    const ri = renderer.info;
    console.log(
      `[perf] fps≈${_fpsEWMA.toFixed(0)}  calls=${ri.render.calls}  tris=${ri.render.triangles}  tex=${ri.memory.textures}  geo=${ri.memory.geometries}`
    );
  }, 2000);

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
  function showToast(text){
    if(!toast) return;
    toast.textContent=text; toast.style.display="block";
    setTimeout(()=>toast.style.display="none", 1500);
  }

  // GLTF/DRACO loader
  let gltfLoader = null;
  try {
    gltfLoader = new GLTFLoader();
    const draco = new DRACOLoader();
    draco.setDecoderPath('/vendor/three/examples/jsm/libs/draco/');
    gltfLoader.setDRACOLoader(draco);
  } catch (e) {
    console.warn('[Agora] GLTFLoader init başarısız. GLB kapalı:', e);
    gltfLoader = null;
  }

  // ---- Dinamik Yükleme Sistemi (Yakınlaşınca yükle) ----
  const lazyPacks = [];
  const UNLOAD_HYSTERESIS = 8; // metre

  function registerLazyPack({ name, x, z, url, dist = 35, unload = true }) {
    lazyPacks.push({ name, x, z, url, dist, unload, loaded:false, loading:false, failed:false, root:null });
  }
  function _loadPack(pack){
    if (pack.loading || pack.loaded || !gltfLoader || !pack.url) return;
    pack.loading = true;
    gltfLoader.load(pack.url, (gltf) => {
      const root = gltf.scene || gltf.scenes?.[0];
      if (root) {
        root.traverse(o => { if (o.isMesh){ o.castShadow = true; o.receiveShadow = true; } });
        root.position.set(pack.x, 0, pack.z);
        scene.add(root);
        pack.root = root;
        pack.loaded = true;
        console.log('[lazy] yüklendi:', pack.name);
      }
      pack.loading = false;
    }, undefined, (err) => {
      console.warn('[lazy] yüklenemedi:', pack.name, err);
      pack.loading = false; pack.failed = true;
    });
  }
  function _disposeObject3D(obj){
    obj.traverse(o=>{
      if (o.isMesh){
        o.geometry?.dispose?.();
        if (Array.isArray(o.material)) o.material.forEach(m=>m.dispose?.());
        else o.material?.dispose?.();
      }
      if (o.isTexture) o.dispose?.();
    });
  }
  function _unloadPack(pack){
    if (!pack.loaded || !pack.root) return;
    scene.remove(pack.root);
    _disposeObject3D(pack.root);
    pack.root = null;
    pack.loaded = false;
    console.log('[lazy] boşaltıldı:', pack.name);
  }
  function updateLazyPacks(px, pz){
    for (const pack of lazyPacks){
      const d = Math.hypot(pack.x - px, pack.z - pz);
      if (d <= pack.dist && !pack.loaded && !pack.failed) _loadPack(pack);
      else if (d >= pack.dist + UNLOAD_HYSTERESIS && pack.loaded && pack.unload) _unloadPack(pack);
    }
  }
  window.AGORALazy = { register: registerLazyPack, packs: lazyPacks };

  // ---- Hotspots / Pads helpers ----
  const hotspotInfo = new Map();
  const _spaceBaseHotspotMeshes = new Map();

  function getAnyPadCenter() {
    const h = hotspotInfo.get('AgoraPad');
    if (h) return h.pos.clone();

    if (_spaceBaseHotspotMeshes.has('AgoraPad'))
      return _spaceBaseHotspotMeshes.get('AgoraPad').position.clone();

    for (const [, grp] of _spaceBaseHotspotMeshes) return grp.position.clone();
    return (window.local?.parts?.group?.position?.clone?.() || new THREE.Vector3(0,0,0));
  }

  // ---- NPC yardımcıları ----
  const _spawnedNPC = new Set();

  function computeColliderInfo(root, padding = 0.30) {
    const THIN_Y = 0.08;
    const IGNORE_NAMES = ["floor", "ground", "shadow", "plane", "grid"];

    let minX=+Infinity, maxX=-Infinity, minZ=+Infinity, maxZ=-Infinity;
    let usedAny = false;

    root.updateMatrixWorld(true);
    root.traverse(o => {
      if (!o.isMesh) return;
      const name = (o.name || "").toLowerCase();
      if (IGNORE_NAMES.some(s => name.includes(s))) return;

      if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
      const bb = o.geometry.boundingBox.clone().applyMatrix4(o.matrixWorld);
      const hY = bb.max.y - bb.min.y;

      if (hY < THIN_Y && (bb.max.x - bb.min.x > 3 || bb.max.z - bb.min.z > 3)) return;

      usedAny = true;
      minX = Math.min(minX, bb.min.x);
      maxX = Math.max(maxX, bb.max.x);
      minZ = Math.min(minZ, bb.min.z);
      maxZ = Math.max(maxZ, bb.max.z);
    });

    if (!usedAny) {
      const bb = new THREE.Box3().setFromObject(root);
      const size = bb.getSize(new THREE.Vector3());
      const cx = (bb.min.x + bb.max.x) * 0.5;
      const cz = (bb.min.z + bb.max.z) * 0.5;
      const r  = 0.5 * Math.hypot(size.x, size.z) + padding;
      return { offX: cx - root.position.x, offZ: cz - root.position.z, r: Math.min(r, MAX_COLLIDER_RADIUS) };
    }

    const cx = (minX + maxX) * 0.5;
    const cz = (minZ + maxZ) * 0.5;
    const halfX = (maxX - minX) * 0.5;
    const halfZ = (maxZ - minZ) * 0.5;
    const r = Math.hypot(halfX, halfZ) + padding;

    return { offX: cx - root.position.x, offZ: cz - root.position.z, r: Math.min(r, MAX_COLLIDER_RADIUS) };
  }

  function ensureDebugRing(forCollider) {
    if (!DEBUG_COLLIDERS) return;
    if (forCollider._ring) return;

    const seg = 64, inner = forCollider.r - 0.05, outer = forCollider.r + 0.05;
    const geo = new THREE.RingGeometry(inner, outer, seg);
    const mat = new THREE.MeshBasicMaterial({ color: 0xff3a66, transparent: true, opacity: 0.45, depthWrite:false });
    const ring = new THREE.Mesh(geo, mat);
    ring.rotation.x = -Math.PI/2;
    colliderDebug.add(ring);
    forCollider._ring = ring;
  }

  function syncDebugRing(forCollider) {
    if (!DEBUG_COLLIDERS || !forCollider._ring) return;
    const cx = (forCollider.root?.position.x || 0) + (forCollider.offX || 0);
    const cz = (forCollider.root?.position.z || 0) + (forCollider.offZ || 0);
    forCollider._ring.position.set(cx, 0.02, cz);
    forCollider._ring.geometry.dispose();
    forCollider._ring.geometry = new THREE.RingGeometry(forCollider.r - 0.05, forCollider.r + 0.05, 64);
  }

  function spawnNPC(url, {
    onPad = false,
    offset = { x:0, z:0 },
    targetHeight = null,
    targetDiag   = null,
    x=0, z=0, y=0, ry=0, scale=null, name=null,
    collision = true,
    colliderPadding = 0.30
  } = {}) {
    if (!gltfLoader) { console.warn('GLTFLoader yok, NPC yüklenemez:', url); return; }

    const dedupKey = `${url}|${name||""}`;
    if (_spawnedNPC.has(dedupKey)) return;
    _spawnedNPC.add(dedupKey);

    gltfLoader.load(url, (gltf) => {
      const model = gltf.scene || gltf.scenes?.[0];
      if (!model) { console.warn('GLB sahnesi boş:', url); return; }

      model.traverse(o => {
        if (!o.isMesh) return;
        o.castShadow = o.receiveShadow = true;
        if (!o.geometry.boundingBox) o.geometry.computeBoundingBox();
        const bb = o.geometry.boundingBox;
        const diag = bb.max.clone().sub(bb.min).length();
        if (diag < 0.02) o.visible = false;
      });

      // pivot & scale
      const bb0 = new THREE.Box3().setFromObject(model);
      const c0  = bb0.getCenter(new THREE.Vector3());
      model.position.x -= c0.x;
      model.position.z -= c0.z;

      if (targetHeight || targetDiag) {
        const bbA = new THREE.Box3().setFromObject(model);
        const size = bbA.getSize(new THREE.Vector3());
        const height = size.y;
        const diag   = size.length();
        const s = targetHeight
          ? (targetHeight / Math.max(height,1e-6))
          : (targetDiag   / Math.max(diag,1e-6));
        model.scale.setScalar(s);
      } else if (scale != null) {
        model.scale.setScalar(scale);
      }

      // ayaklar zemine
      const bb1 = new THREE.Box3().setFromObject(model);
      model.position.y += -bb1.min.y + 0.02;

      const root = new THREE.Group();
      root.add(model);

      if (name) {
        const bb2 = new THREE.Box3().setFromObject(model);
        const h   = bb2.getSize(new THREE.Vector3()).y;
        const tag = makeNameSprite(name);
        tag.position.y = h + 0.4;
        root.add(tag);
      }

      let pos = onPad ? getAnyPadCenter() : new THREE.Vector3(x,0,z);
      pos.x += offset.x || 0;
      pos.z += offset.z || 0;
      root.position.copy(pos);
      root.position.y = y;
      root.rotation.y = ry;

      scene.add(root);
      console.log('[NPC]', url, 'spawn @', root.position);

      // ==== KAYIT ====
      const regKey = name || url;
      npcRegistry.set(regKey, root);

      // ==== COLLIDER (XZ dairesel) ====
      if (collision) {
        const info = computeColliderInfo(root, colliderPadding);
        const col = { key: regKey, root, r: info.r, padding: colliderPadding, offX: info.offX, offZ: info.offZ };
        colliders.push(col);
        ensureDebugRing(col);
      }

    }, undefined, (err) => {
      console.error('NPC yüklenemedi:', url, err);
    });
  }

  function getNPC(key){ return npcRegistry.get(key) || null; }
  function removeNPC(key){
    const root = npcRegistry.get(key);
    if(!root) return false;
    scene.remove(root);
    npcRegistry.delete(key);
    const i = colliders.findIndex(c => c.key === key);
    if (i >= 0) colliders.splice(i,1);
    return true;
  }
  function setNPCPosition(key, x, z, y=0){
    const root = npcRegistry.get(key);
    if (!root) return;
    root.position.set(x, y, z);
  }

  // Çarpışma fonksiyonları

    // Tek bir NPC için collider aç/kapat
  function setCollisionEnabledFor(key, enabled, padding = 0.30){
    const idx = colliders.findIndex(c => c.key === key);
    if (enabled) {
      if (idx !== -1) return;                 // zaten var
      const root = npcRegistry.get(key);
      if (!root) return;
      const info = computeColliderInfo(root, padding);
      const col = { key, root, r: info.r, padding, offX: info.offX, offZ: info.offZ };
      colliders.push(col);
      ensureDebugRing(col);                   // DEBUG_COLLIDERS true ise halka çizer
    } else {
      if (idx !== -1) {
        const c = colliders[idx];
        if (c._ring) colliderDebug.remove(c._ring);
        colliders.splice(idx, 1);
      }
    }
  }

  function collidesAt(nx, nz){
    for (const c of colliders){
      const cx = (c.root?.position.x ?? c.x) + (c.offX || 0);
      const cz = (c.root?.position.z ?? c.z) + (c.offZ || 0);
      const rr = (c.r || 1) + PLAYER_RADIUS;
      const dx = nx - cx, dz = nz - cz;
      if (dx*dx + dz*dz < rr*rr) return true;
      // Duvar dikdörtgenleri
      if (collidesRectAt(nx, nz, local.parts.group.position.y)) return true;
    }
    return false;
  }
  
  function pushOutFromColliders(pos){
    let px = pos.x, pz = pos.z;
    for (const c of colliders){
      const cx = (c.root?.position.x ?? c.x) + (c.offX || 0);
      const cz = (c.root?.position.z ?? c.z) + (c.offZ || 0);
      const rr = (c.r || 1) + PLAYER_RADIUS;
      const dx = px - cx, dz = pz - cz;
      const d2 = dx*dx + dz*dz;
      if (d2 < rr*rr) {
        const d = Math.sqrt(d2) || 1e-6;
        const k = (rr - d) / d + 1e-3;
        px += dx * k;
        pz += dz * k;
      }
    }
    pos.x = px; pos.z = pz;
  }
  function resolveCollision(px, pz, nx, nz){
    // dikdörtgen duvarla da çöz
    if (collidesRectAt(nx, nz, local.parts.group.position.y)) {
      const a = !collidesRectAt(nx, pz, local.parts.group.position.y);
      const b = !collidesRectAt(px, nz, local.parts.group.position.y);
      if (a && !b) return { x:nx, z:pz };
      if (!a && b) return { x:px, z:nz };
      return { x:px, z:pz };
    }

    if (!collidesAt(nx, nz)) return { x:nx, z:nz };
    if (!collidesAt(nx, pz)) return { x:nx, z:pz };
    if (!collidesAt(px, nz)) return { x:px, z:nz };
    return { x:px, z:pz };
  }

  // ---- Oyuncu: Stylized mini astronot
  function buildStylizedChar(primaryColor = 0xffe4c4, accentColor = 0xffffff, opts={}){
    if (local._pendingName) { updateNameTag(local, local._pendingName); delete local._pendingName; }
    const scale = opts.scale ?? 0.22;
    const legH = opts.legH ?? 0.7;
    const legR = opts.legR ?? 0.19;

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
    grp.traverse(o => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; }});
    return { group: grp, torso, head, armL, armR, legL, legR: legRMesh };
  }


  {
    const parts = buildStylizedChar(0xffe4c4);
    local.parts = parts; scene.add(parts.group);
  }
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

  function ensureRemote(p){
    let R = remotes.get(p.id);
    if (R) return R;
    // Tek tip görünüm (ileride NFT’den renk/stil türetiriz)
    const bodyCol = 0xadd8e6;
    const accent  = 0xffffff;
    const parts = buildStylizedChar(bodyCol, accent, { scale: 0.22, legH: 0.7, legR: 0.19 });
    parts.group.position.set(p.x||0, 0, p.z||0);
    const tag = makeNameSprite(p.name || `Yogi-${String(p.id).slice(0,4)}`);
    parts.group.add(tag);
    R = { id: p.id, parts, tag, name: p.name || `Yogi-${String(p.id).slice(0,4)}` };
    scene.add(parts.group);
    remotes.set(p.id, R);
    return R;
  }

  // Input
  const keys = new Set();
  let chatFocus = false;
  const MOVE_KEYS = new Set(["KeyW","KeyA","KeyS","KeyD","ShiftLeft","ArrowUp","ArrowDown","ArrowLeft","ArrowRight"]);

  document.addEventListener("keydown", (e) => {
    if (e.code === "Enter") {
      chatFocus = !chatFocus;
      if (chatFocus) chatText?.focus(); else chatText?.blur();
      return;
    }
    if (MOVE_KEYS.has(e.code)) e.preventDefault();
    if (!chatFocus) {
      keys.add(e.code);
      const em = { Digit1:"wave", Digit2:"dance", Digit3:"sit", Digit4:"clap", Digit5:"point", Digit6:"cheer" };
      if (em[e.code]) socket.emit("emote:play", em[e.code]);
      if (e.code === "KeyQ") local.yaw += 0.06;
      if (e.code === "KeyE") local.yaw -= 0.06;
    }
  }, { passive:false });

  document.addEventListener("keyup", (e) => {
    if (MOVE_KEYS.has(e.code)) e.preventDefault();
    keys.delete(e.code);
  }, { passive:false });

  if (playBtn) playBtn.addEventListener("click", () => {
    // NFT entegrasyonu aktifse (index.html agoraInit dispatch ettiyse) burada iş yok
    if (window.agoraInjectedPayload) return;

    // ---- Fallback (NFT seçimi yoksa eski yol) ----
    const desired = (nameInput?.value||"").trim().slice(0,20);
    if (desired) { local.name = desired; if (local.tag) updateNameTag(local, desired); }

    socket.emit("profile:update", { name: desired || undefined });
    socket.emit("join",           { name: desired || undefined });

    if (cta) cta.style.display = "none";
    try { renderer.domElement.requestPointerLock(); } catch(e){}
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
    camDist += e.deltaY * 0.002;
    camDist = Math.min(10, Math.max(2, camDist));
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

  // Hotspots & Planets
  const planetMeshes = [];
  const moonTex = new THREE.TextureLoader().load("https://happy358.github.io/Images/textures/lunar_color.jpg", t=>{ t.colorSpace = THREE.SRGBColorSpace; });
  const PLANET_SIZE_MUL = 1.8;
  const PLANET_DIST_MUL = 3.33;
  const PLANET_ALTITUDE = 6.0;

  function addHotspotDisk(name, x, z, r){
    hotspotInfo.set(name, { pos:new THREE.Vector3(x,0,z), r });
    if (!SHOW_PADS) return;
  }

  function addPlanet(p){
    const R = (p.radius || 20) * (p.scale || PLANET_SIZE_MUL);
    const geo = new THREE.SphereGeometry(R, 48, 48);
    const mat = new THREE.MeshPhongMaterial({ color: p.color, map: moonTex, bumpMap: moonTex, bumpScale: 0.6 });
    const mesh = new THREE.Mesh(geo, mat);

    const altitude = (p.altitude != null) ? p.altitude : 0;
    mesh.position.set(p.x, R + 0.1 + altitude, p.z);
    mesh.rotation.x = -Math.PI/10;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const label = makeNameSprite(p.name, "#9ef");
    label.position.set(0, R + 0.8, 0);
    mesh.add(label);

    scene.add(mesh);
    planetMeshes.push({ name: p.name, mesh, label, R });

    addHotspotDisk(`Pad:${p.name}`, p.x, p.z, Math.max(12, Math.min(22, R*0.55)));
    hotspotInfo.set(`Planet:${p.name}`, { pos: new THREE.Vector3(p.x, 0, p.z), r: (p.r ? p.r * (p.scale || PLANET_SIZE_MUL) : (R + 10)) });
  }

  // Sockets
  let staticSpawned = false;
  socket.on("bootstrap", ({ you, players, hotspots, planets }) => {
    local.id = you.id;
    local.name = you.name;
    local.points = you.points || 0;
    pointsEl && (pointsEl.textContent = `Points: ${local.points}`);

    local.x = you.x; local.z = you.z; local.yaw = you.ry || 0;

    // Astronot (yerel)
    local.parts.group.position.set(local.x, 0, local.z);
    updateNameTag(local, local.name || `Yogi-${local.id?.slice(0,4)}`);

    // Pads/hotspots
    const PAD_KEYWORDS = ["totem","spawn","pad","platform","agora","hub","dock","deck"];
    let padCount = 0;

    (hotspots || []).forEach(h => {
      const name = h.name || "";
      const r = h.r || 12;
      const isPad = PAD_KEYWORDS.some(k => name.toLowerCase().includes(k));
      if (isPad) { addHotspotDisk(name, h.x, h.z, r); padCount++; }
      hotspotInfo.set(name, { pos: new THREE.Vector3(h.x, 0, h.z), r });
    });

    const padPos = (padCount>0)
      ? getAnyPadCenter()
      : new THREE.Vector3(local.parts.group.position.x, 0, local.parts.group.position.z);
    addHotspotDisk("AgoraPad", padPos.x, padPos.z, 18);

        // Dünya merkezi = en yakın pad merkezi
    worldCenter = padPos.clone();
    // Kırmızı sınır ringini hazırla/güncelle
    ensureBoundaryRing();

    // (İsteğe bağlı) Debug: sınır çemberini görsel olarak çiz
    if (DEBUG_COLLIDERS) {
      const ringGeo = new THREE.RingGeometry(
        WORLD_BOUNDS.radius - 0.1,
        WORLD_BOUNDS.radius + 0.1,
        128
      );
      const ringMat = new THREE.MeshBasicMaterial({ color: 0x22ffaa, transparent: true, opacity: 0.15, depthWrite:false });
      const ring    = new THREE.Mesh(ringGeo, ringMat);
      ring.rotation.x = -Math.PI / 2;
      ring.position.set(worldCenter.x, 0.03, worldCenter.z);
      colliderDebug.add(ring);
    }


    // Gezegenler
    (planets || []).forEach(p => {
      const x = (p.x || 0) * PLANET_DIST_MUL;
      const z = (p.z || 0) * PLANET_DIST_MUL;
      addPlanet({ ...p, x, z, scale: PLANET_SIZE_MUL, altitude: PLANET_ALTITUDE });
    });

    // Remote players
    (players || []).forEach(p => {
      const R = ensureRemote(p);
      updateNameTag(R, p.name || R.name);
    });

    // NPC’ler (bir kez)
    if (!staticSpawned) {
      staticSpawned = true;

      spawnNPC('/models/readyplayermale_cyberpunk.glb', {
        onPad: true,
        offset: { x: -7, z: -2 },
        targetHeight: 1.8,
        ry: Math.PI * 0.2,
        name: 'Neo Yogi',
        colliderPadding: 0.15
      });

      spawnNPC('/models/cyberpunk_car.glb', {
        onPad: true,
        offset: { x: 6, z: 1.5 },
        targetDiag: 4.2,
        ry: -Math.PI * 0.35,
        name: 'Agora Taxi',
        colliderPadding: 0.20
      });

      {
        const c = getAnyPadCenter();
        spawnNPC('/models/futuristic_pyramid_cityscape.glb', {
          onPad: false,
          x: c.x + 32,
          z: c.z - 18,
          y: 0.0,
          ry: -Math.PI * 5,
          targetDiag: 5,
          name: 'Pyramid City',
          collision: false
        });
      }

      spawnNPC('/models/sci-fi_modular_stack_asset.glb', {
        onPad: true,
        offset: { x: -12, z: 9 },
        targetDiag: 14,
        y: 0.0,
        ry: Math.PI * 0.1,
        name: 'Stack Module',
        colliderPadding: 0.25
      });

      // Neon Skyscraper (yeni varlık)
      {
        // Pad merkezini kullanalım:
        const c = getAnyPadCenter();
        spawnNPC('/models/Agora_Futuristic_Skyscraper_texture.glb', {
          onPad: false,
          x: c.x + 52,             // konum: pad’e göre sağa
          z: c.z - 24,             // konum: pad’e göre ileri/geri
          y: 0.0,
          ry: Math.PI * 0.05,      // hafif yana çevir
          targetDiag: 28,          // boyut (diyagonale göre); alternatif: scale: 1.2
          name: 'Neon Skyscraper', // kayıt anahtarı
          collision: true,         // çarpışma HALKASI aktif
          colliderPadding: 0.35    // halkayı bir tık geniş tut
        });
      }
      // Boyutu sahnede değiştir:
      const tower = getNPC('Neon Skyscraper');
      if (tower) {
        tower.scale.setScalar(1.15);        // komple ölçek
        tower.rotation.y = Math.PI * 0.08;  // biraz daha çevir
        // taşıma:
        // setNPCPosition('Neon Skyscraper', c.x + 60, c.z - 18, 0.0);
      }
      window.AGORALazy.register({
        name: 'Neon Skyscraper (lazy)',
        x: padPos.x + 52,
        z: padPos.z - 24,
        url: '/models/Agora_Futuristic_Skyscraper_texture.glb',
        dist: 35,       // 35m kalınca yükle
        unload: true    // uzaklaşınca boşalt
      });

      // === AGORA Binaları (lazy yükleme) ===
      {
        const C = getAnyPadCenter(); // pad merkezi

        AGORALazy.register({
          name: 'Mini Market',
          x: C.x + 10, z: C.z + 18,
          url: '/models/minimarket.glb',
          dist: 36,
          unload: true
        });

              // === Mini Market iç mekân & merdiven / platform ===
      (function setupMiniMarketZones(){
        const root = getNPC('Mini Market');   // spawnNPC(... name:'Mini Market', ...)
        if (!root) { console.warn('Mini Market henüz yüklenmedi'); return; }

        const bx = root.position.x;
        const bz = root.position.z;

        // 1) Platform yükseltisi (dükkânın önü ve içi — düz 0.9m)
        addHeightZoneRect('market-floor', bx-6.6, bz+3.6, bx+6.6, bz+6.0, 0.9, 0.9, null);

        // 2) Merdiven rampası (sokaktan platforma lineer yüksel)
        // Z ekseni boyunca 0.0 → 0.9; aralığı geniş tut (ayarla)
        addHeightZoneRect('market-stairs', bx-3.2, bz+2.0, bx+1.2, bz+3.6, 0.0, 0.9, 'z');

        // 3) Ön cam/duvar — ortada kapı boşluğu bırak
        // Sol parça
        addWallRect('market-front-L', bx-6.6, bz+3.6, bx-1.2, bz+3.9, 0.0, 2.5);
        // Sağ parça
        addWallRect('market-front-R', bx+1.2, bz+3.6, bx+6.6, bz+3.9, 0.0, 2.5);
        // Kapı boşluğu: (bx-1.2 .. bx+1.2) aralığı BİLEREK eklenmedi.

        // 4) Yan ve arka duvarlar (kalın dikdörtgenler)
        addWallRect('market-left',  bx-6.8, bz+3.4, bx-6.5, bz+6.0, 0.0, 3.0);
        addWallRect('market-right', bx+6.5, bz+3.4, bx+6.8, bz+6.0, 0.0, 3.0);
        addWallRect('market-back',  bx-6.6, bz+5.7, bx+6.6, bz+6.0, 0.0, 3.0);

        // 5) İsteğe bağlı: Vitrin/tezgâh gibi iç engeller
        // addWallRect('market-shelf', bx-2.0, bz+4.2, bx-0.8, bz+5.6, 0.8, 1.6);

        console.log('[MiniMarket] bölgeler yerleştirildi. ALT+L ile konum, ALT+Z ile görünürlük.');
      })();

      }



      // Çarpışma halkası aç/kapat:
      setCollisionEnabledFor('Neon Skyscraper', false); // devre dışı
      setCollisionEnabledFor('Neon Skyscraper', true, 0.40); // yeniden etkin (padding’i 0.40 yap)


      swapLocalAvatarFromGLB('/models/alioba/Alioba_Merged_Animations.glb');


      // window.AGORALazy.register({ name:'props-zone-1', x: padPos.x + 28, z: padPos.z, url:'/models/props_pack.glb', dist:30, unload:true });
    }
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
    const R = remotes.get(id);
    if (R) updateNameTag(R, name);
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

  socket.on("quest:update", ({code, progress, goal}) =>
    showToast(`Görev: ${code} ${progress}/${goal}`)
  );

  // Emotes
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
        // GLB avatar kullanıyorsak emote'ları uygun kliplere map'le
    if (usingGLBAvatar) {
      if (type === 'dance' && actions.dance) playAction('dance', 0.12, 1.0);
      else if (type === 'clap' && actions.clap) playAction('clap', 0.12, 1.0);
      return; // stylized kemik dönüşlerini atla
    }

    const baseColor = parts.torso.material.color.clone();
    const token = (emoteTokens.get(id) || 0) + 1;
    emoteTokens.set(id, token);
    const t0 = performance.now();
    function wave(t){ const k = Math.sin((t-t0)/130); parts.armR.rotation.x = -0.6 + 0.4*Math.sin((t-t0)/90); parts.armR.rotation.z =  0.8 + 0.1*k; parts.torso.rotation.y =  0.1*k; }
    function dance(t){ const k = Math.sin((t-t0)/160); parts.group.position.y = 0.08*Math.max(0, Math.sin((t-t0)/120)); parts.torso.rotation.z = 0.25*k; parts.armL.rotation.x = 0.6*k; parts.armR.rotation.x = -0.6*k; }
    function sit(t){ parts.legL.rotation.x = -1.0; parts.legR.rotation.x = -1.0; parts.torso.rotation.x = -0.3; parts.group.position.y = -0.2; }
    function clap(t){ const k = 0.6 + 0.6*Math.sin((t-t0)/90); parts.armL.rotation.x = 0.2; parts.armR.rotation.x = 0.2; parts.armL.rotation.y = 0.8*k; parts.armR.rotation.y = -0.8*k; parts.torso.rotation.y = 0.05*Math.sin((t-t0)/120); }
    function point(t){ parts.armR.rotation.x = -1.2; parts.armR.rotation.y = 0.3; parts.torso.rotation.y = 0.15; parts.torso.rotation.x = -0.1; }
    function cheer(t){ const k = Math.sin((t-t0)/110); parts.armL.rotation.x = -1.6; parts.armR.rotation.x = -1.6; parts.group.position.y = 0.10*Math.max(0, k); }
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
    p.innerHTML = `<i style="opacity:.8">[emote] ${ (id===local.id ? (local.name||'You') : (target.name||'Player')) }: /${type}</i>`;
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
      // Cinsiyete göre model değiştirme KALDIRILDI
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
    for (const c of colliders) syncDebugRing(c);
    // FPS hesabı
    const _frameDt = now - _fpsLast; _fpsLast = now;
    const _instFps = 1000 / Math.max(1, _frameDt);
    _fpsEWMA = _fpsEWMA ? (_fpsEWMA*0.9 + _instFps*0.1) : _instFps;

    const dt = Math.min(0.05, (now-last)/1000); last = now;

    if (COLLISION_ENABLED) pushOutFromColliders(local.parts.group.position);

    // Movement
    const kForward   = (keys.has("KeyW")?1:0) - (keys.has("KeyS")?1:0) || (keys.has("ArrowUp")?1:0) - (keys.has("ArrowDown")?1:0);
    const kStrafeKB  = (keys.has("KeyD")?1:0) - (keys.has("KeyA")?1:0) || (keys.has("ArrowRight")?1:0) - (keys.has("ArrowLeft")?1:0);
    let forward = kForward + (joyVec.y||0);
    let strafe  = kStrafeKB + (joyVec.x||0);
    forward = Math.max(-1, Math.min(1, forward));
    strafe  = Math.max(-1, Math.min(1, strafe));

    const mag = Math.hypot(strafe,forward) || 1;
    const spd = (keys.has("ShiftLeft") ? speedRun : speedWalk) * (mag>1 ? 1/mag : 1);

    if (forward || strafe) {
      const sin = Math.sin(local.yaw), cos = Math.cos(local.yaw);
      const dx = forward * sin - strafe * cos;
      const dz = forward * cos + strafe * sin;

      const px = local.parts.group.position.x;
      const pz = local.parts.group.position.z;

      const nx = px + dx * spd * dt;
      const nz = pz + dz * spd * dt;

      if (COLLISION_ENABLED) {
        const solved = resolveCollision(px, pz, nx, nz);
        local.parts.group.position.x = solved.x;
        local.parts.group.position.z = solved.z;
      } else {
        local.parts.group.position.set(nx, 0, nz);
      }
    }

    local.parts.group.rotation.y = local.yaw;

        // ... mevcut hareket/çarpışma çözümünden sonra:
    const slowK = enforceWorldBounds(local.parts.group.position);

    // (İsteğe bağlı) kenarda bir kez uyar
    if (slowK < 1) {
      if (!local._edgeWarned) {
        showToast("Güvenli alan bitti. Geri dön!");
        local._edgeWarned = true;
        setTimeout(() => (local._edgeWarned = false), 1200);
      }
    }

    // Yükseklik (merdiven/ramp/zemin)
    const wantY = targetYAt(local.parts.group.position.x, local.parts.group.position.z);
    local.parts.group.position.y = THREE.MathUtils.lerp(local.parts.group.position.y, wantY, 0.25);


    // Camera follow
    const camX = local.parts.group.position.x - Math.sin(local.yaw) * camDist;
    const camZ = local.parts.group.position.z - Math.cos(local.yaw) * camDist;
    camera.position.lerp(new THREE.Vector3(camX, 2.0, camZ), 0.15);
    camera.lookAt(local.parts.group.position.x, local.parts.group.position.y + 0.8, local.parts.group.position.z);

    // Planets
    for (const p of planetMeshes) p.mesh.rotation.y -= 0.0012;

    // Dinamik paketler
    updateLazyPacks(local.parts.group.position.x, local.parts.group.position.z);

    // Net sync
    netAcc += dt;
    if (netAcc > 0.08 && local.id) {
      netAcc = 0;
      socket.emit("state", { x:local.parts.group.position.x, y:0, z:local.parts.group.position.z, ry: local.yaw });
    }

    checkHotspots();

      // Animasyon güncelle
  if (mixer) mixer.update(dt);

  // Yürü/koş durumuna göre aksiyon
  if (usingGLBAvatar) {
    const moving = Math.abs(forward) + Math.abs(strafe) > 0.01;
    const wantRun = moving && keys.has("ShiftLeft") && !!actions.run;
    const nextName =
      moving ? (wantRun ? 'run' : (actions.walk ? 'walk' : currentActionName))
            : (actions.idle ? 'idle' : currentActionName);

    if (nextName && nextName !== currentActionName) {
      playAction(nextName, 0.12, wantRun ? 1.0 : 0.85);
    }
  }

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
  function sendChat(){ const t = chatText?.value.trim(); if (!t) return; socket.emit("chat:send", { text:t }); chatText.value=""; }
  chatSend?.addEventListener("click", sendChat);
  chatText?.addEventListener("keydown", (e)=>{ if (e.key === "Enter") sendChat(); });

  window.addEventListener("beforeunload", () => {
    try { socket?.close(); } catch(e) {}
  });

    // Kullanışlı: Pozisyon logger (ALT+L)
// ===== AGORA: debug & hotkeys (single block) =====

/* === AGORA HOTKEYS — Çakışmasız === */
(() => {
  const isTyping = () => {
    const el = document.activeElement;
    const tag = (el && el.tagName || '').toLowerCase();
    return tag === 'input' || tag === 'textarea' || tag === 'select' || (el && el.isContentEditable);
  };

  // Pozisyon logger (ALT+L)
  window.logPos = function(){
    const p = (local?.parts?.group?.position) || {x:0,y:0,z:0};
    console.log(`[pos] x=${p.x.toFixed(2)} z=${p.z.toFixed(2)} y=${p.y.toFixed(2)}`);
  };

  // Güvenli kısayollar:
  //  Alt+B  : sınır/zone görünümü
  //  ` (backquote): admin panel
  //  Alt+L  : pozisyon log
  window.addEventListener('keydown', (e) => {
    if (isTyping()) return;

    // Pozisyon
    if (e.code === 'KeyL' && e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      window.logPos();
      return;
    }

    // Sınır/zone toggle (Alt+B)
    if (e.code === 'KeyB' && e.altKey) {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      if (typeof toggleBoundaryDebug === 'function') toggleBoundaryDebug();
      else if (window.Admin?.toggleZones) window.Admin.toggleZones();
      return;
    }

    // Admin panel (` tuşu)
    if (e.code === 'Backquote') {
      e.preventDefault(); e.stopPropagation(); e.stopImmediatePropagation();
      window.AGORA_ADMIN?.toggle?.();
      return;
    }
  }, { capture:true, passive:false });
})();

/* === Viewport/Resize Stabilizer === */
(() => {
  const rootEl = document.getElementById('root');
  if (!rootEl) return;

  // Başlangıçta mevcut iç yükseklik ile kilitle
  let lockedH = window.innerHeight;
  rootEl.style.height = lockedH + 'px';

  // Küçük dalgalanmaları yok say (örn. yer imi çubuğu aç/kapa)
  let lastApplied = lockedH;
  let resizeTimer = 0;

  const MIN_DELTA_TO_ACCEPT = 32;   // px: bundan küçük değişimleri görmezden gel
  const APPLY_DELAY_MS       = 180; // gerçek resize'larda kısa gecikme ile uygula

  window.addEventListener('resize', () => {
    const ih = window.innerHeight;
    const delta = Math.abs(ih - lastApplied);

    // Ufak dalgalanma → yoksay
    if (delta < MIN_DELTA_TO_ACCEPT) return;

    // Gerçek boyut değişimi → kısa gecikme ile uygula
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      lockedH = window.innerHeight;
      lastApplied = lockedH;
      rootEl.style.height = lockedH + 'px';
      // üç.js tarafını da güncelle
      try {
        renderer.setSize(rootEl.clientWidth, lockedH);
        camera.aspect = rootEl.clientWidth / lockedH;
        camera.updateProjectionMatrix();
      } catch {}
    }, APPLY_DELAY_MS);
  }, { passive:true });
})();


// === Minimal Admin Panel (FPS dostu) ===/////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////////
(function setupAdmin(){
  const rootEl = document.getElementById('root');
  if (!rootEl) return;

  const panel = document.createElement('div');
  panel.style.cssText = `
    position:fixed; top:12px; right:12px; z-index:1000;
    width: 260px; max-width:92vw; padding:10px;
    background:rgba(8,10,20,0.92); border:1px solid #234; border-radius:12px;
    color:#cfe; font: 600 12px/1.4 Inter, system-ui; display:none; backdrop-filter:blur(4px);
  `;
  panel.innerHTML = `
    <div style="display:flex;justify-content:space-between;align-items:center;gap:6px;margin-bottom:6px">
      <div style="color:#9cf;font-weight:800">Admin</div>
      <button id="admClose" class="help-btn" style="width:28px;height:28px;line-height:0">×</button>
    </div>

    <label style="display:flex;align-items:center;gap:8px;margin:6px 0">
      <input id="admRing" type="checkbox" checked />
      Sınır çemberi (kırmızı)
    </label>

    <div style="margin:6px 0">
      <div style="opacity:.9;margin-bottom:4px">Yarıçap: <b id="admRVal">${WORLD_BOUNDS.radius}</b> m</div>
      <input id="admRadius" type="range" min="60" max="400" step="2" value="${WORLD_BOUNDS.radius}" style="width:100%">
    </div>

    <label style="display:flex;align-items:center;gap:8px;margin:6px 0">
      <input id="admCollide" type="checkbox" ${COLLISION_ENABLED ? 'checked' : ''}/>
      Çarpışma (duvarlar/NPC/objeler)
    </label>

    <label style="display:flex;align-items:center;gap:8px;margin:6px 0">
      <input id="admColDbg" type="checkbox" ${colliderDebug.visible ? 'checked' : ''}/>
      Collider halkaları (debug)
    </label>

    <small style="opacity:.75">Kısayollar: <b>B</b> ring aç/kapa · <b>F10</b> veya <b>\`</b> panel</small>
  `;
  rootEl.appendChild(panel);

  const btnClose = panel.querySelector('#admClose');
  const chkRing  = panel.querySelector('#admRing');
  const rngR     = panel.querySelector('#admRadius');
  const lblR     = panel.querySelector('#admRVal');
  const chkCol   = panel.querySelector('#admCollide');
  const chkDbg   = panel.querySelector('#admColDbg');

  chkRing.addEventListener('change', () => {
    SHOW_WORLD_RING = chkRing.checked;
    ensureBoundaryRing();
  });
  rngR.addEventListener('input', () => {
    WORLD_BOUNDS.radius = Number(rngR.value) || WORLD_BOUNDS.radius;
    lblR.textContent = WORLD_BOUNDS.radius;
    ensureBoundaryRing();
  });
  chkCol.addEventListener('change', () => {
    COLLISION_ENABLED = !!chkCol.checked;
  });
  chkDbg.addEventListener('change', () => {
    colliderDebug.visible = !!chkDbg.checked;
  });
  btnClose.addEventListener('click', () => {
    panel.style.display = 'none';
  });

  // HUD’a küçük bir dişli ekle (opsiyonel, yoksa F10/` ile aç)
  try{
    const hud = document.querySelector('.hud');
    if (hud){
      const gear = document.createElement('button');
      gear.textContent = '⚙️';
      gear.title = 'Admin';
      gear.className = 'help-btn';
      gear.style.marginLeft = '6px';
      hud.appendChild(gear);
      gear.addEventListener('click', () => {
        panel.style.display = (panel.style.display === 'none' || !panel.style.display) ? 'block' : 'none';
      });
    }
  }catch{}

  window.AGORA_ADMIN = {
    toggle(){ panel.style.display = (panel.style.display === 'none' || !panel.style.display) ? 'block' : 'none'; },
    show(){ panel.style.display = 'block'; },
    hide(){ panel.style.display = 'none'; }
  };
})(); // <= setupAdmin bitti

})(); // <= client.js ana IIFE bitti

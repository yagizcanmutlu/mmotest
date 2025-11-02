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

  // === AGORA NFT entegrasyonu (index.html -> client.js) ===
  const hudGenderEl = document.getElementById('hudGender');
  function setHudGender(g) {
    if (!hudGenderEl) return;
    hudGenderEl.className = '';
    if ((g||'').toLowerCase().startsWith('m')) {
      hudGenderEl.textContent = '♂ Erkek';
      hudGenderEl.classList.add('-male');
    } else {
      hudGenderEl.textContent = '♀ Kadın';
      hudGenderEl.classList.add('-female');
    }
  }

  function startGameFromPayload({ playerName, gender='female', wallet=null, nft=null } = {}) {
    const name = (playerName || '').trim() || 'Player';
    local.gender = gender;
    if (name) updateNameTag(local, name);

    setHudGender(gender);

    socket.emit("profile:update", { name, gender, wallet, nft });
    socket.emit("join",           { name, gender, wallet, nft });

        // NFT model yolu: payload.nft.modelUrl || global değişken
    const nftUrl =
      (nft && (nft.modelUrl || nft.glb || nft.url)) ||
      (typeof window.__AGORA_SELECTED_NFT__ === 'string'
        ? window.__AGORA_SELECTED_NFT__
        : (window.__AGORA_SELECTED_NFT__?.modelUrl || window.__AGORA_SELECTED_NFT__?.glb));

    if (nftUrl) {
      loadCustomAvatar(nftUrl).then(ok => {
        if (!ok) console.warn('[Agora] NFT/GLB yüklenemedi:', nftUrl);
      });
    }


    if (cta) cta.style.display = "none";
    try { renderer.domElement.requestPointerLock(); } catch(e){}

    window.__AGORA_SELECTED_NFT__ = nft || null;
  }

  window.addEventListener('agoraInit', (e) => {
    const payload = e?.detail || {};
    window.agoraInjectedPayload = payload;
    startGameFromPayload(payload);
  });

  // --- CUSTOM AVATAR (NFT) ---
  async function loadCustomAvatar(url, targetHeight = 1.65) {
    if (!url) return false;
    return new Promise((resolve) => {
      gltfLoader.load(url, (gltf) => {
        const root = new THREE.Group();
        const sceneNode = gltf.scene || gltf.scenes?.[0];
        if (!sceneNode) return resolve(false);

        sceneNode.traverse(o => { if (o.isMesh){ o.castShadow = o.receiveShadow = true; }});
        root.add(sceneNode);

        // Yüksekliği 1.65m'e normalize et
        const bb = new THREE.Box3().setFromObject(root);
        const h  = Math.max(0.0001, bb.max.y - bb.min.y);
        const s  = targetHeight / h;
        root.scale.setScalar(s);
        const bb2 = new THREE.Box3().setFromObject(root);
        root.position.y += -bb2.min.y + 0.02;

        // Eski avatarı sahneden çıkar
        if (local?.parts?.group) scene.remove(local.parts.group);

        // NameTag'i koru
        const tag = local.tag || makeNameSprite(local.name || 'Player');
        root.add(tag);

        // Local parçayı GLB ile değiştir
        local.parts = { group: root };          // minimal API
        scene.add(root);

        // GLB içi animasyonları hazırlanır (varsa)
        if (gltf.animations && gltf.animations.length) {
          local.avatarMixer = new THREE.AnimationMixer(root);
          local.avatarActions = {};
          gltf.animations.forEach(clip => {
            local.avatarActions[clip.name] = local.avatarMixer.clipAction(clip);
          });
        }
        resolve(true);
      }, undefined, () => resolve(false));
    });
  }

  // Basit oynatıcı (ad eşleşmezse içinde "Dance" geçen ilk klibi bulur)
  function playAvatarAction(nameLike, loop=true) {
    if (!local.avatarActions) return false;
    let key = Object.keys(local.avatarActions).find(k => k.toLowerCase() === nameLike.toLowerCase());
    if (!key) key = Object.keys(local.avatarActions).find(k => k.toLowerCase().includes(nameLike.toLowerCase()));
    if (!key) return false;
    // Hepsini kapat
    Object.values(local.avatarActions).forEach(a => { a.stop(); a.reset(); });
    const act = local.avatarActions[key];
    act.setLoop(loop ? THREE.LoopRepeat : THREE.LoopOnce, loop ? Infinity : 1);
    act.fadeIn(0.15).play();
    return true;
  }


  // === Registry & Collisions ===
  const npcRegistry = new Map();             // key -> THREE.Group (root)
  const colliders  = [];                     // { key, root, r, padding }
  const PLAYER_RADIUS = 0.45;
  const COLLISION_ENABLED = true;

  const DEBUG_COLLIDERS = true;
  const MAX_COLLIDER_RADIUS = 12;
  let colliderDebug = null;

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

  // Helpers (UI + name sprites)
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
  const _spawnedNPC = new Set(); // url|name anahtarıyla dedup

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

      const regKey = name || url;
      npcRegistry.set(regKey, root);

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
  function collidesAt(nx, nz){
    for (const c of colliders){
      const cx = (c.root?.position.x ?? c.x) + (c.offX || 0);
      const cz = (c.root?.position.z ?? c.z) + (c.offZ || 0);
      const rr = (c.r || 1) + PLAYER_RADIUS;
      const dx = nx - cx, dz = nz - cz;
      if (dx*dx + dz*dz < rr*rr) return true;
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
    if (!collidesAt(nx, nz)) return { x:nx, z:nz };
    if (!collidesAt(nx, pz)) return { x:nx, z:pz }; // slide X
    if (!collidesAt(px, nz)) return { x:px, z:nz }; // slide Z
    return { x:px, z:pz }; // tamamen engelli
  }

  // ---- Oyuncu: Stylized mini astronot
  function buildStylizedChar(primaryColor = 0xffe4c4, accentColor = 0xffffff, opts={}){
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

  // ======== LOCAL / REMOTE STATE ========
  const local = { id:null, name:null, yaw:0, parts:null, tag:null, points:0, visited:{}, gender:'female', x:0, z:0 };
  {
    const parts = buildStylizedChar(0xffe4c4);
    local.parts = parts;
    scene.add(parts.group);

    // >>> Başlangıçta oyuncu yüksekliğini 1.65m'e Normalize et
    setTimeout(() => setPlayerHeight(1.65), 0);
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
    const isFemale = (p.gender === 'female');
    const bodyCol = isFemale ? 0xffd7d0 : 0xadd8e6;
    const accent  = isFemale ? 0xff3a66 : 0xffffff;
    const parts = buildStylizedChar(bodyCol, accent, { scale: 0.22, legH: 0.7, legR: 0.19 });
    parts.group.position.set(p.x||0, 0, p.z||0);
    const tag = makeNameSprite(p.name || `Yogi-${String(p.id).slice(0,4)}`);
    parts.group.add(tag);
    R = { id: p.id, parts, tag, name: p.name || `Yogi-${String(p.id).slice(0,4)}`, gender: p.gender || 'female' };
    scene.add(parts.group);
    remotes.set(p.id, R);
    return R;
  }

  // ======== EMOTE & ORYANTASYON YARDIMCILARI (YENİ) ========
  let stickyEmote = null; // "dance" açıkken tutulur

  function faceCamera(offset = 0) {
    if (!local?.parts?.group) return;
    const px = local.parts.group.position.x;
    const pz = local.parts.group.position.z;
    const dx = camera.position.x - px;
    const dz = camera.position.z - pz;
    const yawToCam = Math.atan2(dx, dz);
    local.yaw = yawToCam + offset;
  }

  function setPlayerHeight(targetMeters = 1.65) {
    if (!local?.parts?.group) return;
    const grp = local.parts.group;
    const bb = new THREE.Box3().setFromObject(grp);
    const h = Math.max(0.0001, bb.max.y - bb.min.y);
    const s = targetMeters / h;
    grp.scale.multiplyScalar(s);
  }

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

  // Dansı toggle olarak sürekli oynatan versiyon
  function playEmoteContinuous(parts, id, type) {
    const base = parts.torso.material.color.clone();
    const token = (emoteTokens.get(id) || 0) + 1;
    emoteTokens.set(id, token);
    const t0 = performance.now();
    function loop() {
      if (emoteTokens.get(id) !== token || stickyEmote !== type) {
        parts.torso.material.color.copy(base);
        resetPose(parts);
        return;
      }
      const t = performance.now();
      const k = Math.sin((t - t0) / 160);
      parts.group.position.y = 0.08 * Math.max(0, Math.sin((t - t0) / 120));
      parts.torso.rotation.z = 0.25 * k;
      parts.armL.rotation.x = 0.6 * k;
      parts.armR.rotation.x = -0.6 * k;
      requestAnimationFrame(loop);
    }
    loop();
  }

  // Input
  const keys = new Set();
  let chatFocus = false;

  // Klavye olayları – GÜNCELLENMİŞ
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

      // Kameraya göre hızlı yönler
      // if (e.code === "KeyS") faceCamera(0);                 // kameraya ön
      // if (e.code === "KeyA") faceCamera(Math.PI / 2);       // sola yan
      // if (e.code === "KeyD") faceCamera(-Math.PI / 2);      // sağa yan

      // Dans toggle (Digit3)
      if (e.code === "Digit3") {
        if (stickyEmote === "dance") {
          stickyEmote = null; // kapat
        } else {
          stickyEmote = "dance"; // aç
          playEmoteContinuous(local.parts, local.id || "local", "dance");
        }
        return;
      }

      // Diğer tek atımlık emote'lar
      const once = { Digit1:"wave", Digit2:"clap", Digit4:"sit", Digit5:"point", Digit6:"cheer" };
      if (once[e.code]) {
        stickyEmote = null; // varsa dansı kes
        socket.emit("emote:play", once[e.code]);
      }

      // İnce döndürme
      if (e.code === "KeyQ") local.yaw += 0.06;
      if (e.code === "KeyE") local.yaw -= 0.06;

      // Anlık ölçek ayarı (+ / -)
      if (e.code === "Equal" || e.code === "NumpadAdd")   local.parts.group.scale.multiplyScalar(1.05);
      if (e.code === "Minus" || e.code === "NumpadSubtract") local.parts.group.scale.multiplyScalar(0.95);
    }
  }, { passive:false });

  document.addEventListener("keyup", (e) => {
    if (MOVE_KEYS.has(e.code)) e.preventDefault();
    keys.delete(e.code);
  }, { passive:false });

  if (playBtn) playBtn.addEventListener("click", () => {
    if (window.agoraInjectedPayload) return;

    const desired = (nameInput?.value||"").trim().slice(0,20);
    if (desired) { local.name = desired; if (local.tag) updateNameTag(local, desired); }
    const formGenderEl = document.querySelector('input[name="gender"]:checked');
    const fallbackGender = (formGenderEl?.value || 'female');
    setHudGender(fallbackGender);

    socket.emit("profile:update", { name: desired || undefined, gender: fallbackGender });
    socket.emit("join",           { name: desired || undefined, gender: fallbackGender });

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

    const padPos = (padCount>0)
      ? getAnyPadCenter()
      : new THREE.Vector3(local.parts.group.position.x, 0, local.parts.group.position.z);
    addHotspotDisk("AgoraPad", padPos.x, padPos.z, 18);

    (planets || []).forEach(p => {
      const x = (p.x || 0) * PLANET_DIST_MUL;
      const z = (p.z || 0) * PLANET_DIST_MUL;
      addPlanet({ ...p, x, z, scale: PLANET_SIZE_MUL, altitude: PLANET_ALTITUDE });
    });

    (players || []).forEach(p => {
      const R = ensureRemote(p);
      updateNameTag(R, p.name || R.name);
    });

    if (!staticSpawned) {
      staticSpawned = true;

      spawnNPC('/models/readyplayermale_cyberpunk.glb', {
        onPad: true, offset: { x: -7, z: -2 }, targetHeight: 1.8, ry: Math.PI * 0.2, name: 'Neo Yogi', colliderPadding: 0.15
      });

      spawnNPC('/models/cyberpunk_car.glb', {
        onPad: true, offset: { x: 6, z: 1.5 }, targetDiag: 4.2, ry: -Math.PI * 0.35, name: 'Agora Taxi', colliderPadding: 0.20
      });

      {
        const c = getAnyPadCenter();
        spawnNPC('/models/futuristic_pyramid_cityscape.glb', {
          onPad: false, x: c.x + 32, z: c.z - 18, y: 0.0, ry: -Math.PI * 5, targetDiag: 5, name: 'Pyramid City', collision: false
        });
      }

      spawnNPC('/models/sci-fi_modular_stack_asset.glb', {
        onPad: true, offset: { x: -12, z: 9 }, targetDiag: 14, y: 0.0, ry: Math.PI * 0.1, name: 'Stack Module', colliderPadding: 0.25
      });
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
      if (p.gender && p.gender !== R.gender){
        const pos = R.parts.group.position.clone();
        scene.remove(R.parts.group);
        const isFemale = (p.gender==='female');
        const bodyCol = isFemale ? 0xffd7d0 : 0xadd8e6;
        const accent  = isFemale ? 0xff3a66 : 0xffffff;
        const parts = buildStylizedChar(bodyCol, accent, { scale: 0.22, legH: 0.7, legR: 0.19 });
        parts.group.position.copy(pos);
        parts.group.add(R.tag);
        scene.add(parts.group);
        R.parts = parts; R.gender = p.gender;
      }
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
  
  function lerpAngle(a, b, t) {
    let diff = (b - a + Math.PI) % (Math.PI * 2);
    if (diff < 0) diff += Math.PI * 2;
    diff -= Math.PI;
    return a + diff * t;
  }

  function tick(now){
    for (const c of colliders) syncDebugRing(c);

    // FPS hesap
    const _frameDt = now - _fpsLast; _fpsLast = now;
    const _instFps = 1000 / Math.max(1, _frameDt);
    _fpsEWMA = _fpsEWMA ? (_fpsEWMA*0.9 + _instFps*0.1) : _instFps;

    const dt = Math.min(0.05, (now-last)/1000); last = now;

    // Spawn/ilk frame iç içe kalma ihtimaline karşı hafif ittirme
    if (COLLISION_ENABLED) pushOutFromColliders(local.parts.group.position);

    // ======== A/S/D yön ver & o yöne yürü (kamera sabit) ========
    const pos = local.parts.group.position;
    const px = pos.x, pz = pos.z;

    // Kameraya doğru yaw (oyuncudan kameraya bakan yön)
    const yawToCam = Math.atan2(camera.position.x - px, camera.position.z - pz);

    const wDown = keys.has("KeyW") || keys.has("ArrowUp");
    const aDown = keys.has("KeyA") || keys.has("ArrowLeft");
    const sDown = keys.has("KeyS") || keys.has("ArrowDown");
    const dDown = keys.has("KeyD") || keys.has("ArrowRight");

    // Hangi yöne bakmalı?
    let desiredYaw = local.yaw;
    if (!wDown) {
      if (sDown)      desiredYaw = yawToCam;               // kameraya doğru
      else if (aDown) desiredYaw = yawToCam + Math.PI/2;   // sola
      else if (dDown) desiredYaw = yawToCam - Math.PI/2;   // sağa
    }
    // yumuşak dönüş
    local.yaw = lerpAngle(local.yaw, desiredYaw, 0.25);

    // İleri/strafe niyeti
    let forward = 0, strafe = 0;
    if (wDown) {
      forward = 1;
    } else if (aDown || sDown || dDown) {
      // W yoksa A/S/D tek başına basılıyken de yürü
      forward = 1;
      strafe  = 0;
    } else {
      // joystick katkısı (mobil)
      forward = joyVec.y || 0;
      strafe  = joyVec.x || 0;
    }

    // hız ve hareket
    const mag = Math.hypot(strafe, forward) || 1;
    const spd = (keys.has("ShiftLeft") ? speedRun : speedWalk) * (mag > 1 ? 1/mag : 1);

    if (forward || strafe) {
      const sin = Math.sin(local.yaw), cos = Math.cos(local.yaw);
      const dx = forward * sin - strafe * cos;
      const dz = forward * cos + strafe * sin;

      const nx = px + dx * spd * dt;
      const nz = pz + dz * spd * dt;

      if (COLLISION_ENABLED) {
        const solved = resolveCollision(px, pz, nx, nz);
        pos.x = solved.x; pos.z = solved.z;
      } else {
        pos.set(nx, 0, nz);
      }
    }

    // Oyuncu modeli kendi yaw'una baksın
    local.parts.group.rotation.y = local.yaw;

    // Kamera takip
    const camX = pos.x - Math.sin(local.yaw) * camDist;
    const camZ = pos.z - Math.cos(local.yaw) * camDist;
    camera.position.lerp(new THREE.Vector3(camX, 2.0, camZ), 0.15);
    camera.lookAt(pos.x, pos.y + 0.8, pos.z);

    // Gezegen/props anim
    for (const p of planetMeshes) p.mesh.rotation.y -= 0.0012;

    // Dinamik paketler
    updateLazyPacks(pos.x, pos.z);

    // GLB animasyonları (varsa)
    if (local.avatarMixer) local.avatarMixer.update(dt);

    // Net senk
    netAcc += dt;
    if (netAcc > 0.08 && local.id) {
      netAcc = 0;
      socket.emit("state", { x: pos.x, y: 0, z: pos.z, ry: local.yaw });
    }

    checkHotspots();
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }

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

})();
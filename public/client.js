/* global THREE, io */
(() => {
  const socket = io();

  // === THREE.JS SAHNE ===
  const root = document.getElementById("root");
  const dbg = document.getElementById("dbg");
  const hpFill = document.getElementById("hpFill");
  const cta = document.getElementById("cta");
  const playBtn = document.getElementById("playBtn");

  const renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setSize(root.clientWidth, root.clientHeight);
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  root.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0x0a0a18, 18, 90);

  const camera = new THREE.PerspectiveCamera(75, root.clientWidth / root.clientHeight, 0.1, 500);
  camera.position.set(0, 1.6, 4);

  const hemi = new THREE.HemisphereLight(0x88aaff, 0x080820, 1.0);
  scene.add(hemi);
  const dir = new THREE.DirectionalLight(0xaaddff, 0.6);
  dir.position.set(5,10,2);
  scene.add(dir);

  // Zemin
  const groundGeo = new THREE.PlaneGeometry(500, 500, 1, 1);
  const groundMat = new THREE.MeshStandardMaterial({ color: 0x111319, roughness: 1, metalness: 0 });
  const ground = new THREE.Mesh(groundGeo, groundMat);
  ground.rotation.x = -Math.PI/2;
  ground.receiveShadow = true;
  scene.add(ground);

  // Basit yıldızlı gökyüzü (particle)
  const stars = new THREE.Points(
    new THREE.BufferGeometry().setAttribute(
      "position",
      new THREE.Float32BufferAttribute(
        new Array(3000).fill(0).flatMap(() => [
          (Math.random()-0.5)*300,
          20 + Math.random()*60,
          (Math.random()-0.5)*300
        ]), 3)),
    new THREE.PointsMaterial({ size: 0.6, color: 0x88aaff })
  );
  scene.add(stars);

  // === OYUNCU/NESNE MODELLERİ ===
  function makeCapsule(color = 0x55ff88) {
    const g = new THREE.CapsuleGeometry(0.35, 1.0, 6, 12);
    const m = new THREE.MeshStandardMaterial({ color, roughness:.8, metalness:.1 });
    const mesh = new THREE.Mesh(g, m);
    mesh.castShadow = true;
    return mesh;
  }
  function makeZombie() {
    const g = new THREE.BoxGeometry(0.8,1.3,0.6);
    const m = new THREE.MeshStandardMaterial({ color: 0x884444, roughness:.9 });
    const z = new THREE.Mesh(g,m);
    z.castShadow = true;
    return z;
  }

  // Yerel oyuncu
  const local = {
    id: null,
    hp: 100,
    yaw: 0,
    vel: new THREE.Vector3(),
    obj: makeCapsule(0x66ffbb)
  };
  local.obj.position.set(0, 0.65, 0);
  scene.add(local.obj);

  // Diğer oyuncular
  const remotes = new Map(); // id -> {obj,target}
  function ensureRemote(p) {
    let R = remotes.get(p.id);
    if (!R) {
      const obj = makeCapsule(0x88aaff);
      obj.position.set(p.x, 0.65, p.z);
      scene.add(obj);
      R = { obj, target: new THREE.Vector3(p.x, 0.65, p.z), ry: p.ry };
      remotes.set(p.id, R);
    }
    return R;
  }

  // NPC
  const npc = { obj: makeZombie() };
  npc.obj.position.set(6, 0.65, -6);
  scene.add(npc.obj);

  // === KONTROLLER ===
  const keys = new Set();
  window.addEventListener("keydown", (e) => keys.add(e.code));
  window.addEventListener("keyup", (e) => keys.delete(e.code));

  // Pointer lock
  playBtn.addEventListener("click", () => {
    cta.style.display = "none";
    renderer.domElement.requestPointerLock();
  });
  document.addEventListener("pointerlockchange", () => {
    if (document.pointerLockElement !== renderer.domElement) {
      cta.style.display = "flex";
    }
  });
  window.addEventListener("mousemove", (e) => {
    if (document.pointerLockElement === renderer.domElement) {
      local.yaw -= e.movementX * 0.0025;
    }
  });

  // === AĞ OLAYLARI ===
  socket.on("bootstrap", ({ you, players, npc: npcS }) => {
    local.id = you.id;
    local.obj.position.set(you.x, 0.65, you.z);
    local.yaw = you.ry || 0;
    local.hp = you.hp ?? 100;
    hpFill.style.transform = `scaleX(${local.hp/100})`;
    // mevcut oyuncular
    for (const p of players) ensureRemote(p);
    // npc
    npc.obj.position.set(npcS.x, 0.65, npcS.z);
    npc.obj.rotation.y = npcS.ry || 0;
  });

  socket.on("player-joined", (p) => {
    if (p.id !== local.id) ensureRemote(p);
  });
  socket.on("player-left", (id) => {
    const R = remotes.get(id);
    if (R) { scene.remove(R.obj); remotes.delete(id); }
  });

  socket.on("snapshot", ({ players, npc: npcS }) => {
    // uzak oyuncuların hedef konumlarını güncelle
    for (const p of players) {
      if (p.id === local.id) continue;
      const R = ensureRemote(p);
      R.target.set(p.x, 0.65, p.z);
      R.ry = p.ry || 0;
    }
    npc.obj.position.set(npcS.x, 0.65, npcS.z);
    npc.obj.rotation.y = npcS.ry || 0;
  });

  // === OYUN DÖNGÜSÜ ===
  let last = performance.now();
  function tick(now) {
    const dt = Math.min(0.05, (now - last) / 1000);
    last = now;

    // hareket
    const speed = keys.has("ShiftLeft") ? 6 : 3.2;
    const forward = (keys.has("KeyW") ? 1 : 0) - (keys.has("KeyS") ? 1 : 0);
    const strafe  = (keys.has("KeyD") ? 1 : 0) - (keys.has("KeyA") ? 1 : 0);

    // yerel yön vektörü
    const dir = new THREE.Vector3(strafe, 0, forward).normalize();
    if (dir.lengthSq() > 0) {
      const sin = Math.sin(local.yaw), cos = Math.cos(local.yaw);
      const dx = dir.x * cos - dir.z * sin;
      const dz = dir.x * sin + dir.z * cos;
      local.obj.position.x += dx * speed * dt;
      local.obj.position.z += dz * speed * dt;
    }
    local.obj.rotation.y = local.yaw;

    // basit kamera takip
    const camDist = 3.5;
    const cx = local.obj.position.x - Math.sin(local.yaw) * camDist;
    const cz = local.obj.position.z - Math.cos(local.yaw) * camDist;
    const cy = 2.0;
    camera.position.lerp(new THREE.Vector3(cx, cy, cz), 0.15);
    camera.lookAt(local.obj.position.x, local.obj.position.y + 0.8, local.obj.position.z);

    // uzak oyunculara yumuşak yaklaşım
    for (const R of remotes.values()) {
      R.obj.position.lerp(R.target, 0.2);
      R.obj.rotation.y = THREE.MathUtils.lerp(R.obj.rotation.y, R.ry, 0.2);
    }

    // Ağ: durum gönder (10–15 Hz civarı)
    netAcc += dt;
    if (netAcc > 0.08 && local.id) {
      netAcc = 0;
      socket.emit("state", {
        x: local.obj.position.x,
        y: 0,
        z: local.obj.position.z,
        ry: local.yaw,
        hp: local.hp
      });
    }

    // HUD
    dbg.textContent = `id:${local.id ?? "-"}  pos:${local.obj.position.x.toFixed(1)}, ${local.obj.position.z.toFixed(1)}  players:${1+remotes.size}`;
    renderer.render(scene, camera);
    requestAnimationFrame(tick);
  }
  let netAcc = 0;
  requestAnimationFrame(tick);

  // Resize
  window.addEventListener("resize", () => {
    renderer.setSize(root.clientWidth, root.clientHeight);
    camera.aspect = root.clientWidth / root.clientHeight;
    camera.updateProjectionMatrix();
  });
})();

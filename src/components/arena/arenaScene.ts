import * as THREE from "three";

export type Box = { min: THREE.Vector2; max: THREE.Vector2; height: number };

export const ARENA = 147; // 42 * 3.5 — full square side of the compound
const HALF = ARENA / 2;
const WALL_H = 14;
const ROOF_H = 22;

function addBox(
  parent: THREE.Object3D,
  colliders: Box[] | null,
  x: number,
  z: number,
  w: number,
  h: number,
  d: number,
  material: THREE.Material,
  y = h / 2,
  name?: string,
) {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), material);
  mesh.position.set(x, y, z);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  if (name) mesh.name = name;
  parent.add(mesh);
  colliders?.push({
    min: new THREE.Vector2(x - w / 2, z - d / 2),
    max: new THREE.Vector2(x + w / 2, z + d / 2),
    height: y + h / 2,
  });
  return mesh;
}

export function buildArena() {
  const group = new THREE.Group();
  group.name = "LoneWolfArena";
  const colliders: Box[] = [];

  const structure = new THREE.Group();
  structure.name = "Structure";
  const props = new THREE.Group();
  props.name = "Props";
  const spawnGroup = new THREE.Group();
  spawnGroup.name = "SpawnPoints";
  const roofGroup = new THREE.Group();
  roofGroup.name = "Roof";
  group.add(structure, props, spawnGroup, roofGroup);

  const loader = new THREE.TextureLoader();
  const tex = (url: string, rx: number, ry = rx) => {
    const t = loader.load(url);
    t.wrapS = t.wrapT = THREE.RepeatWrapping;
    t.repeat.set(rx, ry);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 8;
    return t;
  };

  const mats = {
    ground: new THREE.MeshStandardMaterial({
      map: tex("/textures/asphalt.jpg", 18),
      color: 0x8f8f92,
      roughness: 1,
    }),
    sand: new THREE.MeshStandardMaterial({
      map: tex("/textures/ground.jpg", 8),
      color: 0xc9bda3,
      roughness: 1,
    }),
    wall: new THREE.MeshStandardMaterial({
      map: tex("/textures/concrete.jpg", 12, 3),
      color: 0x9aa0a8,
      roughness: 0.95,
    }),
    concrete: new THREE.MeshStandardMaterial({
      map: tex("/textures/concrete.jpg", 4),
      color: 0xc2c6cb,
      roughness: 0.9,
    }),
    crate: new THREE.MeshStandardMaterial({
      map: tex("/textures/wood.jpg", 1),
      color: 0xd8b98c,
      roughness: 0.8,
    }),
    metal: new THREE.MeshStandardMaterial({
      map: tex("/textures/metal.jpg", 2),
      color: 0xb9bec6,
      metalness: 0.5,
      roughness: 0.45,
    }),
    roof: new THREE.MeshStandardMaterial({
      map: tex("/textures/roof.jpg", 10),
      color: 0xa8adb4,
      roughness: 0.8,
      metalness: 0.3,
      side: THREE.DoubleSide,
    }),
    barrel: new THREE.MeshStandardMaterial({
      map: tex("/textures/barrel.jpg", 2, 1),
      roughness: 0.6,
      metalness: 0.4,
    }),
    containerBlue: new THREE.MeshStandardMaterial({
      map: tex("/textures/container_blue.jpg", 3, 1),
      roughness: 0.7,
      metalness: 0.25,
    }),
    containerRed: new THREE.MeshStandardMaterial({
      map: tex("/textures/container_red.jpg", 3, 1),
      roughness: 0.7,
      metalness: 0.25,
    }),
    containerGrey: new THREE.MeshStandardMaterial({
      map: tex("/textures/container_grey.jpg", 3, 1),
      roughness: 0.7,
      metalness: 0.25,
    }),
    blue: new THREE.MeshStandardMaterial({
      color: 0x2f7fd6,
      emissive: 0x1b4c85,
      emissiveIntensity: 0.8,
      roughness: 0.5,
    }),
    red: new THREE.MeshStandardMaterial({
      color: 0xd6432f,
      emissive: 0x7a2416,
      emissiveIntensity: 0.8,
      roughness: 0.5,
    }),
  };

  // ---------- Ground ----------
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(ARENA, ARENA), mats.ground);
  floor.name = "Ground";
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  structure.add(floor);

  // sand patch in the middle courtyard
  const sandPatch = new THREE.Mesh(new THREE.CircleGeometry(26, 48), mats.sand);
  sandPatch.name = "SandPatch";
  sandPatch.rotation.x = -Math.PI / 2;
  sandPatch.position.y = 0.02;
  sandPatch.receiveShadow = true;
  structure.add(sandPatch);

  // ---------- Outer walls ----------
  const t = 2;
  addBox(structure, colliders, 0, -HALF, ARENA, WALL_H, t, mats.wall, WALL_H / 2, "Wall_North");
  addBox(structure, colliders, 0, HALF, ARENA, WALL_H, t, mats.wall, WALL_H / 2, "Wall_South");
  addBox(structure, colliders, -HALF, 0, t, WALL_H, ARENA, mats.wall, WALL_H / 2, "Wall_West");
  addBox(structure, colliders, HALF, 0, t, WALL_H, ARENA, mats.wall, WALL_H / 2, "Wall_East");

  // corner buttress towers
  const cornerPts: Array<[number, number]> = [
    [-HALF + 5, -HALF + 5],
    [HALF - 5, -HALF + 5],
    [-HALF + 5, HALF - 5],
    [HALF - 5, HALF - 5],
  ];
  for (const [cx, cz] of cornerPts) {
    addBox(structure, colliders, cx, cz, 9, WALL_H + 3, 9, mats.concrete, (WALL_H + 3) / 2, "CornerTower");
  }

  // ---------- Roof (industrial hangar) ----------
  const roofSlab = new THREE.Mesh(new THREE.BoxGeometry(ARENA, 0.6, ARENA), mats.roof);
  roofSlab.name = "Roof_Deck";
  roofSlab.position.y = ROOF_H;
  roofSlab.receiveShadow = true;
  roofSlab.castShadow = true;
  roofGroup.add(roofSlab);

  // support columns + roof trusses
  const colStep = ARENA / 4;
  for (let i = -1; i <= 1; i++) {
    for (let j = -1; j <= 1; j++) {
      if (i === 0 && j === 0) continue;
      const cx = i * colStep;
      const cz = j * colStep;
      addBox(structure, colliders, cx, cz, 2.2, ROOF_H, 2.2, mats.metal, ROOF_H / 2, "Roof_Column");
    }
  }
  for (let i = -2; i <= 2; i++) {
    addBox(roofGroup, null, i * colStep, 0, 1.2, 1.4, ARENA, mats.metal, ROOF_H - 1.2, "Roof_Truss");
    addBox(roofGroup, null, 0, i * colStep, ARENA, 1.4, 1.2, mats.metal, ROOF_H - 2.6, "Roof_Truss");
  }
  // skylight strips (emissive light wells)
  const skyMat = new THREE.MeshStandardMaterial({
    color: 0xdfefff,
    emissive: 0xbcd9ff,
    emissiveIntensity: 1.4,
    roughness: 0.4,
  });
  for (const sx of [-colStep, colStep]) {
    const sky = new THREE.Mesh(new THREE.BoxGeometry(6, 0.2, ARENA - 20), skyMat);
    sky.name = "Roof_Skylight";
    sky.position.set(sx, ROOF_H - 0.45, 0);
    roofGroup.add(sky);
  }

  // ---------- Prop builders ----------
  let containerId = 0;
  const containerMats = [mats.containerBlue, mats.containerRed, mats.containerGrey];
  const addContainer = (
    x: number,
    z: number,
    rotY: number,
    variant: number,
    y = 0,
    long = true,
  ) => {
    const w = long ? 12.2 : 6.1;
    const h = 2.9;
    const d = 2.44;
    const c = new THREE.Group();
    c.name = `Container_${++containerId}`;
    const body = new THREE.Mesh(
      new THREE.BoxGeometry(w, h, d),
      containerMats[variant % containerMats.length]!,
    );
    body.castShadow = true;
    body.receiveShadow = true;
    c.add(body);
    // corner castings
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const sy of [-1, 1]) {
          const k = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), mats.metal);
          k.position.set((sx * (w - 0.5)) / 2, (sy * (h - 0.5)) / 2, (sz * (d - 0.5)) / 2);
          c.add(k);
        }
      }
    }
    c.position.set(x, y + h / 2, z);
    c.rotation.y = rotY;
    props.add(c);

    const cos = Math.abs(Math.cos(rotY));
    const sin = Math.abs(Math.sin(rotY));
    const ew = w * cos + d * sin;
    const ed = w * sin + d * cos;
    colliders.push({
      min: new THREE.Vector2(x - ew / 2, z - ed / 2),
      max: new THREE.Vector2(x + ew / 2, z + ed / 2),
      height: y + h,
    });
    return c;
  };

  const addBarrel = (x: number, z: number, y = 0) => {
    const b = new THREE.Mesh(new THREE.CylinderGeometry(0.48, 0.48, 1.2, 20), mats.barrel);
    b.name = "Barrel";
    b.position.set(x, y + 0.6, z);
    b.castShadow = true;
    b.receiveShadow = true;
    props.add(b);
    colliders.push({
      min: new THREE.Vector2(x - 0.48, z - 0.48),
      max: new THREE.Vector2(x + 0.48, z + 0.48),
      height: y + 1.2,
    });
  };

  const addCrateStack = (x: number, z: number) => {
    addBox(props, colliders, x, z, 1.6, 1.6, 1.6, mats.crate, 0.8, "Crate");
    addBox(props, colliders, x + 1.7, z, 1.6, 1.6, 1.6, mats.crate, 0.8, "Crate");
    addBox(props, colliders, x + 0.8, z + 0.3, 1.6, 1.6, 1.6, mats.crate, 2.4, "Crate");
  };

  const addWatchtower = (x: number, z: number) => {
    const g = new THREE.Group();
    g.name = "Watchtower";
    for (const sx of [-2, 2]) {
      for (const sz of [-2, 2]) {
        const leg = new THREE.Mesh(new THREE.BoxGeometry(0.5, 8, 0.5), mats.metal);
        leg.position.set(sx, 4, sz);
        leg.castShadow = true;
        g.add(leg);
      }
    }
    const deck = new THREE.Mesh(new THREE.BoxGeometry(6, 0.4, 6), mats.concrete);
    deck.position.y = 8.2;
    deck.castShadow = true;
    deck.receiveShadow = true;
    g.add(deck);
    const rails: Array<[number, number, number, number]> = [
      [0, -3, 6, 0.3],
      [0, 3, 6, 0.3],
      [-3, 0, 0.3, 6],
      [3, 0, 0.3, 6],
    ];
    for (const [rx, rz, rw, rd] of rails) {
      const rail = new THREE.Mesh(new THREE.BoxGeometry(rw, 1.1, rd), mats.metal);
      rail.position.set(rx, 8.95, rz);
      g.add(rail);
    }
    g.position.set(x, 0, z);
    props.add(g);
    colliders.push({
      min: new THREE.Vector2(x - 2.4, z - 2.4),
      max: new THREE.Vector2(x + 2.4, z + 2.4),
      height: 8,
    });
  };

  // ---------- Center structure ----------
  addBox(structure, colliders, 0, 0, 24, 3.2, 24, mats.concrete, 1.6, "CenterPlatform");
  addBox(structure, colliders, 0, -15, 8, 1.6, 6, mats.concrete, 0.8, "CenterRamp_N");
  addBox(structure, colliders, 0, 15, 8, 1.6, 6, mats.concrete, 0.8, "CenterRamp_S");
  addBox(structure, colliders, -15, 0, 6, 1.6, 8, mats.concrete, 0.8, "CenterRamp_W");
  addBox(structure, colliders, 15, 0, 6, 1.6, 8, mats.concrete, 0.8, "CenterRamp_E");
  const centerPillars: Array<[number, number]> = [
    [-9, -9],
    [9, -9],
    [-9, 9],
    [9, 9],
  ];
  for (const [px, pz] of centerPillars) {
    addBox(structure, colliders, px, pz, 2, 9, 2, mats.metal, 3.2 + 4.5, "CenterPillar");
  }
  addContainer(0, 0, 0, 2, 3.2);
  addBarrel(-6, 6, 3.2);
  addBarrel(-4.8, 6.6, 3.2);
  addBarrel(6, -6, 3.2);

  // ---------- Symmetric prop layout (180° rotational symmetry) ----------
  const half: Array<() => void> = [];
  const mirrored = (fn: (s: number) => void) => {
    half.push(() => fn(1), () => fn(-1));
  };

  mirrored((s) => addContainer(s * -40, s * -42, 0, 0));
  mirrored((s) => addContainer(s * -40, s * -42, 0, 1, 2.9));
  mirrored((s) => addContainer(s * -52, s * -30, Math.PI / 2, 2));
  mirrored((s) => addContainer(s * -26, s * -48, Math.PI / 2, 1));
  mirrored((s) => addContainer(s * -14, s * -34, 0, 2));
  mirrored((s) => addContainer(s * -34, s * -12, Math.PI / 2, 0));
  mirrored((s) => addContainer(s * -56, s * -8, 0, 1, 0, false));
  mirrored((s) => addContainer(s * -8, s * -58, Math.PI / 2, 0, 0, false));
  mirrored((s) => addContainer(s * -20, s * -18, Math.PI / 4, 2, 0, false));
  mirrored((s) => addContainer(s * 30, s * -50, 0, 0));
  mirrored((s) => addContainer(s * 30, s * -50, 0, 2, 2.9, false));
  mirrored((s) => addContainer(s * 50, s * -28, Math.PI / 2, 1));

  mirrored((s) => addCrateStack(s * -30, s * -36));
  mirrored((s) => addCrateStack(s * -46, s * -16));
  mirrored((s) => addCrateStack(s * -18, s * -52));
  mirrored((s) => addCrateStack(s * 22, s * -40));

  mirrored((s) => addBarrel(s * -36, s * -26));
  mirrored((s) => addBarrel(s * -34.8, s * -25.2));
  mirrored((s) => addBarrel(s * -35.6, s * -27.4));
  mirrored((s) => addBarrel(s * -12, s * -46));
  mirrored((s) => addBarrel(s * -13.1, s * -46.6));
  mirrored((s) => addBarrel(s * 40, s * -20));
  mirrored((s) => addBarrel(s * 41.2, s * -20.7));

  // concrete blast walls / sandbag lines
  mirrored((s) => {
    addBox(structure, colliders, s * -24, s * -26, 14, 3.4, 1.2, mats.concrete, 1.7, "BlastWall");
  });
  mirrored((s) => {
    addBox(structure, colliders, s * -48, s * -46, 1.2, 3.4, 14, mats.concrete, 1.7, "BlastWall");
  });
  mirrored((s) => {
    addBox(structure, colliders, s * 44, s * -8, 1.2, 4.2, 18, mats.concrete, 2.1, "BlastWall");
  });
  mirrored((s) => {
    addBox(structure, colliders, s * -10, s * -24, 10, 1.2, 1.2, mats.crate, 0.6, "LowCover");
  });

  // watchtowers on opposing flanks
  mirrored((s) => addWatchtower(s * -55, s * 46));

  for (const fn of half) fn();

  // ---------- Spawn points (exported in the GLB) ----------
  const spawnDefs: Array<{ name: string; pos: THREE.Vector3; team: "blue" | "red"; yaw: number }> = [
    { name: "SPAWN_BLUE_1", pos: new THREE.Vector3(-58, 0, -58), team: "blue", yaw: Math.PI * 0.25 },
    { name: "SPAWN_BLUE_2", pos: new THREE.Vector3(-46, 0, -62), team: "blue", yaw: Math.PI * 0.25 },
    { name: "SPAWN_RED_1", pos: new THREE.Vector3(58, 0, 58), team: "red", yaw: Math.PI * 1.25 },
    { name: "SPAWN_RED_2", pos: new THREE.Vector3(46, 0, 62), team: "red", yaw: Math.PI * 1.25 },
  ];

  const spawns = spawnDefs.map((s) => {
    const marker = new THREE.Group();
    marker.name = s.name;
    marker.position.set(s.pos.x, 0, s.pos.z);
    marker.rotation.y = s.yaw;
    marker.userData = {
      type: "spawn_point",
      team: s.team,
      index: s.name.endsWith("1") ? 1 : 2,
      yaw: s.yaw,
    };

    const mat = s.team === "blue" ? mats.blue : mats.red;
    const pad = new THREE.Mesh(new THREE.CylinderGeometry(2.6, 2.6, 0.16, 28), mat);
    pad.position.y = 0.09;
    pad.receiveShadow = true;
    pad.name = `${s.name}_Pad`;
    marker.add(pad);

    const ring = new THREE.Mesh(new THREE.TorusGeometry(3.1, 0.1, 8, 44), mat);
    ring.rotation.x = -Math.PI / 2;
    ring.position.y = 0.14;
    ring.name = `${s.name}_Ring`;
    marker.add(ring);

    // facing arrow so engines can read spawn orientation
    const arrow = new THREE.Mesh(new THREE.ConeGeometry(0.7, 2, 4), mat);
    arrow.rotation.set(Math.PI / 2, 0, Math.PI / 4);
    arrow.position.set(0, 0.2, -3.6);
    arrow.name = `${s.name}_Facing`;
    marker.add(arrow);

    // beacon pole for visibility
    const pole = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 5, 8), mat);
    pole.position.y = 2.5;
    marker.add(pole);

    spawnGroup.add(marker);
    return { pos: s.pos.clone(), team: s.team, name: s.name, yaw: s.yaw };
  });

  // team staging cover next to each spawn
  for (const s of spawns) {
    const sx = Math.sign(s.pos.x);
    addBox(
      structure,
      colliders,
      s.pos.x + sx * 6,
      s.pos.z,
      1.2,
      3,
      8,
      mats.concrete,
      1.5,
      "SpawnCover",
    );
  }

  group.userData = {
    arenaSize: ARENA,
    roofHeight: ROOF_H,
    spawns: spawns.map((s) => ({
      name: s.name,
      team: s.team,
      position: [s.pos.x, 0, s.pos.z],
      yaw: s.yaw,
    })),
  };

  return { group, colliders, spawns, size: ARENA, roofGroup };
}

export function resolveCollisions(pos: THREE.Vector3, colliders: Box[], radius = 0.5) {
  for (const c of colliders) {
    if (c.height < 1.0) continue;
    const closestX = Math.max(c.min.x, Math.min(pos.x, c.max.x));
    const closestZ = Math.max(c.min.y, Math.min(pos.z, c.max.y));
    const dx = pos.x - closestX;
    const dz = pos.z - closestZ;
    const dist2 = dx * dx + dz * dz;
    if (dist2 < radius * radius) {
      const dist = Math.sqrt(dist2) || 0.0001;
      const push = (radius - dist) / dist;
      pos.x += dx * push;
      pos.z += dz * push;
    }
  }
}

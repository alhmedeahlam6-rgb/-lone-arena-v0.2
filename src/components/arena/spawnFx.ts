import * as THREE from "three";

export type SpawnFx = {
  group: THREE.Group;
  update: (dt: number) => void;
  /** play the effect for a moment at a given world position */
  burst: (at?: THREE.Vector3) => void;
  dispose: () => void;
};

/** short, snappy teleport-in effect */
const LIFETIME = 1.6;
const COUNT = 110;

let sharedSprite: THREE.Texture | null = null;
function sprite() {
  if (sharedSprite) return sharedSprite;
  const size = 64;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.45, "rgba(255,255,255,0.45)");
  g.addColorStop(1, "rgba(255,255,255,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedSprite = tex;
  return tex;
}

const VERT = /* glsl */ `
uniform float uProgress;
uniform float uPixelRatio;
attribute float aSeed;
attribute float aAngle;
attribute float aRadius;
attribute float aSize;
varying float vLife;

void main() {
  float p = clamp(uProgress + aSeed * 0.25, 0.0, 1.0);
  vLife = p;
  // particles sweep upward while the radius tightens toward the fighter
  float y = 4.6 * p;
  float r = aRadius * (1.0 - p * 0.75);
  float a = aAngle + p * 2.6;
  vec3 pos = vec3(cos(a) * r, y, sin(a) * r);
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = aSize * uPixelRatio * (200.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uOpacity;
varying float vLife;

void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  if (tex.a < 0.02) discard;
  vec3 col = mix(uColorA, uColorB, vLife);
  float fade = smoothstep(0.0, 0.1, vLife) * (1.0 - smoothstep(0.55, 1.0, vLife));
  gl_FragColor = vec4(col, tex.a * fade * uOpacity);
}
`;

const COLUMN_VERT = /* glsl */ `
uniform float uTime;
uniform float uProgress;
varying vec2 vUv;
varying float vY;

void main() {
  vec3 pos = position;
  float h = pos.y + 3.0;
  float pulse = sin(h * 4.0 - uTime * 12.0) * 0.18 * (1.0 - uProgress);
  float radius = 1.0 + pulse + uProgress * 0.4;
  pos.x *= radius;
  pos.z *= radius;

  float twist = uTime * 2.2 + h * 0.9;
  float c = cos(twist);
  float s = sin(twist);
  pos.xz = mat2(c, -s, s, c) * pos.xz;

  vUv = uv;
  vY = pos.y;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

const COLUMN_FRAG = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
uniform float uTime;
varying vec2 vUv;
varying float vY;

void main() {
  float fade = smoothstep(-3.0, -2.2, vY) * (1.0 - smoothstep(2.2, 3.0, vY));
  float scan = 0.5 + 0.5 * sin(vY * 10.0 - uTime * 14.0);
  float rim = 1.0 - abs(vUv.x - 0.5) * 2.0;
  gl_FragColor = vec4(uColor, uOpacity * fade * (0.5 + 0.5 * scan) * rim);
}
`;

/**
 * One lightweight instance per fighter. It is hidden and does no work until
 * `burst()` is called, and it turns itself off again after ~1.6s.
 */
export function createSpawnFx(kind: "water" | "fire", at: THREE.Vector3): SpawnFx {
  const isFire = kind === "fire";
  const group = new THREE.Group();
  group.position.copy(at);
  group.visible = false;

  const colorA = new THREE.Color(isFire ? 0xffe6b0 : 0xf2fbff);
  const colorB = new THREE.Color(isFire ? 0xff5a12 : 0x5fb6e8);
  const coreColor = new THREE.Color(isFire ? 0xff4500 : 0x00bfff);

  // ---- particle burst ----
  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  const angle = new Float32Array(COUNT);
  const rad = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    seed[i] = Math.random();
    angle[i] = Math.random() * Math.PI * 2;
    rad[i] = 0.6 + Math.random() * 1.6;
    size[i] = 5 + Math.random() * 10;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aAngle", new THREE.BufferAttribute(angle, 1));
  geo.setAttribute("aRadius", new THREE.BufferAttribute(rad, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uProgress: { value: 0 },
      uPixelRatio: { value: Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 2) },
      uMap: { value: sprite() },
      uColorA: { value: colorA },
      uColorB: { value: colorB },
      uOpacity: { value: 0.85 },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  group.add(pts);

  // ---- vertical energy column ----
  const colGeo = new THREE.CylinderGeometry(0.65, 0.85, 6, 32, 24, true);
  const colMat = new THREE.ShaderMaterial({
    uniforms: {
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uColor: { value: coreColor },
      uOpacity: { value: 0.75 },
    },
    vertexShader: COLUMN_VERT,
    fragmentShader: COLUMN_FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
  });
  const column = new THREE.Mesh(colGeo, colMat);
  column.position.y = 3;
  column.frustumCulled = false;
  group.add(column);

  // ---- ground splash / ember ring ----
  const ringMat = new THREE.MeshBasicMaterial({
    color: isFire ? 0xff7a2b : 0x9fd8f5,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.95, 40), ringMat);
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.08;
  ring.frustumCulled = false;
  group.add(ring);

  // ---- rising vertical ember ring ----
  const riseMat = new THREE.MeshBasicMaterial({
    color: isFire ? 0xffa85c : 0xc2ecff,
    transparent: true,
    opacity: 0,
    side: THREE.DoubleSide,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });
  const riseRing = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.15, 40), riseMat);
  riseRing.position.y = 0.5;
  riseRing.frustumCulled = false;
  group.add(riseRing);

  // ---- flicker light ----
  const light = new THREE.PointLight(isFire ? 0xff7a20 : 0x8fd4f2, 0, 18, 2);
  light.position.y = 1.6;
  group.add(light);

  let life = 0;
  let time = 0;

  const update = (dt: number) => {
    if (life <= 0) {
      if (group.visible) group.visible = false;
      return;
    }
    life = Math.max(0, life - dt);
    time += dt;
    const p = 1 - life / LIFETIME;
    const env = Math.min(1, (1 - p) * 2.4);

    mat.uniforms["uProgress"]!.value = p;
    mat.uniforms["uOpacity"]!.value = 0.85 * env;

    colMat.uniforms["uTime"]!.value = time;
    colMat.uniforms["uProgress"]!.value = p;
    colMat.uniforms["uOpacity"]!.value = 0.85 * (1 - p) * env;
    column.scale.setScalar(1 + p * 0.5);

    ring.scale.setScalar(1 + p * 2.8);
    ringMat.opacity = (1 - p) * 0.4;

    riseRing.position.y = 0.5 + p * 3.8;
    riseRing.scale.setScalar(1 + p * 1.6);
    riseMat.opacity = Math.sin(p * Math.PI) * 0.45;

    light.intensity = 11 * env * (0.82 + Math.sin(time * 18) * 0.18 + Math.cos(time * 31) * 0.08);

    if (life <= 0) group.visible = false;
  };

  return {
    group,
    update,
    burst: (pos?: THREE.Vector3) => {
      if (pos) group.position.copy(pos);
      life = LIFETIME;
      time = 0;
      mat.uniforms["uProgress"]!.value = 0;
      colMat.uniforms["uProgress"]!.value = 0;
      group.visible = true;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
      colGeo.dispose();
      colMat.dispose();
      ring.geometry.dispose();
      ringMat.dispose();
      riseRing.geometry.dispose();
      riseMat.dispose();
    },
  };
}

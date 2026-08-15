import * as THREE from "three";

export type ImpactFx = {
  group: THREE.Group;
  isActive: () => boolean;
  update: (dt: number) => void;
  burst: (at: THREE.Vector3, color?: THREE.Color) => void;
  dispose: () => void;
};

const LIFETIME = 0.35;
const COUNT = 16;

let sharedSprite: THREE.Texture | null = null;
function sprite() {
  if (sharedSprite) return sharedSprite;
  const size = 32;
  const c = document.createElement("canvas");
  c.width = c.height = size;
  const ctx = c.getContext("2d")!;
  const g = ctx.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
  g.addColorStop(0, "rgba(255,255,255,1)");
  g.addColorStop(0.55, "rgba(255,220,160,0.5)");
  g.addColorStop(1, "rgba(255,220,160,0)");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, size, size);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  sharedSprite = tex;
  return tex;
}

const VERT = /* glsl */ `
attribute vec3 aVelocity;
attribute float aSeed;
attribute float aSize;
uniform float uTime;
uniform float uProgress;
uniform float uPixelRatio;
varying float vLife;

void main() {
  float t = clamp(uProgress + aSeed * 0.15, 0.0, 1.0);
  vLife = 1.0 - t;
  vec3 pos = position + aVelocity * t * 2.5;
  pos.y -= t * t * 1.8;
  vec4 mv = modelViewMatrix * vec4(pos, 1.0);
  gl_PointSize = aSize * uPixelRatio * (120.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}
`;

const FRAG = /* glsl */ `
uniform sampler2D uMap;
uniform vec3 uColor;
uniform float uOpacity;
varying float vLife;

void main() {
  vec4 tex = texture2D(uMap, gl_PointCoord);
  if (tex.a < 0.02) discard;
  float fade = smoothstep(0.0, 0.15, vLife) * (1.0 - smoothstep(0.4, 1.0, vLife));
  gl_FragColor = vec4(uColor, tex.a * fade * uOpacity);
}
`;

export function createImpactFx(): ImpactFx {
  // NOTE: the group stays visible forever on purpose. Toggling visibility of a
  // group that holds a light changes the scene light count, which forces three
  // to recompile every material — that is what caused the hitch on each shot.
  const group = new THREE.Group();

  const geo = new THREE.BufferGeometry();
  const positions = new Float32Array(COUNT * 3);
  const velocity = new Float32Array(COUNT * 3);
  const seed = new Float32Array(COUNT);
  const size = new Float32Array(COUNT);
  for (let i = 0; i < COUNT; i++) {
    const theta = Math.random() * Math.PI * 2;
    const phi = Math.random() * Math.PI;
    const speed = (0.6 + Math.random() * 1.4) / 3;
    velocity[i * 3] = Math.sin(phi) * Math.cos(theta) * speed;
    velocity[i * 3 + 1] = Math.cos(phi) * speed;
    velocity[i * 3 + 2] = Math.sin(phi) * Math.sin(theta) * speed;
    seed[i] = Math.random();
    size[i] = (3 + Math.random() * 5) / 3;
  }
  geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  geo.setAttribute("aVelocity", new THREE.BufferAttribute(velocity, 3));
  geo.setAttribute("aSeed", new THREE.BufferAttribute(seed, 1));
  geo.setAttribute("aSize", new THREE.BufferAttribute(size, 1));

  const mat = new THREE.ShaderMaterial({
    uniforms: {
      uMap: { value: sprite() },
      uColor: { value: new THREE.Color(0xffe08a) },
      uOpacity: { value: 0.9 },
      uTime: { value: 0 },
      uProgress: { value: 0 },
      uPixelRatio: { value: Math.min(typeof window === "undefined" ? 1 : window.devicePixelRatio, 2) },
    },
    vertexShader: VERT,
    fragmentShader: FRAG,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
  });

  const pts = new THREE.Points(geo, mat);
  pts.frustumCulled = false;
  pts.visible = false;
  group.add(pts);

  const flash = new THREE.PointLight(0xffa040, 0, 8 / 3, 1.5);
  flash.position.set(0, 0, 0);
  group.add(flash);

  let life = 0;
  let time = 0;

  return {
    group,
    isActive: () => life > 0,
    update: (dt: number) => {
      if (life <= 0) {
        if (pts.visible) pts.visible = false;
        if (flash.intensity !== 0) flash.intensity = 0;
        return;
      }
      life = Math.max(0, life - dt);
      time += dt;
      const p = 1 - life / LIFETIME;
      mat.uniforms["uProgress"]!.value = p;
      mat.uniforms["uTime"]!.value = time;
      flash.intensity = Math.max(0, (1 - p) * (5 / 3));
      if (life <= 0) {
        pts.visible = false;
        flash.intensity = 0;
      }
    },
    burst: (at: THREE.Vector3, color?: THREE.Color) => {
      group.position.copy(at);
      if (color) mat.uniforms["uColor"]!.value.copy(color);
      else mat.uniforms["uColor"]!.value.setHex(0xffe08a);
      life = LIFETIME;
      time = 0;
      mat.uniforms["uProgress"]!.value = 0;
      pts.visible = true;
    },
    dispose: () => {
      geo.dispose();
      mat.dispose();
    },
  };
}

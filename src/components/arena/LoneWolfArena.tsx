import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import { GLTFLoader } from "three/examples/jsm/loaders/GLTFLoader.js";
import { Skull, Volume2, VolumeX, Maximize, Minimize } from "lucide-react";
import { createSpawnFx, type SpawnFx } from "./spawnFx";
import { createImpactFx, type ImpactFx } from "./impactFx";
import { saveMatchResult, getLeaderboard } from "@/lib/arena.functions";
import { initSfx, playSfx, playSfxAt, warmSfx, suspendSfx, resumeSfx, setSfxMuted, isSfxMuted } from "./sfx";
import WeaponShop from "./WeaponShop";
import WeaponSlots from "./WeaponSlots";
import Minimap, { type MapGrid, type RadarState } from "./Minimap";
import {
  WEAPONS,
  STARTING_CREDITS,
  isHeavy,
  getWeapon,
  getWeaponDamage,
  getWeaponRange,
  getWeaponFireInterval,
  getWeaponBehavior,
  getMagazine,
  getReserveAmmo,
  getReloadTime,
  type Weapon,
} from "./weapons";



type Mode = "orbit" | "walk";
type Team = "blue" | "red";

type SpawnPoint = {
  name: string;
  team: Team;
  /** top-middle of the spawn pad — where a fighter stands */
  top: THREE.Vector3;
};

const TEAM_COLORS: Record<Team, number> = {
  blue: 0x3f8fff,
  red: 0xff3b1f,
};

const PLAYER_RADIUS = 0.7;
const EYE_HEIGHT = 1.7;
const STEP_UP = 0.55; // anything taller must be jumped
const GRAVITY = 24;
const JUMP_SPEED = 8.2;
const MAX_HP = 100;
const PLAYER_DAMAGE = 34;
const BOT_DAMAGE = 9;
const RESPAWN_SECONDS = 3;
const KILLS_TO_WIN_ROUND = 10;
const ROUNDS_TO_WIN_MATCH = 2;
const FIRE_COOLDOWN = 0.18;
const MUZZLE_FLASH_LIFE = 0.06;
const RECOIL_RECOVERY = 4.0;
const INTERMISSION_SECONDS = 5;
const MATCH_END_SECONDS = 5;
const COUNTDOWN_SECONDS = 10;
const SPAWN_BOX_HALF = 1.5; // 3m wide spawn cage
const SPAWN_BOX_HEIGHT = 5;


type Fighter = {
  id: string;
  team: Team;
  isHuman: boolean;
  group: THREE.Group | null;
  meshes: THREE.Mesh[];
  hp: number;
  alive: boolean;
  respawnIn: number;
  home: SpawnPoint;
  /** feet position */
  pos: THREE.Vector3;
  cooldown: number;
  tracer: { line: THREE.Line; mat: THREE.LineBasicMaterial; ttl: number } | null;
  /** personal spawn-in effect, played at this fighter's own spot */
  fx: SpawnFx | null;
  /** weapon id used for damage/fire-rate calculations */
  weapon: string;
};

type HudFighter = { id: string; team: Team; hp: number; alive: boolean; isHuman: boolean };

type MatchPhase = "warmup" | "countdown" | "round" | "intermission" | "matchEnd";

type KillFeedItem = {
  id: string;
  killer: string;
  killerTeam: Team;
  victim: string;
  victimTeam: Team;
  weapon: string;
  time: number;
};


type LeaderboardEntry = {
  winner: string;
  player_team: string;
  player_kills: number;
  player_deaths: number;
  blue_score: number;
  red_score: number;
};

type LeaderboardTotals = {
  recent: LeaderboardEntry[];
  totals: Record<string, { wins: number; losses: number; kills: number; deaths: number }>;
};



function buildBot(team: Team, label: string) {
  const g = new THREE.Group();
  const color = TEAM_COLORS[team];
  const meshes: THREE.Mesh[] = [];

  const bodyMat = new THREE.MeshStandardMaterial({ color, roughness: 0.55, metalness: 0.15 });
  const gearMat = new THREE.MeshStandardMaterial({ color: 0x2b2f36, roughness: 0.8, metalness: 0.2 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc79a72, roughness: 0.9 });

  const legs = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 12), gearMat);
  legs.position.y = 0.52;
  const torso = new THREE.Mesh(new THREE.CapsuleGeometry(0.3, 0.5, 4, 14), bodyMat);
  torso.position.y = 1.15;
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.19, 18, 14), skinMat);
  head.position.y = 1.62;
  const helmet = new THREE.Mesh(
    new THREE.SphereGeometry(0.215, 18, 14, 0, Math.PI * 2, 0, Math.PI * 0.55),
    new THREE.MeshStandardMaterial({ color, roughness: 0.35, metalness: 0.5 }),
  );
  helmet.position.y = 1.63;
  const gun = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.14, 0.85), gearMat);
  gun.position.set(0.26, 1.12, -0.42);

  for (const m of [legs, torso, head, helmet, gun]) {
    m.castShadow = true;
    m.receiveShadow = true;
    g.add(m);
    meshes.push(m);
  }

  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.45, 0.62, 32),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  g.add(ring);

  g.name = label;
  return { group: g, meshes };
}

export default function LoneWolfArena() {
  const mountRef = useRef<HTMLDivElement | null>(null);
  const [mode, setMode] = useState<Mode>("walk");
  const [intro, setIntro] = useState(true);

  const [showDebug, setShowDebug] = useState(false);
  const [status, setStatus] = useState("Loading map…");
  const [showRoof, setShowRoof] = useState(true);
  const [hud, setHud] = useState<HudFighter[]>([]);
  const [score, setScore] = useState<Record<Team, number>>({ blue: 0, red: 0 });
  const [playerHp, setPlayerHp] = useState(MAX_HP);
  const [playerRespawn, setPlayerRespawn] = useState(0);
  const [match, setMatch] = useState({
    blue: 0,
    red: 0,
    phase: "warmup" as MatchPhase,
    round: 1,
    roundWinner: null as Team | null,
    matchWinner: null as Team | null,
    countdown: 0,
  });
  const [killFeed, setKillFeed] = useState<KillFeedItem[]>([]);
  const [weaponReady, setWeaponReady] = useState(true);
  const [hitMarker, setHitMarker] = useState(0);
  const [leaderboard, setLeaderboard] = useState<LeaderboardTotals | null>(null);
  const [orbitLeaderboard, setOrbitLeaderboard] = useState<LeaderboardTotals | null>(null);
  const [shopOpen, setShopOpen] = useState(false);
  const [credits, setCredits] = useState(STARTING_CREDITS);
  const [owned, setOwned] = useState<string[]>(["deagle"]);
  // Loadout: [heavy 1, heavy 2, sidearm (pistol or knife)]
  const [slots, setSlots] = useState<(string | null)[]>([null, null, "deagle"]);
  const [activeSlot, setActiveSlot] = useState(2);
  const [ammo, setAmmo] = useState<Record<string, { mag: number; reserve: number }>>({
    deagle: { mag: 7, reserve: 21 },
  });
  const [isReloading, setIsReloading] = useState(false);
  const [reloadLeft, setReloadLeft] = useState(0);
  const [showOnboarding, setShowOnboarding] = useState(true);
  const [sfxReady, setSfxReady] = useState(false);
  const [playerStatsHud, setPlayerStatsHud] = useState({ kills: 0, deaths: 0 });
  const [paused, setPaused] = useState(false);
  const [muted, setMuted] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);



  const showRoofRef = useRef(true);
  const clipRef = useRef<{ renderer: THREE.WebGLRenderer; plane: THREE.Plane } | null>(null);
  const modeRef = useRef<Mode>("walk");
  const collidersRef = useRef<THREE.Mesh[]>([]);
  const startMatchRef = useRef<(() => void) | null>(null);
  const laserRef = useRef<{
    line: THREE.Line;
    material: THREE.LineBasicMaterial;
    spark: THREE.PointLight;
    sparkMesh: THREE.Mesh;
    ttl: number;
  } | null>(null);
  const muzzleRef = useRef<{
    light: THREE.PointLight;
    mesh: THREE.Mesh;
    ttl: number;
  } | null>(null);
  const recoilRef = useRef(0);
  const recoilYawRef = useRef(0);
  const weaponCooldownRef = useRef(0);
  const hitMarkerRef = useRef(0);
  const weaponRef = useRef<string>("deagle");
  const matchRef = useRef({
    blue: 0,
    red: 0,
    phase: "warmup" as MatchPhase,
    round: 1,
    roundWinner: null as Team | null,
    matchWinner: null as Team | null,
    countdown: 0,
  });
  const killFeedRef = useRef<KillFeedItem[]>([]);
  const intermissionRef = useRef(0);
  const countdownRef = useRef(0);
  const shakeRef = useRef(0);
  const spawnCageRef = useRef<{ mesh: THREE.Object3D; center: THREE.Vector3 } | null>(null);
  const saveSentRef = useRef(false);
  const introRef = useRef(0);
  const ammoRef = useRef<Record<string, { mag: number; reserve: number }>>({
    deagle: { mag: 7, reserve: 21 },
  });
  const isReloadingRef = useRef(false);
  const reloadTimerRef = useRef(0);
  const reloadingWeaponRef = useRef<string | null>(null);
  const startReloadRef = useRef<(id: string) => void>(() => {});
  const mouseHeldRef = useRef(false);
  const burstQueueRef = useRef<{ shotsLeft: number; nextIn: number } | null>(null);
  const sfxInitializedRef = useRef(false);
  const crosshairRef = useRef<HTMLDivElement>(null);
  const vignetteRef = useRef<HTMLDivElement>(null);
  const damageFlashRef = useRef(0);
  const radarRef = useRef<RadarState>({ fighters: [], player: null });
  const mapGridRef = useRef<MapGrid | null>(null);




  modeRef.current = mode;

  useEffect(() => {
    const nextWeapon = (slots[activeSlot] ?? "deagle") as string;
    if (weaponRef.current !== nextWeapon && isReloadingRef.current && reloadingWeaponRef.current !== nextWeapon) {
      // cancel reload when switching away from the weapon being reloaded
      isReloadingRef.current = false;
      reloadingWeaponRef.current = null;
      reloadTimerRef.current = 0;
      setIsReloading(false);
      setReloadLeft(0);
    }
    weaponRef.current = nextWeapon;
  }, [slots, activeSlot]);


  useEffect(() => {
    ammoRef.current = ammo;
  }, [ammo]);

  useEffect(() => {
    isReloadingRef.current = isReloading;
  }, [isReloading]);




  useEffect(() => {
    getLeaderboard()
      .then((res) => setOrbitLeaderboard(res))
      .catch(() => {});

    const mount = mountRef.current;
    if (!mount) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0d1117);
    scene.fog = new THREE.Fog(0x0d1117, 160, 520);

    const camera = new THREE.PerspectiveCamera(70, mount.clientWidth / mount.clientHeight, 0.1, 2000);

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.26; // +20% brighter overall
    mount.appendChild(renderer.domElement);

    // ---- Lighting rig (all intensities +20%) ----
    scene.add(new THREE.HemisphereLight(0x9fc6ff, 0x7a8a9a, 1.62));

    const sun = new THREE.DirectionalLight(0xffd9a0, 2.52);
    sun.position.set(90, 120, 60);
    sun.castShadow = true;
    sun.shadow.mapSize.set(2048, 2048);
    const s = 110;
    sun.shadow.camera.left = -s;
    sun.shadow.camera.right = s;
    sun.shadow.camera.top = s;
    sun.shadow.camera.bottom = -s;
    sun.shadow.camera.far = 400;
    sun.shadow.bias = -0.0006;
    scene.add(sun);

    const fill = new THREE.DirectionalLight(0x7fa8ff, 0.78);
    fill.position.set(-80, 60, -70);
    scene.add(fill);

    const groundFill = new THREE.PointLight(0xffc48a, 2.64, 260, 1.5);
    groundFill.position.set(0, 8, 0);
    scene.add(groundFill);

    scene.add(new THREE.AmbientLight(0xffffff, 0.66));

    const clipPlane = new THREE.Plane(new THREE.Vector3(0, -1, 0), 20);
    renderer.localClippingEnabled = true;

    const root = new THREE.Group();
    scene.add(root);

    // ---- Player laser ----
    const laserGeo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(),
      new THREE.Vector3(),
    ]);
    const laserMat = new THREE.LineBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 });
    const laserLine = new THREE.Line(laserGeo, laserMat);
    laserLine.frustumCulled = false;
    root.add(laserLine);

    const sparkMesh = new THREE.Mesh(
      new THREE.SphereGeometry(0.12, 8, 8),
      new THREE.MeshBasicMaterial({ color: 0xffe08a, transparent: true, opacity: 0 }),
    );
    sparkMesh.visible = false;
    root.add(sparkMesh);

    const sparkLight = new THREE.PointLight(0xffa040, 0, 12, 2);
    sparkLight.position.set(0, -1000, 0);
    root.add(sparkLight);

    laserRef.current = { line: laserLine, material: laserMat, spark: sparkLight, sparkMesh, ttl: 0 };

    // ---- Muzzle flash ----
    const muzzleGeo = new THREE.SphereGeometry(0.18, 12, 12);
    const muzzleMat = new THREE.MeshBasicMaterial({ color: 0xffe8a0, transparent: true, opacity: 0 });
    const muzzleMesh = new THREE.Mesh(muzzleGeo, muzzleMat);
    muzzleMesh.visible = false;
    root.add(muzzleMesh);
    const muzzleLight = new THREE.PointLight(0xffa040, 0, 18, 2);
    muzzleLight.position.set(0, -1000, 0);
    root.add(muzzleLight);
    muzzleRef.current = { light: muzzleLight, mesh: muzzleMesh, ttl: 0 };

    // ---- impact spark pool ----
    const impactPool: ImpactFx[] = [];
    for (let i = 0; i < 4; i++) {
      const fx = createImpactFx();
      root.add(fx.group);
      impactPool.push(fx);
    }
    const spawnImpact = (at: THREE.Vector3, color?: THREE.Color) => {
      const fx = impactPool.find((f) => f.group.visible === false) ?? impactPool[0]!;
      fx.burst(at, color);
    };

    // ---- state ----

    let theta = Math.PI * 0.25;
    let phi = 0.85;
    let radius = 190;
    const target = new THREE.Vector3(0, 6, 0);

    const walkPos = new THREE.Vector3(-50, 0, -66); // FEET position
    let velY = 0;
    let grounded = false;
    let yaw = Math.PI * 0.75;
    let pitch = 0;
    const keys = new Set<string>();

    const fighters: Fighter[] = [];
    const fxList: SpawnFx[] = [];
    let human: Fighter | null = null;
    let humanBody: { group: THREE.Group; meshes: THREE.Mesh[] } | null = null;

    const scoreState: Record<Team, number> = { blue: 0, red: 0 };
    const playerStats = { kills: 0, deaths: 0 };


    const syncHud = () => {
      setHud(
        fighters.map((f) => ({
          id: f.id,
          team: f.team,
          hp: Math.max(0, Math.round(f.hp)),
          alive: f.alive,
          isHuman: f.isHuman,
        })),
      );
      setScore({ ...scoreState });
      if (human) {
        setPlayerHp(Math.max(0, Math.round(human.hp)));
        setPlayerRespawn(human.alive ? 0 : Math.ceil(human.respawnIn));
      }
    };

    let dragging = false;
    let lastX = 0;
    let lastY = 0;

    const onPointerDown = (e: PointerEvent) => {
      if (modeRef.current !== "orbit") return;
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onPointerUp = () => (dragging = false);

    const raycaster = new THREE.Raycaster();
    const down = new THREE.Vector3(0, -1, 0);
    const scratch = new THREE.Vector3();

    const enemyMeshes = (team: Team) =>
      fighters.filter((f) => f.team !== team && f.alive && f.group).flatMap((f) => f.meshes);

    const fighterByMesh = (mesh: THREE.Object3D) => {
      for (const f of fighters) if (f.meshes.includes(mesh as THREE.Mesh)) return f;
      return null;
    };

    const groundAt = (x: number, z: number, fromY: number) => {
      const colliders = collidersRef.current;
      if (colliders.length === 0) return null;
      raycaster.set(scratch.set(x, fromY + 6, z), down);
      raycaster.far = 40;
      const hits = raycaster.intersectObjects(colliders, false);
      return hits.length > 0 && hits[0] ? hits[0].point.y : null;
    };

    const pushKillFeed = (killer: Fighter, victim: Fighter, weaponName = "Rifle") => {
      const item: KillFeedItem = {
        id: Math.random().toString(36).slice(2),
        killer: killer.isHuman ? "YOU" : killer.id,
        killerTeam: killer.team,
        victim: victim.isHuman ? "YOU" : victim.id,
        victimTeam: victim.team,
        weapon: weaponName,
        time: 5,
      };
      killFeedRef.current = [item, ...killFeedRef.current].slice(0, 6);
      setKillFeed(killFeedRef.current);
    };


    const endRound = (winner: Team) => {
      const m = matchRef.current;
      m[winner] += 1;
      m.phase = m[winner] >= ROUNDS_TO_WIN_MATCH ? "matchEnd" : "intermission";
      m.roundWinner = winner;
      m.matchWinner = m[winner] >= ROUNDS_TO_WIN_MATCH ? winner : null;
      m.countdown = m.matchWinner ? MATCH_END_SECONDS : INTERMISSION_SECONDS;
      intermissionRef.current = m.countdown;
      setMatch({ ...m });
      syncHud();
      const playerTeam = human?.team ?? "blue";
      if (m.matchWinner === playerTeam) playSfx("victory", 0.9);
      if (m.matchWinner) {

        if (!saveSentRef.current) {
          saveSentRef.current = true;
          saveMatchResult({
            data: {
              blue_score: m.blue,
              red_score: m.red,
              winner: m.matchWinner,
              player_team: human?.team ?? "blue",
              player_kills: playerStats.kills,
              player_deaths: playerStats.deaths,
            },
          }).catch(() => {});
          getLeaderboard()
            .then((res) => setLeaderboard(res))
            .catch(() => {});

        }
        setTimeout(() => {
          saveSentRef.current = false;
          startMatch();
        }, MATCH_END_SECONDS * 1000);
      } else {
        setTimeout(() => startNewRound(), INTERMISSION_SECONDS * 1000);
      }
    };

    const startNewRound = () => {
      scoreState.blue = 0;
      scoreState.red = 0;
      matchRef.current.phase = "countdown";
      matchRef.current.roundWinner = null;
      matchRef.current.countdown = COUNTDOWN_SECONDS;
      matchRef.current.round += 1;
      countdownRef.current = COUNTDOWN_SECONDS;
      setMatch({ ...matchRef.current });
      for (const f of fighters) respawn(f, true);
      syncHud();
    };

    const kill = (victim: Fighter, killer: Fighter) => {
      victim.alive = false;
      victim.hp = 0;
      victim.respawnIn = RESPAWN_SECONDS;
      if (victim.group) victim.group.visible = false;
      scoreState[killer.team] += 1;
      if (killer.isHuman) playerStats.kills += 1;
      if (victim.isHuman) playerStats.deaths += 1;
      setPlayerStatsHud({ kills: playerStats.kills, deaths: playerStats.deaths });
      if (killer.isHuman || victim.isHuman) playSfx("kill", killer.isHuman ? 0.9 : 0.55);
      pushKillFeed(killer, victim);
      if (scoreState[killer.team] >= KILLS_TO_WIN_ROUND) {
        endRound(killer.team);
      } else {
        syncHud();
      }
    };

    const damage = (victim: Fighter, amount: number, killer: Fighter) => {
      if (!victim.alive) return;
      victim.hp -= amount;
      if (victim.isHuman) damageFlashRef.current = 0.7;
      if (victim.hp <= 0) kill(victim, killer);
      else {
        if (killer.isHuman) {
          hitMarkerRef.current = 0.18;
          setHitMarker(0.18);
          playSfx("hit", 0.85, (Math.random() - 0.5) * 0.08);
        }
        syncHud();
      }
    };


    // the spawn animation is a one-time show at the start of the match
    let spawnFxPlayed = false;
    let introTime = 0;

    const respawn = (f: Fighter, withFx = false) => {
      f.alive = true;
      f.hp = MAX_HP;
      f.respawnIn = 0;
      f.cooldown = 0.8 + Math.random() * 1.2;
      f.pos.copy(f.home.top);
      const gy = groundAt(f.pos.x, f.pos.z, f.pos.y + 4);
      if (gy !== null) f.pos.y = gy;
      // each fighter gets its own effect, played exactly where it lands
      if (withFx) {
        f.fx?.burst(f.pos);
        if (f.isHuman) playSfx("spawn", 0.8);
      }
      if (f.group) {
        f.group.visible = true;
        f.group.position.copy(f.pos);
      }
      if (f.isHuman) {
        if (spawnCageRef.current) {
          spawnCageRef.current.center.copy(f.pos);
          spawnCageRef.current.mesh.position.copy(f.pos).add(new THREE.Vector3(0, SPAWN_BOX_HEIGHT / 2, 0));
        }
        walkPos.copy(f.pos);
        velY = 0;
        grounded = true;
        yaw = Math.atan2(f.pos.x, f.pos.z);
        pitch = 0;
      }
      syncHud();
    };

    const startMatch = () => {
      scoreState.blue = 0;
      scoreState.red = 0;
      matchRef.current = {
        blue: 0,
        red: 0,
        phase: "countdown",
        round: 1,
        roundWinner: null,
        matchWinner: null,
        countdown: COUNTDOWN_SECONDS,
      };
      countdownRef.current = COUNTDOWN_SECONDS;
      killFeedRef.current = [];
      playerStats.kills = 0;
      playerStats.deaths = 0;
      setPlayerStatsHud({ kills: 0, deaths: 0 });
      setMatch(matchRef.current);
      setKillFeed([]);
      saveSentRef.current = false;
      const firstTime = !spawnFxPlayed;
      for (const f of fighters) respawn(f, true);
      if (firstTime) {
        spawnFxPlayed = true;
        introTime = 5;
        introRef.current = 5;
        setIntro(true);
      }

      syncHud();
    };
    startMatchRef.current = startMatch;

    const startReload = (weaponId: string) => {
      if (isReloadingRef.current) return;
      const cur = ammoRef.current[weaponId];
      if (!cur || cur.mag >= getMagazine(weaponId) || cur.reserve <= 0) return;
      isReloadingRef.current = true;
      reloadingWeaponRef.current = weaponId;
      setIsReloading(true);
      reloadTimerRef.current = getReloadTime(weaponId);
      setReloadLeft(reloadTimerRef.current);
      const mode = getWeaponBehavior(weaponId).mode;
      playSfx(mode === "pump" || mode === "bolt" ? "pump" : "reload", 0.75);
    };
    startReloadRef.current = startReload;


    const finishReload = (weaponId: string) => {
      if (!isReloadingRef.current) return;
      const weaponBeingReloaded = reloadingWeaponRef.current ?? weaponId;
      const cur = ammoRef.current[weaponBeingReloaded];
      if (!cur) return;
      const mag = getMagazine(weaponBeingReloaded);
      const need = mag - cur.mag;
      const take = Math.min(need, cur.reserve);
      const next = { ...cur, mag: cur.mag + take, reserve: cur.reserve - take };
      ammoRef.current = { ...ammoRef.current, [weaponBeingReloaded]: next };
      setAmmo(ammoRef.current);
      isReloadingRef.current = false;
      reloadingWeaponRef.current = null;
      setIsReloading(false);
      setReloadLeft(0);
    };


    const RECOIL_PITCH = 0.045;


    const applySpread = (dir: THREE.Vector3, spread: number) => {
      if (spread <= 0) return dir;
      const angle = (Math.random() - 0.5) * 2 * spread;
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 0, 1), dir));
      const right = new THREE.Vector3().crossVectors(dir, up).normalize();
      const y = Math.sin(angle) * (Math.random() < 0.5 ? 1 : -1);
      // cheap cone approximation
      dir.add(right.clone().multiplyScalar((Math.random() - 0.5) * 2 * spread));
      dir.add(up.clone().multiplyScalar((Math.random() - 0.5) * 2 * spread));
      return dir.normalize();
    };

    const shoot = (fromAuto = false) => {
      const colliders = collidersRef.current;
      if (!laserRef.current || !human || !human.alive) return false;
      if (matchRef.current.phase === "countdown") return false;
      if (isReloadingRef.current) return false;
      if (weaponCooldownRef.current > 0) return false;

      const weaponId = weaponRef.current;
      const w = getWeapon(weaponId);
      if (!w) return false;
      const behavior = getWeaponBehavior(weaponId);
      const weaponName = w.name;
      const weaponRange = getWeaponRange(w);
      const weaponDamage = getWeaponDamage(w);

      const currentAmmo = ammoRef.current[weaponId];
      if (currentAmmo && currentAmmo.mag <= 0) {
        // dry click, then auto-reload when empty
        playSfx("dryfire", 0.7);
        startReload(weaponId);
        return false;
      }

      // sound
      if (sfxInitializedRef.current) {
        playSfx(behavior.sound, 1, (Math.random() - 0.5) * 0.04);
        // pump / bolt weapons rack the action right after the shot
        if (behavior.mode === "pump" || behavior.mode === "bolt") {
          window.setTimeout(() => playSfx("pump", 0.65), behavior.cycle * 420);
        }
      }


      weaponCooldownRef.current = getWeaponFireInterval(w);
      setWeaponReady(false);

      const recoilScale = Math.max(0.5, 1.1 - w.fireRate / 200) * behavior.recoil;
      recoilRef.current = Math.min(recoilRef.current + RECOIL_PITCH * recoilScale, 0.32);
      recoilYawRef.current += (Math.random() - 0.5) * 0.035 * recoilScale;
      shakeRef.current = 0.12;

      const origin = camera.position.clone();
      let dir = new THREE.Vector3();
      camera.getWorldDirection(dir);
      applySpread(dir, behavior.spread + recoilRef.current * 0.15);

      const muzzle = muzzleRef.current;
      if (muzzle) {
        muzzle.mesh.position.copy(origin).add(dir.clone().multiplyScalar(0.55));
        muzzle.light.position.copy(muzzle.mesh.position);
        muzzle.mesh.visible = true;
        muzzle.light.intensity = 18;
        muzzle.ttl = 0.06;
      }

      const pellets = Math.max(1, behavior.shots);
      let anyHit = false;

      for (let p = 0; p < pellets; p++) {
        let pelletDir = dir.clone();
        if (pellets > 1) {
          // shotgun pellet spread
          pelletDir.add(new THREE.Vector3((Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08, (Math.random() - 0.5) * 0.08));
          pelletDir.normalize();
        }
        raycaster.set(origin, pelletDir);
        raycaster.far = weaponRange;
        const worldHits = raycaster.intersectObjects(colliders, false);
        const botHits = raycaster.intersectObjects(enemyMeshes(human.team), false);

        const worldDist = worldHits[0]?.distance ?? Infinity;
        const botDist = botHits[0]?.distance ?? Infinity;

        const laser = laserRef.current;
        const posAttr = laser.line.geometry.attributes["position"];
        if (!posAttr) continue;
        const positions = posAttr.array as Float32Array;
        positions[0] = origin.x;
        positions[1] = origin.y;
        positions[2] = origin.z;

        let end: THREE.Vector3;
        let hitBot = false;
        if (botDist < worldDist && botHits[0]) {
          end = botHits[0].point.clone();
          const victim = fighterByMesh(botHits[0].object);
          if (victim) {
            damage(victim, weaponDamage, human);
            hitBot = true;
            anyHit = true;
          }
        } else if (worldHits[0]) {
          end = worldHits[0].point.clone();
        } else {
          end = origin.clone().add(pelletDir.multiplyScalar(weaponRange));
        }

        positions[3] = end.x;
        positions[4] = end.y;
        positions[5] = end.z;
        posAttr.needsUpdate = true;

        laser.sparkMesh.position.copy(end);
        laser.sparkMesh.visible = true;
        laser.spark.position.copy(end);
        laser.spark.intensity = 5;
        laser.material.opacity = 1;
        laser.ttl = 0.12;

        spawnImpact(end, hitBot ? new THREE.Color(human.team === "blue" ? 0x3f8fff : 0xff3b1f) : undefined);
        // Kill feed is already pushed by damage()/kill(); don't duplicate it here.
      }


      // decrement ammo
      if (currentAmmo) {
        currentAmmo.mag = Math.max(0, currentAmmo.mag - 1);
        ammoRef.current = { ...ammoRef.current, [weaponId]: currentAmmo };
        setAmmo(ammoRef.current);
      }

      return anyHit;
    };



    const onMouseDown = (e: MouseEvent) => {
      if (e.button !== 0) return;
      if (!sfxInitializedRef.current) {
        initSfx();
        sfxInitializedRef.current = true;
        setSfxReady(true);
      }
      if (modeRef.current !== "walk") return;
      if (document.pointerLockElement !== renderer.domElement) {
        renderer.domElement.requestPointerLock?.();
        return;
      }
      mouseHeldRef.current = true;
      const behavior = getWeaponBehavior(weaponRef.current);
      if (behavior.mode === "auto" || behavior.mode === "burst") {
        if (behavior.mode === "burst" && !burstQueueRef.current) {
          burstQueueRef.current = { shotsLeft: behavior.shots, nextIn: 0 };
        }
      } else {
        shoot();
      }
    };

    const onMouseUp = (e: MouseEvent) => {
      if (e.button !== 0) return;
      mouseHeldRef.current = false;
      // cancelling a burst mid-burst is intentional
    };


    const onPointerMove = (e: PointerEvent) => {
      if (modeRef.current === "walk") {
        if (document.pointerLockElement !== renderer.domElement) return;
        yaw -= e.movementX * 0.0022;
        pitch = Math.max(-1.2, Math.min(1.2, pitch - e.movementY * 0.0022));
        return;
      }
      if (!dragging) return;
      theta -= (e.clientX - lastX) * 0.005;
      phi = Math.max(0.15, Math.min(1.45, phi - (e.clientY - lastY) * 0.005));
      lastX = e.clientX;
      lastY = e.clientY;
    };
    const onWheel = (e: WheelEvent) => {
      if (modeRef.current !== "orbit") return;
      e.preventDefault();
      radius = Math.max(20, Math.min(420, radius + e.deltaY * 0.25));
    };
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === "Space" && modeRef.current === "walk") e.preventDefault();
      keys.add(e.code);
    };
    const onKeyUp = (e: KeyboardEvent) => keys.delete(e.code);

    renderer.domElement.addEventListener("pointerdown", onPointerDown);
    renderer.domElement.addEventListener("mousedown", onMouseDown);
    window.addEventListener("mouseup", onMouseUp);
    window.addEventListener("pointerup", onPointerUp);
    window.addEventListener("pointermove", onPointerMove);
    renderer.domElement.addEventListener("wheel", onWheel, { passive: false });
    window.addEventListener("keydown", onKeyDown);
    window.addEventListener("keyup", onKeyUp);

    const onPointerLockChange = () => {
      const locked = document.pointerLockElement === renderer.domElement;
      if (modeRef.current === "walk" && !locked && matchRef.current.phase === "round") {
        setPaused(true);
        suspendSfx();
      }
    };
    document.addEventListener("pointerlockchange", onPointerLockChange);

    const onFullscreenChange = () => {
      setFullscreen(!!document.fullscreenElement);
    };
    document.addEventListener("fullscreenchange", onFullscreenChange);



    const onResize = () => {
      camera.aspect = mount.clientWidth / mount.clientHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(mount.clientWidth, mount.clientHeight);
    };
    window.addEventListener("resize", onResize);

    let limit = 200;
    let disposed = false;

    const loader = new GLTFLoader();
    loader.load(
      "/models/arena.glb",
      (gltf) => {
        if (disposed) return;
        const model = gltf.scene;
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh) {
            m.castShadow = true;
            m.receiveShadow = true;
          }
        });
        root.add(model);

        const colliders: THREE.Mesh[] = [];
        model.traverse((o) => {
          const m = o as THREE.Mesh;
          if (m.isMesh && m.geometry) colliders.push(m);
        });
        collidersRef.current = colliders;

        // Radar footprint: sample every vertex of the level between knee and
        // roof height into a top-down occupancy grid. The GLB batches whole
        // areas into single meshes, so per-mesh bounds are useless here.
        {
          const RES = 128;
          const EXT = 78;
          const cells = new Uint8Array(RES * RES);
          const v = new THREE.Vector3();
          for (const m of colliders) {
            const pos = m.geometry.getAttribute("position");
            if (!pos) continue;
            m.updateWorldMatrix(true, false);
            const step = pos.count > 60000 ? 3 : 1;
            for (let i = 0; i < pos.count; i += step) {
              v.fromBufferAttribute(pos as THREE.BufferAttribute, i).applyMatrix4(m.matrixWorld);
              if (v.y < 0.5 || v.y > 9) continue; // skip floors, roofs, sky
              const gx = Math.floor(((v.x + EXT) / (EXT * 2)) * RES);
              const gz = Math.floor(((v.z + EXT) / (EXT * 2)) * RES);
              if (gx < 0 || gz < 0 || gx >= RES || gz >= RES) continue;
              const idx = gz * RES + gx;
              const cur = cells[idx] ?? 0;
              if (cur < 255) cells[idx] = cur + 1;
            }
          }
          mapGridRef.current = { cells, res: RES, extent: EXT };
        }

        const box = new THREE.Box3().setFromObject(model);
        const size = new THREE.Vector3();
        box.getSize(size);
        limit = Math.max(size.x, size.z) / 2 - 2;
        radius = Math.max(size.x, size.z) * 1.15;
        target.set(0, size.y * 0.15, 0);

        // ---- hardcoded spawn spots (from the authored 2v2 spawn meshes) ----
        // one fighter per spot, standing in the middle of its own pad
        const SPAWN_SPOTS: Array<{ name: string; team: Team; top: THREE.Vector3 }> = [
          { name: "SPAWN_BLUE_1", team: "blue", top: new THREE.Vector3(-46.78, 0.58, -67.08) },
          { name: "SPAWN_BLUE_2", team: "blue", top: new THREE.Vector3(-55.04, 0.58, -67.08) },
          { name: "SPAWN_RED_1", team: "red", top: new THREE.Vector3(45.03, 0.58, 66.05) },
          { name: "SPAWN_RED_2", team: "red", top: new THREE.Vector3(53.29, 0.58, 66.05) },
        ];
        const points: SpawnPoint[] = SPAWN_SPOTS.map((s) => ({
          name: s.name,
          team: s.team,
          top: s.top.clone(),
        }));

        const bluePads = points.filter((p) => p.team === "blue");
        const redPads = points.filter((p) => p.team === "red");




        const makeTracer = () => {
          const geo = new THREE.BufferGeometry().setFromPoints([
            new THREE.Vector3(),
            new THREE.Vector3(),
          ]);
          const mat = new THREE.LineBasicMaterial({ color: 0xff9d5c, transparent: true, opacity: 0 });
          const line = new THREE.Line(geo, mat);
          line.frustumCulled = false;
          root.add(line);
          return { line, mat, ttl: 0 };
        };

        const addFighter = (team: Team, index: number, isHuman: boolean) => {
          const pads = team === "blue" ? bluePads : redPads;
          // one fighter per pad; if a team has fewer pads than fighters, stand
          // side by side around the shared pad instead of inside each other
          const pad = pads[index % pads.length]!;
          const overflow = Math.floor(index / pads.length);
          const home: SpawnPoint =
            overflow === 0
              ? pad
              : {
                  ...pad,
                  top: pad.top
                    .clone()
                    .add(
                      new THREE.Vector3(
                        Math.cos(overflow * 2.2) * 2.6,
                        0,
                        Math.sin(overflow * 2.2) * 2.6,
                      ),
                    ),
                };
          const id = `${team.toUpperCase()}_${index + 1}`;
          const weapon = isHuman ? "deagle" : team === "blue" ? "ak47" : index === 0 ? "m4a1" : "ump";
          const f: Fighter = {
            id,
            team,
            isHuman,
            group: null,
            meshes: [],
            hp: MAX_HP,
            alive: true,
            respawnIn: 0,
            home,
            pos: home.top.clone(),
            cooldown: 0.8 + Math.random() * 1.2,
            tracer: null,
            fx: null,
            weapon,
          };
          // personal spawn effect, sitting on this fighter's own spot
          const fx = createSpawnFx(team === "blue" ? "water" : "fire", home.top);
          root.add(fx.group);
          fxList.push(fx);
          f.fx = fx;
          if (!isHuman) {
            const built = buildBot(team, id);
            built.group.position.copy(f.pos);
            root.add(built.group);
            f.group = built.group;
            f.meshes = built.meshes;
            f.tracer = makeTracer();
          }
          fighters.push(f);
          return f;
        };

        // 2v2: you + 1 blue bot vs 2 red bots
        human = addFighter("blue", 0, true);
        humanBody = buildBot("blue", "YOU");
        humanBody.group.position.copy(human.pos);
        humanBody.group.visible = false;
        root.add(humanBody.group);

        {
          const cage = new THREE.Group();
          const box = new THREE.Mesh(
            new THREE.BoxGeometry(SPAWN_BOX_HALF * 2, SPAWN_BOX_HEIGHT, SPAWN_BOX_HALF * 2),
            new THREE.MeshBasicMaterial({
              color: 0x3f8fff,
              transparent: true,
              opacity: 0.08,
              side: THREE.BackSide,
              depthWrite: false,
            }),
          );
          const edges = new THREE.LineSegments(
            new THREE.EdgesGeometry(box.geometry),
            new THREE.LineBasicMaterial({ color: 0x9ecbff, transparent: true, opacity: 0.6 }),
          );
          cage.add(box, edges);
          cage.position.copy(human.home.top).add(new THREE.Vector3(0, SPAWN_BOX_HEIGHT / 2, 0));
          cage.visible = false;
          root.add(cage);
          spawnCageRef.current = { mesh: cage, center: human.home.top.clone() };
        }
        addFighter("blue", 1, false);
        addFighter("red", 0, false);
        addFighter("red", 1, false);

        // the match waits for the player to dismiss the onboarding overlay;
        // enterWalk (the "Enter arena" button) kicks off startMatch.

        // pad key light
        for (const p of points) {
          const spot = new THREE.PointLight(TEAM_COLORS[p.team], 12, 20, 2);
          spot.position.copy(p.top).add(new THREE.Vector3(0, 6, 0));
          root.add(spot);
        }

        clipPlane.constant = box.min.y + size.y * 0.78;
        renderer.clippingPlanes = showRoofRef.current ? [] : [clipPlane];
        clipRef.current = { renderer, plane: clipPlane };

        syncHud();
        setStatus("");
      },
      (e) => {
        if (e.total) setStatus(`Loading map… ${Math.round((e.loaded / e.total) * 100)}%`);
      },
      () => setStatus("Failed to load the map file."),
    );

    let raf = 0;
    let last = performance.now();
    const forward = new THREE.Vector3();
    const right = new THREE.Vector3();

    const botTick = (f: Fighter, dt: number) => {
      if (!f.group) return;
      if (matchRef.current.phase !== "round") return;
      if (!f.alive) {
        f.respawnIn -= dt;
        if (f.respawnIn <= 0) respawn(f);
        return;
      }

      // keep bots planted on the ground
      const gy = groundAt(f.pos.x, f.pos.z, f.pos.y + 2);
      if (gy !== null) f.pos.y = gy;
      f.group.position.copy(f.pos);

      // pick the closest living enemy (human counts)
      let bestTarget: { pos: THREE.Vector3; fighter: Fighter } | null = null;
      let bestDist = Infinity;
      for (const other of fighters) {
        if (other.team === f.team || !other.alive) continue;
        const p = other.isHuman ? walkPos : other.pos;
        const d = p.distanceTo(f.pos);
        if (d < bestDist) {
          bestDist = d;
          bestTarget = { pos: p.clone(), fighter: other };
        }
      }
      if (!bestTarget) return;

      const bw = getWeapon(f.weapon);
      const botRange = bw ? getWeaponRange(bw) : 120;
      const botInterval = bw ? getWeaponFireInterval(bw) : 0.65;
      const botWeaponName = bw?.name ?? "Rifle";

      const aim = bestTarget.pos.clone().setY(bestTarget.pos.y + 1.3);
      const eye = f.pos.clone().setY(f.pos.y + 1.3);
      const toTarget = aim.clone().sub(eye);
      const dist = toTarget.length();
      f.group.rotation.y = Math.atan2(toTarget.x, toTarget.z) + Math.PI;

      f.cooldown -= dt;
      if (f.cooldown > 0 || dist > botRange) return;
      f.cooldown = botInterval * (0.9 + Math.random() * 0.4);

      // distant gunfire — attenuated so the arena has depth
      playSfxAt(
        getWeaponBehavior(f.weapon).sound,
        eye.distanceTo(camera.position),
        0.85,
        (Math.random() - 0.5) * 0.05,
      );


      // line of sight
      const dir = toTarget.clone().normalize();
      raycaster.set(eye, dir);
      raycaster.far = dist - 0.4;
      const blocked = raycaster.intersectObjects(collidersRef.current, false).length > 0;

      if (f.tracer) {
        const attr = f.tracer.line.geometry.getAttribute("position") as THREE.BufferAttribute;
        const arr = attr.array as Float32Array;
        const end = blocked ? eye.clone().add(dir.multiplyScalar(Math.min(dist, 12))) : aim;
        arr[0] = eye.x;
        arr[1] = eye.y;
        arr[2] = eye.z;
        arr[3] = end.x;
        arr[4] = end.y;
        arr[5] = end.z;
        attr.needsUpdate = true;
        f.tracer.mat.color.setHex(f.team === "blue" ? 0x8ec5ff : 0xff9d5c);
        f.tracer.mat.opacity = 1;
        f.tracer.ttl = 0.1;
      }

      if (blocked) return;
      // accuracy falls off with distance
      const hitChance = Math.max(0.25, 0.85 - dist / 160);
      if (Math.random() < hitChance) {
        damage(bestTarget.fighter, BOT_DAMAGE, f);
        if (!bestTarget.fighter.alive) pushKillFeed(f, bestTarget.fighter, botWeaponName);
      }
    };

    const animate = () => {
      raf = requestAnimationFrame(animate);
      const now = performance.now();
      const dt = Math.min((now - last) / 1000, 0.05);
      last = now;

      for (const fx of fxList) fx.update(dt);
      for (const fx of impactPool) fx.update(dt);

      // pre-round countdown
      if (spawnCageRef.current) {
        spawnCageRef.current.mesh.visible =
          matchRef.current.phase === "countdown" && modeRef.current === "walk";
      }

      if (introTime > 0) {
        introTime = Math.max(0, introTime - dt);
        introRef.current = introTime;
        if (introTime <= 0) setIntro(false);
      }

      if (matchRef.current.phase === "countdown" && introTime <= 0) {
        countdownRef.current = Math.max(0, countdownRef.current - dt);
        const rounded = Math.ceil(countdownRef.current);
        if (matchRef.current.countdown !== rounded) {
          matchRef.current.countdown = rounded;
          setMatch({ ...matchRef.current });
        }
        if (countdownRef.current <= 0) {
          matchRef.current.phase = "round";
          matchRef.current.countdown = 0;
          setMatch({ ...matchRef.current });
        }
      }

      // automatic fire & burst handling
      if (human && human.alive && matchRef.current.phase === "round" && modeRef.current === "walk") {
        const behavior = getWeaponBehavior(weaponRef.current);
        // reload progress
        if (isReloadingRef.current && reloadTimerRef.current > 0) {
          reloadTimerRef.current = Math.max(0, reloadTimerRef.current - dt);
          const rounded = Math.ceil(reloadTimerRef.current * 10) / 10;
          if (rounded !== reloadLeft) {
            setReloadLeft(rounded);
          }
          if (reloadTimerRef.current <= 0) {
            finishReload(weaponRef.current);
          }
        }
        // burst
        if (burstQueueRef.current) {
          burstQueueRef.current.nextIn -= dt;
          if (burstQueueRef.current.nextIn <= 0) {
            const q = burstQueueRef.current;
            shoot(true);
            q.shotsLeft -= 1;
            if (q.shotsLeft <= 0) {
              burstQueueRef.current = null;
            } else {
              q.nextIn = behavior.interval;
            }
          }
        }
        // auto
        if (mouseHeldRef.current && behavior.mode === "auto" && weaponCooldownRef.current <= 0 && !isReloadingRef.current) {
          shoot(true);
        }
      }

      if (humanBody) humanBody.group.visible = introTime > 0 && modeRef.current === "walk";


      if (introTime > 0 && human && modeRef.current === "walk") {
        // cinematic spawn intro: camera hovers in front of the player's face
        const p = human.pos;
        if (humanBody) {
          humanBody.group.position.copy(p);
          humanBody.group.rotation.y = yaw + Math.PI;
        }
        const face = new THREE.Vector3(-Math.sin(yaw), 0, -Math.cos(yaw));
        const t = 1 - introTime / 5;
        const dist = 4.6 - t * 2.1;
        const head = new THREE.Vector3(p.x, p.y + EYE_HEIGHT, p.z);
        const orbitSwing = Math.sin(t * Math.PI) * 0.5;
        camera.position.set(
          head.x + face.x * dist + Math.cos(yaw) * orbitSwing * dist * 0.4,
          head.y + 0.45 + (1 - t) * 0.8,
          head.z + face.z * dist - Math.sin(yaw) * orbitSwing * dist * 0.4,
        );
        camera.lookAt(head);
      } else if (modeRef.current === "orbit") {
        theta += dt * 0.03;
        camera.position.set(
          target.x + radius * Math.sin(phi) * Math.cos(theta),
          target.y + radius * Math.cos(phi),
          target.z + radius * Math.sin(phi) * Math.sin(theta),
        );
        camera.lookAt(target);
      } else if (human) {

        if (!human.alive) {
          human.respawnIn -= dt;
          setPlayerRespawn(Math.max(0, Math.ceil(human.respawnIn)));
          if (human.respawnIn <= 0) respawn(human);
        } else {
          const speed = (keys.has("ShiftLeft") ? 16 : 8) * dt;
          forward.set(Math.sin(yaw), 0, Math.cos(yaw));
          right.set(Math.cos(yaw), 0, -Math.sin(yaw));
          const move = new THREE.Vector3();
          if (keys.has("KeyW") || keys.has("ArrowUp")) move.sub(forward);
          if (keys.has("KeyS") || keys.has("ArrowDown")) move.add(forward);
          if (keys.has("KeyA") || keys.has("ArrowLeft")) move.sub(right);
          if (keys.has("KeyD") || keys.has("ArrowRight")) move.add(right);

          const colliders = collidersRef.current;

          if (move.lengthSq() > 0) {
            move.normalize().multiplyScalar(speed);

            // wall check from chest height
            if (colliders.length > 0) {
              const chest = scratch.copy(walkPos).setY(walkPos.y + 1.0);
              raycaster.set(chest, move.clone().normalize());
              raycaster.far = PLAYER_RADIUS + speed + 0.05;
              const hits = raycaster.intersectObjects(colliders, false);
              if (hits.length > 0 && hits[0]) {
                const allowed = Math.max(0, hits[0].distance - PLAYER_RADIUS - 0.05);
                if (allowed < speed) move.normalize().multiplyScalar(allowed);
              }
            }

            // step check: only small ledges are walkable, taller must be jumped
            if (grounded && move.lengthSq() > 0) {
              const nx = walkPos.x + move.x;
              const nz = walkPos.z + move.z;
              const nextGround = groundAt(nx, nz, walkPos.y);
              if (nextGround !== null && nextGround - walkPos.y > STEP_UP) {
                move.set(0, 0, 0); // blocked — jump over it
              }
            }

            walkPos.x += move.x;
            walkPos.z += move.z;
          }

          // jump + gravity
          if (keys.has("Space") && grounded) {
            velY = JUMP_SPEED;
            grounded = false;
          }
          velY -= GRAVITY * dt;
          walkPos.y += velY * dt;

          const gy = groundAt(walkPos.x, walkPos.z, walkPos.y);
          if (gy !== null) {
            if (walkPos.y <= gy + 0.02) {
              walkPos.y = gy;
              velY = 0;
              grounded = true;
            } else if (velY <= 0 && walkPos.y - gy < 0.35) {
              walkPos.y = gy;
              velY = 0;
              grounded = true;
            } else {
              grounded = false;
            }
          }

          walkPos.x = Math.max(-limit, Math.min(limit, walkPos.x));
          walkPos.z = Math.max(-limit, Math.min(limit, walkPos.z));

          // during the buy phase you are locked inside your spawn cage
          const cage = spawnCageRef.current;
          if (matchRef.current.phase === "countdown" && cage) {
            walkPos.x = Math.max(cage.center.x - SPAWN_BOX_HALF, Math.min(cage.center.x + SPAWN_BOX_HALF, walkPos.x));
            walkPos.z = Math.max(cage.center.z - SPAWN_BOX_HALF, Math.min(cage.center.z + SPAWN_BOX_HALF, walkPos.z));
            const ceil = cage.center.y + SPAWN_BOX_HEIGHT - EYE_HEIGHT;
            if (walkPos.y > ceil) {
              walkPos.y = ceil;
              velY = Math.min(velY, 0);
            }
          }
          human.pos.copy(walkPos);

          camera.position.set(walkPos.x, walkPos.y + EYE_HEIGHT, walkPos.z);

          // screen shake decay
          if (shakeRef.current > 0) {
            const s = shakeRef.current;
            camera.position.x += (Math.random() - 0.5) * s;
            camera.position.y += (Math.random() - 0.5) * s;
            camera.position.z += (Math.random() - 0.5) * s;
            shakeRef.current = Math.max(0, shakeRef.current - dt * 2.8);
          }

          // recoil recovery
          recoilRef.current = Math.max(0, recoilRef.current - dt * 0.45);
          recoilYawRef.current *= Math.max(0, 1 - dt * 5);
          weaponCooldownRef.current = Math.max(0, weaponCooldownRef.current - dt);

          const effectiveYaw = yaw + recoilYawRef.current;
          const effectivePitch = pitch + recoilRef.current;
          const dir = new THREE.Vector3(
            Math.sin(effectiveYaw) * Math.cos(effectivePitch),
            Math.sin(effectivePitch),
            Math.cos(effectiveYaw) * Math.cos(effectivePitch),
          );
          camera.lookAt(camera.position.clone().add(dir.multiplyScalar(-1)));
        }
      }

      if (weaponCooldownRef.current <= 0 && !weaponReady) {
        setWeaponReady(true);
      }


      for (const f of fighters) {
        if (!f.isHuman) botTick(f, dt);
        if (f.tracer && f.tracer.ttl > 0) {
          f.tracer.ttl -= dt;
          f.tracer.mat.opacity = Math.max(0, f.tracer.ttl / 0.1);
        }
      }

      const laser = laserRef.current;
      if (laser && laser.ttl > 0) {
        laser.ttl -= dt;
        const t = Math.max(0, laser.ttl / 0.12);
        laser.material.opacity = t;
        laser.spark.intensity = t * 5;
        (laser.sparkMesh.material as THREE.MeshBasicMaterial).opacity = t;
        if (laser.ttl <= 0) {
          laser.sparkMesh.visible = false;
          laser.spark.intensity = 0;
        }
      }

      const muzzle = muzzleRef.current;
      if (muzzle && muzzle.ttl > 0) {
        muzzle.ttl -= dt;
        const t = Math.max(0, muzzle.ttl / 0.06);
        (muzzle.mesh.material as THREE.MeshBasicMaterial).opacity = t;
        muzzle.light.intensity = t * 18;
        muzzle.mesh.scale.setScalar(1 + (1 - t) * 2.5);
        if (muzzle.ttl <= 0) {
          muzzle.mesh.visible = false;
          muzzle.light.intensity = 0;
        }
      }

      if (hitMarkerRef.current > 0) {
        hitMarkerRef.current = Math.max(0, hitMarkerRef.current - dt);
        if (hitMarkerRef.current <= 0) setHitMarker(0);
      }

      if (killFeedRef.current.length > 0) {
        let changed = false;
        for (const item of killFeedRef.current) {
          item.time -= dt;
          if (item.time <= 0) changed = true;
        }
        if (changed) {
          killFeedRef.current = killFeedRef.current.filter((i) => i.time > 0);
          setKillFeed([...killFeedRef.current]);
        }
      }

      if (intermissionRef.current > 0) {
        intermissionRef.current = Math.max(0, intermissionRef.current - dt);
        const rounded = Math.ceil(intermissionRef.current);
        if (matchRef.current.countdown !== rounded) {
          matchRef.current.countdown = rounded;
          setMatch({ ...matchRef.current });
        }
      }



      radarRef.current = {
        fighters: fighters.map((f) => ({
          x: f.pos.x,
          z: f.pos.z,
          team: f.team,
          alive: f.alive,
          isHuman: f.isHuman,
        })),
        player: human ? { x: walkPos.x, z: walkPos.z, yaw } : null,
      };

      if (damageFlashRef.current > 0) {
        damageFlashRef.current = Math.max(0, damageFlashRef.current - dt * 1.8);
        const v = vignetteRef.current;
        if (v) v.style.opacity = String(damageFlashRef.current);
      }

      const ch = crosshairRef.current;
      if (ch) {
        const spread = 1 + Math.min(2.2, recoilRef.current * 6);
        ch.style.transform = `translate(-50%, -50%) scale(${spread})`;
      }

      renderer.render(scene, camera);
    };
    animate();

    // warm the sample bytes into the HTTP cache so the first shot is instant
    warmSfx();
    const onVisibility = () => (document.hidden ? suspendSfx() : resumeSfx());
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      disposed = true;
      cancelAnimationFrame(raf);
      renderer.domElement.removeEventListener("pointerdown", onPointerDown);
      renderer.domElement.removeEventListener("mousedown", onMouseDown);
      window.removeEventListener("mouseup", onMouseUp);
      renderer.domElement.removeEventListener("wheel", onWheel);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("resize", onResize);
      document.removeEventListener("visibilitychange", onVisibility);
      document.removeEventListener("pointerlockchange", onPointerLockChange);
      document.removeEventListener("fullscreenchange", onFullscreenChange);
      suspendSfx();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };



  }, []);

  useEffect(() => {
    showRoofRef.current = showRoof;
    const c = clipRef.current;
    if (c) c.renderer.clippingPlanes = showRoof ? [] : [c.plane];
  }, [showRoof, hud]);

  const enterWalk = () => {
    startMatchRef.current?.();
    setMode("walk");
    const canvas = mountRef.current?.querySelector("canvas");
    canvas?.requestPointerLock?.();
  };

  const enter = () => {
    setShowOnboarding(false);
    enterWalk();
  };

  // The match starts when the player dismisses the onboarding overlay.

  useEffect(() => {
    if (match.phase === "countdown" && mode === "walk" && !intro) {
      setShopOpen(true);
      document.exitPointerLock?.();
    } else {
      setShopOpen(false);
    }
  }, [match.phase, mode, intro]);


  /** Equip a weapon respecting the loadout rule: 2 heavy + 1 sidearm. */
  const equipWeapon = (w: Weapon) => {
    setSlots((prev) => {
      const next = [...prev];
      if (!isHeavy(w)) {
        next[2] = w.id;
        return next;
      }
      const existing = next.indexOf(w.id);
      if (existing !== -1) return next;
      const empty = next[0] === null ? 0 : next[1] === null ? 1 : -1;
      const target = empty !== -1 ? empty : activeSlot < 2 ? activeSlot : 0;
      next[target] = w.id;
      return next;
    });
    setActiveSlot(() => {
      if (!isHeavy(w)) return 2;
      return slots.indexOf(w.id) !== -1
        ? slots.indexOf(w.id)
        : slots[0] === null
          ? 0
          : slots[1] === null
            ? 1
            : activeSlot < 2
              ? activeSlot
              : 0;
    });
  };

  const buyWeapon = (w: Weapon) => {
    if (owned.includes(w.id)) {
      equipWeapon(w);
      return;
    }
    if (credits < w.price) return;
    setCredits((c) => c - w.price);
    setOwned((o) => [...o, w.id]);
    setAmmo((prev) => ({
      ...prev,
      [w.id]: { mag: getMagazine(w.id), reserve: getReserveAmmo(w.id) },
    }));
    equipWeapon(w);
  };

  const sellAllWeapons = () => {
    const heavyIds = slots.slice(0, 2).filter(Boolean) as string[];
    if (heavyIds.length === 0) return;
    const refund = heavyIds.reduce((sum, id) => sum + (getWeapon(id)?.price ?? 0) * 0.5, 0);
    setCredits((c) => c + Math.floor(refund));
    setSlots((prev) => [null, null, prev[2] ?? null]);
    setActiveSlot(2);
  };


  const selectSlot = (i: number) => {

    if (!slots[i]) return;
    setActiveSlot(i);
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.code === "KeyR" && !isReloadingRef.current) {
        const weaponId = weaponRef.current;
        const cur = ammoRef.current[weaponId];
        if (cur && cur.mag < getMagazine(weaponId) && cur.reserve > 0) {
          startReloadRef.current(weaponId);
        }
      }
      if (e.code === "KeyB" && matchRef.current.phase === "countdown") setShopOpen((v) => !v);
      if (e.code === "Backquote") setShowDebug((v) => !v);
      if (e.code === "Digit1" || e.code === "Digit2" || e.code === "Digit3") {
        const i = Number(e.code.slice(5)) - 1;
        setSlots((s) => {
          if (s[i]) setActiveSlot(i);
          return s;
        });
      }
    };

    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="relative h-full w-full">
      <div ref={mountRef} className="h-full w-full" />
      <div
        ref={vignetteRef}
        className="pointer-events-none absolute inset-0"
        style={{
          opacity: 0,
          background:
            "radial-gradient(ellipse at center, transparent 50%, rgba(200,30,30,0.6) 100%)",
        }}
      />

      {status && (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center text-xs uppercase tracking-[0.3em] text-muted-foreground">
          {status}
        </div>
      )}

      {showOnboarding && !status && (
        <div
          className="pointer-events-auto absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 bg-background/80 p-6 text-center backdrop-blur-sm"
        >
          <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Lone Wolf Arena</h2>
          <div className="grid max-w-md gap-2 text-sm text-foreground/90">
            <p>
              <span className="font-semibold text-[var(--hud-accent)]">W A S D</span> to move ·{" "}
              <span className="font-semibold text-[var(--hud-accent)]">Space</span> to jump ·{" "}
              <span className="font-semibold text-[var(--hud-accent)]">Shift</span> to sprint
            </p>
            <p>
              <span className="font-semibold text-[var(--hud-accent)]">Mouse</span> to look ·{" "}
              <span className="font-semibold text-[var(--hud-accent)]">Click</span> to shoot ·{" "}
              <span className="font-semibold text-[var(--hud-accent)]">R</span> to reload
            </p>
            <p>
              <span className="font-semibold text-[var(--hud-accent)]">1 2 3</span> switch weapons ·{" "}
              <span className="font-semibold text-[var(--hud-accent)]">B</span> opens the armory during buy phase
            </p>
          </div>
          <button
            type="button"
            onClick={enter}
            className="rounded-lg bg-[var(--hud-accent)] px-6 py-2 text-xs font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)] transition hover:brightness-110"
          >
            Enter arena
          </button>
        </div>
      )}

      {mode === "walk" && (

        <>
          {paused && (
            <div className="pointer-events-auto absolute inset-0 z-50 flex flex-col items-center justify-center gap-4 bg-background/80 p-6 text-center backdrop-blur-sm">
              <h2 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">Paused</h2>
              <p className="max-w-md text-sm text-muted-foreground">
                Click resume to lock the cursor and continue the match.
              </p>
              <button
                type="button"
                onClick={() => {
                  setPaused(false);
                  resumeSfx();
                  mountRef.current?.querySelector("canvas")?.requestPointerLock?.();
                }}
                className="rounded-lg bg-[var(--hud-accent)] px-6 py-2 text-xs font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)] transition hover:brightness-110"
              >
                Resume
              </button>
            </div>
          )}
          <Minimap radarRef={radarRef} mapRef={mapGridRef} />

          <div
            ref={crosshairRef}
            className="pointer-events-none absolute left-1/2 top-1/2"
            style={{ transform: "translate(-50%, -50%) scale(1)" }}
          >
            <div className="relative h-6 w-6">
              <span className="absolute left-1/2 top-0 h-2 w-0.5 -translate-x-1/2 bg-foreground/90" />
              <span className="absolute bottom-0 left-1/2 h-2 w-0.5 -translate-x-1/2 bg-foreground/90" />
              <span className="absolute left-0 top-1/2 h-0.5 w-2 -translate-y-1/2 bg-foreground/90" />
              <span className="absolute right-0 top-1/2 h-0.5 w-2 -translate-y-1/2 bg-foreground/90" />
              <span className="absolute left-1/2 top-1/2 h-1 w-1 -translate-x-1/2 -translate-y-1/2 rounded-full bg-foreground" />
            </div>
          </div>
          {hitMarker > 0 && (
            <div className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2">
              <div className="relative h-8 w-8">
                <div className="absolute left-1/2 top-0 h-3 w-0.5 -translate-x-1/2 bg-primary" />
                <div className="absolute bottom-0 left-1/2 h-3 w-0.5 -translate-x-1/2 bg-primary" />
                <div className="absolute left-0 top-1/2 h-0.5 w-3 -translate-y-1/2 bg-primary" />
                <div className="absolute right-0 top-1/2 h-0.5 w-3 -translate-y-1/2 bg-primary" />
              </div>
            </div>
          )}
          {!weaponReady && (
            <div className="pointer-events-none absolute bottom-28 left-1/2 -translate-x-1/2 text-[10px] uppercase tracking-widest text-muted-foreground">
              Recharging…
            </div>
          )}
          {match.phase === "countdown" && !shopOpen && (
            <div className="pointer-events-none absolute inset-x-0 top-24 flex flex-col items-center gap-1">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                Round {match.round} · buy phase · press B for armory
              </p>
              <p className="text-5xl font-bold tabular-nums text-foreground">{match.countdown}</p>
              <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                Locked inside your spawn cage
              </p>
            </div>
          )}

          {shopOpen && (
            <WeaponShop
              credits={credits}
              owned={owned}
              slots={slots}
              activeSlot={activeSlot}
              secondsLeft={match.countdown}
              totalSeconds={COUNTDOWN_SECONDS}
              onBuy={buyWeapon}
              onSelectSlot={selectSlot}
              onSellAll={sellAllWeapons}
              onClose={() => setShopOpen(false)}
            />
          )}

          {!shopOpen && (
            <WeaponSlots slots={slots} activeSlot={activeSlot} onSelect={selectSlot} />
          )}

          {!shopOpen && (() => {
            const activeId = slots[activeSlot] ?? "deagle";
            const w = getWeapon(activeId);
            const cur = ammo[activeId];
            const mag = cur?.mag ?? 0;
            const reserve = cur?.reserve ?? 0;
            const magSize = getMagazine(activeId);
            const hasAmmo = magSize > 0;
            const empty = hasAmmo && mag === 0;
            const low = hasAmmo && mag > 0 && mag <= Math.max(1, Math.ceil(magSize * 0.25));
            return (
              <div className="pointer-events-none absolute bottom-24 right-4 flex flex-col items-end gap-1 sm:bottom-28 sm:right-6">
                <div
                  className={`flex items-baseline gap-3 rounded-md border px-4 py-2 backdrop-blur transition-colors ${
                    empty
                      ? "border-destructive bg-destructive/15"
                      : low
                        ? "border-[var(--hud-accent)]/70 bg-[var(--hud-panel)]/90"
                        : "border-border/60 bg-[var(--hud-panel)]/90"
                  }`}
                >
                  <span
                    className={`text-3xl font-bold tabular-nums ${
                      empty ? "text-destructive animate-pulse" : low ? "text-[var(--hud-accent)]" : "text-foreground"
                    }`}
                  >
                    {mag}
                  </span>
                  <span className="text-sm font-medium text-muted-foreground">/ {reserve}</span>
                </div>
                {empty && !isReloading && (
                  <div className="animate-pulse rounded-md bg-destructive px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-destructive-foreground">
                    Press R to reload
                  </div>
                )}
                {isReloading && (
                  <div className="rounded-md bg-[var(--hud-accent)]/90 px-3 py-1 text-[10px] font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)]">
                    Reloading… {reloadLeft.toFixed(1)}s
                  </div>
                )}
                <p className="text-[10px] uppercase tracking-widest text-muted-foreground">
                  {w?.name ?? "Deagle"} · R to reload
                </p>
                {w ? (
                  <img
                    src={w.image}
                    alt={w.name}
                    width={512}
                    height={512}
                    className={`mt-1 h-20 w-auto object-contain opacity-90 transition-transform duration-100 sm:h-28 ${isReloading ? "translate-x-2 -translate-y-2 -rotate-6" : ""}`}
                    loading="lazy"
                  />
                ) : null}
              </div>
            );
          })()}


          {playerRespawn > 0 && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 bg-background/50">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">Eliminated</p>
              <p className="text-4xl font-bold text-foreground">Respawn in {playerRespawn}</p>
            </div>
          )}
          {match.phase !== "round" && match.phase !== "countdown" && match.phase !== "warmup" && (
            <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-3 bg-background/60">
              <p className="text-xs uppercase tracking-[0.35em] text-muted-foreground">
                {match.phase === "intermission" ? "Round over" : "Match over"}
              </p>
              <p className="text-4xl font-bold text-foreground">
                {match.matchWinner
                  ? `${match.matchWinner === "blue" ? "Blue" : "Red"} team wins`
                  : `${match.roundWinner === "blue" ? "Blue" : "Red"} team wins the round`}
              </p>
              <p className="text-2xl font-semibold tabular-nums text-foreground">
                {match.blue} – {match.red}
              </p>
              <p className="text-sm uppercase tracking-widest text-muted-foreground">
                You · {playerStatsHud.kills} K / {playerStatsHud.deaths} D
              </p>
              {match.countdown > 0 && (
                <p className="text-sm uppercase tracking-widest text-muted-foreground">
                  {match.phase === "matchEnd" ? "Next match" : "Next round"} in {match.countdown}
                </p>
              )}
              <button
                onClick={enterWalk}
                className="pointer-events-auto mt-2 rounded-lg bg-[var(--hud-accent)] px-6 py-2 text-xs font-bold uppercase tracking-widest text-[var(--hud-accent-foreground)] transition hover:brightness-110"
              >
                Play again
              </button>
            </div>
          )}
        </>
      )}




      {/* killfeed */}
      {killFeed.length > 0 && (
        <div className="pointer-events-none absolute right-4 top-44 flex max-w-xs flex-col gap-1 sm:right-6 sm:top-48">
          {killFeed.map((item) => (
            <div
              key={item.id}
              className="flex items-center gap-2 rounded-md border border-border/60 bg-card/80 px-3 py-1.5 text-xs text-foreground backdrop-blur"
            >
              <Skull className="h-3 w-3 text-muted-foreground" />
              <span className={item.killerTeam === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                {item.killer}
              </span>
              <span className="text-muted-foreground">{item.weapon}</span>
              <span className={item.victimTeam === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                {item.victim}
              </span>
            </div>
          ))}
        </div>
      )}

      {(leaderboard || orbitLeaderboard) && (
        <div className="pointer-events-none absolute left-4 top-4 max-w-xs rounded-lg border border-border/60 bg-card/80 p-4 backdrop-blur sm:left-6 sm:top-6">
          <p className="text-[10px] uppercase tracking-[0.35em] text-muted-foreground">Leaderboard</p>
          <div className="mt-2 space-y-1 text-xs">
            {Object.entries((leaderboard ?? orbitLeaderboard)!.totals).map(([team, t]) => (
              <div key={team} className="flex justify-between gap-4">
                <span className={team === "blue" ? "text-[#3f8fff]" : "text-[#ff3b1f]"}>
                  {team === "blue" ? "Blue" : "Red"}
                </span>
                <span className="tabular-nums text-foreground">
                  {t.wins}W {t.losses}L · {t.kills}K {t.deaths}D
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* scoreboard */}
      {hud.length > 0 && (
        <div className="pointer-events-none absolute left-1/2 top-4 -translate-x-1/2 rounded-lg border border-border/60 bg-card/70 px-4 py-2 text-center backdrop-blur sm:top-6">
          <div className="flex items-center gap-3 text-lg font-bold tabular-nums">
            <span style={{ color: "#3f8fff" }}>{score.blue}</span>
            <div className="flex flex-col items-center">
              <span className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Round {match.round}</span>
              <div className="mt-1 flex w-32 overflow-hidden rounded-full bg-muted sm:w-40">
                <div
                  className="h-1.5 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, (hud.filter((f) => f.team === "blue").reduce((s, f) => s + f.hp, 0) / (MAX_HP * 2)) * 100))}%`, backgroundColor: "#3f8fff" }}
                />
                <div
                  className="h-1.5 transition-all"
                  style={{ width: `${Math.max(0, Math.min(100, (hud.filter((f) => f.team === "red").reduce((s, f) => s + f.hp, 0) / (MAX_HP * 2)) * 100))}%`, backgroundColor: "#ff3b1f" }}
                />
              </div>
            </div>
            <span style={{ color: "#ff3b1f" }}>{score.red}</span>
          </div>
          <div className="mt-1 flex gap-3 text-[10px] uppercase tracking-widest text-muted-foreground">
            {hud.map((f) => (
              <span key={f.id} className={f.alive ? "" : "opacity-40 line-through"}>
                {f.isHuman ? "YOU" : f.id} {f.hp}
              </span>
            ))}
          </div>
        </div>
      )}


      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex flex-wrap items-end justify-between gap-3 p-4 sm:p-6">
        <div className="rounded-lg border border-border/60 bg-[var(--hud-panel-dim)] px-4 py-3 text-xs uppercase tracking-widest text-muted-foreground backdrop-blur">
          {mode === "walk" ? (
            <>WASD · space jump · click shoot · R reload · shift sprint · 1/2/3 weapons · esc exit</>
          ) : (
            <>Drag to rotate · scroll to zoom</>
          )}

          {mode === "walk" && (
            <div className="mt-2 w-56 space-y-1">
              <div className="flex items-center gap-2">
                <span className="w-5 text-[9px] text-[var(--hud-accent)]">K/D</span>
                <div className="h-1.5 flex-1 skew-x-[-20deg] overflow-hidden bg-muted">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${Math.min(100, (playerStatsHud.kills / KILLS_TO_WIN_ROUND) * 100)}%`,
                      background: "var(--gradient-hud)",
                    }}
                  />
                </div>
                <span className="w-14 text-right text-[9px] tabular-nums normal-case tracking-normal text-foreground">
                  {playerStatsHud.kills} / {playerStatsHud.deaths}
                </span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-5 text-[9px] text-[var(--hud-hp)]">HP</span>
                <div className="h-2.5 flex-1 skew-x-[-20deg] overflow-hidden bg-muted">
                  <div
                    className="h-full transition-all"
                    style={{
                      width: `${Math.max(0, Math.min(100, (playerHp / MAX_HP) * 100))}%`,
                      background: "var(--gradient-hud)",
                    }}
                  />
                </div>
                <span className="w-14 text-right text-[9px] tabular-nums normal-case tracking-normal text-foreground">
                  {playerHp}/{MAX_HP}
                </span>
              </div>
            </div>
          )}
        </div>

        <div className="pointer-events-auto flex flex-col items-end gap-2">
          <div className="flex gap-2">
            <button
              onClick={() => {
                const next = !isSfxMuted();
                setSfxMuted(next);
                setMuted(next);
              }}
              className="rounded-lg border border-border bg-card/70 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-secondary"
              aria-label={muted ? "Unmute audio" : "Mute audio"}
            >
              {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            <button
              onClick={() => {
                if (!document.fullscreenElement) {
                  document.documentElement.requestFullscreen?.().catch(() => {});
                } else {
                  document.exitFullscreen?.().catch(() => {});
                }
              }}
              className="rounded-lg border border-border bg-card/70 p-2 text-muted-foreground backdrop-blur transition-colors hover:bg-secondary"
              aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            >
              {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
            </button>
          </div>
          {showDebug && (
            <div className="flex flex-col items-stretch gap-2 rounded-lg border border-border/60 bg-card/85 p-3 backdrop-blur">

              <p className="text-[10px] uppercase tracking-[0.3em] text-muted-foreground">Debug</p>
              <button
                onClick={() => setShowRoof((v) => !v)}
                className="rounded-md border border-border bg-card/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground transition-colors hover:bg-secondary"
              >
                {showRoof ? "Hide roof" : "Show roof"}
              </button>
              <button
                onClick={() => setMode((m) => (m === "orbit" ? "walk" : "orbit"))}
                className="rounded-md border border-border bg-card/80 px-4 py-2 text-xs font-semibold uppercase tracking-widest text-foreground transition-colors hover:bg-secondary"
              >
                {mode === "orbit" ? "Ground view" : "Orbit view"}
              </button>
              <button
                onClick={enterWalk}
                className="rounded-md bg-primary px-4 py-2 text-xs font-semibold uppercase tracking-widest text-primary-foreground transition-colors hover:bg-primary/90"
              >
                Restart match
              </button>
            </div>
          )}
          <button
            onClick={() => setShowDebug((v) => !v)}
            className="rounded-lg border border-border bg-card/70 px-4 py-2 text-[10px] font-semibold uppercase tracking-widest text-muted-foreground backdrop-blur transition-colors hover:bg-secondary"
          >
            {showDebug ? "Close debug" : "Debug (`)"}
          </button>
        </div>
      </div>
    </div>
  );
}

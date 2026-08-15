/**
 * Arena sound engine.
 *
 * Design goals:
 *  - **Zero lag.** Every sample is fetched once, decoded once into an
 *    AudioBuffer and then played through throw-away BufferSource nodes.
 *    Playing a sound costs a few microseconds and allocates nothing but a
 *    tiny node, so the render loop can never stall on audio.
 *  - **Never silent while loading.** A set of procedurally synthesised
 *    buffers is built instantly at init and used until the real samples
 *    finish downloading in the background.
 *  - **Bounded voices.** Hard caps on total concurrent voices and per-kind
 *    retrigger rate keep long full-auto bursts from stacking into mush or
 *    eating CPU.
 */

import rifleAsset from "@/assets/sfx/rifle.mp3.asset.json";
import carbineAsset from "@/assets/sfx/carbine.mp3.asset.json";
import smgAsset from "@/assets/sfx/smg.mp3.asset.json";
import mgAsset from "@/assets/sfx/mg.mp3.asset.json";
import shotgunAsset from "@/assets/sfx/shotgun.mp3.asset.json";
import sniperAsset from "@/assets/sfx/sniper.mp3.asset.json";
import pistolAsset from "@/assets/sfx/pistol.mp3.asset.json";
import deagleAsset from "@/assets/sfx/deagle.mp3.asset.json";
import knifeAsset from "@/assets/sfx/knife.mp3.asset.json";
import hitAsset from "@/assets/sfx/hit.mp3.asset.json";
import killAsset from "@/assets/sfx/kill.mp3.asset.json";
import spawnAsset from "@/assets/sfx/spawn.mp3.asset.json";
import reloadAsset from "@/assets/sfx/reload.mp3.asset.json";
import pumpAsset from "@/assets/sfx/pump.mp3.asset.json";
import dryfireAsset from "@/assets/sfx/dryfire.mp3.asset.json";
import victoryAsset from "@/assets/sfx/victory.mp3.asset.json";

export type Kind =
  | "rifle"
  | "carbine"
  | "smg"
  | "shotgun"
  | "sniper"
  | "mg"
  | "pistol"
  | "deagle"
  | "knife"
  | "hit"
  | "kill"
  | "spawn"
  | "reload"
  | "pump"
  | "dryfire"
  | "victory";

const SOURCES: Record<Kind, string> = {
  rifle: rifleAsset.url,
  carbine: carbineAsset.url,
  smg: smgAsset.url,
  mg: mgAsset.url,
  shotgun: shotgunAsset.url,
  sniper: sniperAsset.url,
  pistol: pistolAsset.url,
  deagle: deagleAsset.url,
  knife: knifeAsset.url,
  hit: hitAsset.url,
  kill: killAsset.url,
  spawn: spawnAsset.url,
  reload: reloadAsset.url,
  pump: pumpAsset.url,
  dryfire: dryfireAsset.url,
  victory: victoryAsset.url,
};

/** Minimum gap between two plays of the same kind (seconds of wall time, ms). */
const RETRIGGER_MS: Partial<Record<Kind, number>> = {
  rifle: 45,
  carbine: 40,
  smg: 32,
  mg: 34,
  shotgun: 120,
  sniper: 180,
  pistol: 60,
  deagle: 90,
  hit: 40,
  dryfire: 90,
  victory: 4000,
};

const MAX_VOICES = 22;
const MASTER_GAIN = 0.5;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let comp: DynamicsCompressorNode | null = null;
let muted = false;
let loadStarted = false;
let voices = 0;
const buffers = new Map<Kind, AudioBuffer>();
const lastPlayed = new Map<Kind, number>();

/* ------------------------------------------------------------------ */
/* Instant procedural fallbacks (used until the samples land)          */
/* ------------------------------------------------------------------ */

function noiseShot(
  c: AudioContext,
  o: { dur: number; decay: number; lowStart: number; lowEnd: number; tone: number; toneEnd: number; gain: number },
) {
  const rate = c.sampleRate;
  const len = Math.max(1, Math.floor(o.dur * rate));
  const buf = c.createBuffer(1, len, rate);
  const data = buf.getChannelData(0);
  let lp = 0;
  let phase = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = Math.pow(1 - t, o.decay);
    const n = Math.random() * 2 - 1;
    lp += (n - lp) * (o.lowStart + (o.lowEnd - o.lowStart) * t);
    phase += ((o.tone + (o.toneEnd - o.tone) * t) * Math.PI * 2) / rate;
    data[i] = Math.tanh((lp * 1.6 + Math.sin(phase) * 0.55) * env * o.gain * 1.4);
  }
  return buf;
}

function metallic(c: AudioContext, dur: number, f0: number, f1: number, gain: number) {
  const rate = c.sampleRate;
  const len = Math.floor(dur * rate);
  const buf = c.createBuffer(1, len, rate);
  const d = buf.getChannelData(0);
  let p0 = 0;
  let p1 = 0;
  for (let i = 0; i < len; i++) {
    const t = i / len;
    const env = Math.pow(1 - t, 3);
    p0 += (f0 * Math.PI * 2) / rate;
    p1 += (f1 * Math.PI * 2) / rate;
    d[i] = (Math.sin(p0) * 0.6 + Math.sin(p1) * 0.4 + (Math.random() * 2 - 1) * 0.15) * env * gain;
  }
  return buf;
}

function buildFallbacks(c: AudioContext) {
  const set = (k: Kind, b: AudioBuffer) => {
    if (!buffers.has(k)) buffers.set(k, b);
  };
  set("pistol", noiseShot(c, { dur: 0.2, decay: 4, lowStart: 0.55, lowEnd: 0.1, tone: 220, toneEnd: 70, gain: 0.9 }));
  set("deagle", noiseShot(c, { dur: 0.28, decay: 3, lowStart: 0.45, lowEnd: 0.08, tone: 170, toneEnd: 55, gain: 1 }));
  set("rifle", noiseShot(c, { dur: 0.24, decay: 3.4, lowStart: 0.7, lowEnd: 0.12, tone: 180, toneEnd: 55, gain: 1 }));
  set("carbine", noiseShot(c, { dur: 0.2, decay: 3.8, lowStart: 0.75, lowEnd: 0.16, tone: 210, toneEnd: 70, gain: 0.95 }));
  set("smg", noiseShot(c, { dur: 0.14, decay: 5, lowStart: 0.85, lowEnd: 0.25, tone: 300, toneEnd: 110, gain: 0.75 }));
  set("mg", noiseShot(c, { dur: 0.2, decay: 3.2, lowStart: 0.6, lowEnd: 0.14, tone: 150, toneEnd: 48, gain: 1 }));
  set("shotgun", noiseShot(c, { dur: 0.42, decay: 2.4, lowStart: 0.4, lowEnd: 0.06, tone: 120, toneEnd: 38, gain: 1.05 }));
  set("sniper", noiseShot(c, { dur: 0.6, decay: 2, lowStart: 0.5, lowEnd: 0.05, tone: 140, toneEnd: 42, gain: 1.1 }));
  set("knife", metallic(c, 0.18, 1400, 2300, 0.35));
  set("hit", metallic(c, 0.09, 900, 1600, 0.3));
  set("kill", metallic(c, 0.3, 520, 780, 0.3));
  set("reload", metallic(c, 0.16, 620, 1100, 0.3));
  set("pump", metallic(c, 0.2, 700, 1500, 0.3));
  set("dryfire", metallic(c, 0.07, 1200, 2100, 0.25));
  set("victory", metallic(c, 1.2, 330, 494, 0.25));
  set("spawn", noiseShot(c, { dur: 0.9, decay: 1.6, lowStart: 0.08, lowEnd: 0.5, tone: 90, toneEnd: 420, gain: 0.6 }));
}

/* ------------------------------------------------------------------ */
/* Sample loading                                                      */
/* ------------------------------------------------------------------ */

async function loadOne(c: AudioContext, kind: Kind, url: string) {
  try {
    const res = await fetch(url, { cache: "force-cache" });
    if (!res.ok) return;
    const data = await res.arrayBuffer();
    const buf = await c.decodeAudioData(data);
    buffers.set(kind, buf); // replaces the fallback
  } catch {
    /* keep the procedural fallback */
  }
}

function loadSamples(c: AudioContext) {
  if (loadStarted) return;
  loadStarted = true;
  // Guns first so the very first trigger is already the real thing, then the
  // rest. Requests are tiny (~10 KB each) and fully parallel.
  const order: Kind[] = [
    "rifle",
    "pistol",
    "deagle",
    "smg",
    "mg",
    "shotgun",
    "sniper",
    "carbine",
    "knife",
    "hit",
    "kill",
    "reload",
    "pump",
    "dryfire",
    "spawn",
    "victory",
  ];
  for (const k of order) void loadOne(c, k, SOURCES[k]);
}

/* ------------------------------------------------------------------ */
/* Public API                                                          */
/* ------------------------------------------------------------------ */

/** Must be called from a user gesture (click / keypress). Safe to call often. */
export function initSfx() {
  if (ctx) {
    if (ctx.state === "suspended") void ctx.resume();
    return;
  }
  const Ctor: typeof AudioContext | undefined =
    typeof window === "undefined"
      ? undefined
      : window.AudioContext ??
        (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctor) return;
  ctx = new Ctor({ latencyHint: "interactive" });
  master = ctx.createGain();
  master.gain.value = muted ? 0 : MASTER_GAIN;
  // Glue compressor: keeps overlapping full-auto shots punchy instead of clipping.
  comp = ctx.createDynamicsCompressor();
  comp.threshold.value = -14;
  comp.knee.value = 22;
  comp.ratio.value = 5;
  comp.attack.value = 0.002;
  comp.release.value = 0.16;
  master.connect(comp);
  comp.connect(ctx.destination);
  buildFallbacks(ctx);
  loadSamples(ctx);
}

/** Preload+decode without a gesture is not possible, but the bytes can be warmed. */
export function warmSfx() {
  if (typeof window === "undefined") return;
  for (const url of Object.values(SOURCES)) void fetch(url, { cache: "force-cache" }).catch(() => {});
}

/**
 * @param volume  0..1 linear gain
 * @param detune  playback-rate offset, e.g. 0.03 = +3% pitch
 */
export function playSfx(kind: Kind, volume = 1, detune = 0) {
  if (!ctx || !master || muted || volume <= 0.004) return;
  const buf = buffers.get(kind);
  if (!buf) return;

  const now = performance.now();
  const gap = RETRIGGER_MS[kind] ?? 0;
  if (gap > 0 && now - (lastPlayed.get(kind) ?? -1e9) < gap) return;
  if (voices >= MAX_VOICES) return;
  lastPlayed.set(kind, now);

  const src = ctx.createBufferSource();
  src.buffer = buf;
  src.playbackRate.value = Math.max(0.5, 1 + detune);
  const g = ctx.createGain();
  g.gain.value = Math.min(1, volume);
  src.connect(g);
  g.connect(master);
  voices++;
  src.onended = () => {
    voices--;
    src.disconnect();
    g.disconnect();
  };
  src.start();
}

/**
 * Distance-attenuated one-shot — used for other fighters' guns so the arena
 * has depth without a full 3D panner graph per shot.
 */
export function playSfxAt(kind: Kind, distance: number, baseVolume = 1, detune = 0) {
  const falloff = 1 / (1 + (distance / 14) ** 1.6);
  const v = baseVolume * falloff;
  if (v < 0.02) return; // inaudible — skip the work entirely
  playSfx(kind, v, detune + (distance > 40 ? -0.03 : 0));
}

export function setSfxMuted(next: boolean) {
  muted = next;
  if (master && ctx) master.gain.setTargetAtTime(next ? 0 : MASTER_GAIN, ctx.currentTime, 0.02);
}

export function isSfxMuted() {
  return muted;
}

/** Call when the tab loses focus to stop burning CPU on audio. */
export function suspendSfx() {
  if (ctx && ctx.state === "running") void ctx.suspend();
}

export function resumeSfx() {
  if (ctx && ctx.state === "suspended") void ctx.resume();
}

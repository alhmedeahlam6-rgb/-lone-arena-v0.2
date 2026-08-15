import ak47 from "@/assets/weapons/ak47.png";
import m4a1 from "@/assets/weapons/m4a1.png";
import scar from "@/assets/weapons/scar.png";
import mp40 from "@/assets/weapons/mp40.png";
import ump from "@/assets/weapons/ump.png";
import m1014 from "@/assets/weapons/m1014.png";
import spas12 from "@/assets/weapons/spas12.png";
import awm from "@/assets/weapons/awm.png";
import kar98k from "@/assets/weapons/kar98k.png";
import m249 from "@/assets/weapons/m249.png";
import deagle from "@/assets/weapons/deagle.png";
import knife from "@/assets/weapons/knife.png";

export type WeaponClass = "Assault" | "SMG" | "Shotgun" | "Sniper" | "Heavy" | "Pistol" | "Melee";

export type Weapon = {
  id: string;
  name: string;
  cls: WeaponClass;
  price: number;
  damage: number;
  fireRate: number;
  range: number;
  image: string;
  magazine: number;
};

export const STARTING_CREDITS = 6000;

export const HEAVY_CLASSES: WeaponClass[] = ["Assault", "SMG", "Shotgun", "Sniper", "Heavy"];

export const isHeavy = (w: Weapon) => HEAVY_CLASSES.includes(w.cls);

/** Loadout rule: up to 2 heavy weapons + exactly one sidearm (pistol or knife). */
export const MAX_HEAVY = 2;

export const WEAPONS: Weapon[] = [
  { id: "ak47", name: "AK47", cls: "Assault", price: 2500, damage: 61, fireRate: 61, range: 72, magazine: 30, image: ak47 },
  { id: "m4a1", name: "M4A1", cls: "Assault", price: 2400, damage: 54, fireRate: 66, range: 70, magazine: 30, image: m4a1 },
  { id: "scar", name: "SCAR", cls: "Assault", price: 2600, damage: 57, fireRate: 60, range: 68, magazine: 30, image: scar },
  { id: "mp40", name: "MP40", cls: "SMG", price: 1800, damage: 48, fireRate: 83, range: 42, magazine: 32, image: mp40 },
  { id: "ump", name: "UMP", cls: "SMG", price: 1700, damage: 45, fireRate: 76, range: 46, magazine: 25, image: ump },
  { id: "m1014", name: "M1014", cls: "Shotgun", price: 2100, damage: 88, fireRate: 34, range: 20, magazine: 7, image: m1014 },
  { id: "spas12", name: "SPAS12", cls: "Shotgun", price: 2200, damage: 95, fireRate: 28, range: 22, magazine: 6, image: spas12 },
  { id: "awm", name: "AWM", cls: "Sniper", price: 4500, damage: 100, fireRate: 18, range: 96, magazine: 5, image: awm },
  { id: "kar98k", name: "KAR98K", cls: "Sniper", price: 3200, damage: 90, fireRate: 22, range: 90, magazine: 5, image: kar98k },
  { id: "m249", name: "M249", cls: "Heavy", price: 3800, damage: 52, fireRate: 72, range: 64, magazine: 100, image: m249 },
  { id: "deagle", name: "DESERT EAGLE", cls: "Pistol", price: 1200, damage: 70, fireRate: 30, range: 38, magazine: 7, image: deagle },
  { id: "knife", name: "COMBAT KNIFE", cls: "Melee", price: 300, damage: 100, fireRate: 55, range: 2, magazine: 0, image: knife },
];

export const getWeapon = (id: string | null) => WEAPONS.find((w) => w.id === id) ?? null;

/**
 * Combat stats. Health is 200 and every gun caps at 35 damage per bullet,
 * except the Desert Eagle which is the designated hand cannon at 60.
 */
export function getWeaponDamage(w: Weapon) {
  if (w.id === "deagle") return 60;
  return Math.min(35, Math.max(8, Math.round(w.damage / 2)));
}

export function getWeaponRange(w: Weapon) {
  return 20 + (w.range / 100) * 180;
}

export function getWeaponFireInterval(w: Weapon) {
  const b = getWeaponBehavior(w.id);
  // interval is meaningful for auto/burst; for single-action weapons the cycle is the real delay.
  return b.interval || b.cycle || 0.3;
}

export type FireMode = "auto" | "burst" | "single" | "pump" | "bolt" | "melee";

export type WeaponBehavior = {
  /** how the trigger works */
  mode: FireMode;
  /** seconds between shots (or between burst shots) */
  interval: number;
  /** extra delay after a burst / pump / bolt cycle */
  cycle: number;
  /** bullets fired per trigger pull (shotgun pellets / burst length) */
  shots: number;
  /** cone of fire in radians */
  spread: number;
  /** recoil kick multiplier */
  recoil: number;
  /** audio flavour */
  sound: "rifle" | "carbine" | "smg" | "shotgun" | "sniper" | "mg" | "pistol" | "deagle" | "knife";
};

const BEHAVIORS: Record<string, WeaponBehavior> = {
  ak47:   { mode: "auto",   interval: 0.10, cycle: 0,    shots: 1, spread: 0.014, recoil: 1.15, sound: "rifle" },
  m4a1:   { mode: "auto",   interval: 0.09, cycle: 0,    shots: 1, spread: 0.010, recoil: 0.85, sound: "carbine" },
  scar:   { mode: "burst",  interval: 0.07, cycle: 0.34, shots: 3, spread: 0.011, recoil: 1.0,  sound: "rifle" },
  mp40:   { mode: "auto",   interval: 0.07, cycle: 0,    shots: 1, spread: 0.020, recoil: 0.7,  sound: "smg" },
  ump:    { mode: "auto",   interval: 0.075,cycle: 0,    shots: 1, spread: 0.018, recoil: 0.65, sound: "smg" },
  m1014:  { mode: "pump",   interval: 0,    cycle: 0.72, shots: 6, spread: 0.055, recoil: 1.8,  sound: "shotgun" },
  spas12: { mode: "pump",   interval: 0,    cycle: 0.85, shots: 7, spread: 0.065, recoil: 2.0,  sound: "shotgun" },
  awm:    { mode: "bolt",   interval: 0,    cycle: 1.55, shots: 1, spread: 0.0,   recoil: 2.4,  sound: "sniper" },
  kar98k: { mode: "bolt",   interval: 0,    cycle: 1.25, shots: 1, spread: 0.001, recoil: 2.1,  sound: "sniper" },
  m249:   { mode: "auto",   interval: 0.075,cycle: 0,    shots: 1, spread: 0.024, recoil: 1.05, sound: "mg" },
  deagle: { mode: "single", interval: 0,    cycle: 0.40, shots: 1, spread: 0.003, recoil: 1.7,  sound: "deagle" },
  knife:  { mode: "melee",  interval: 0,    cycle: 0.45, shots: 1, spread: 0.0,   recoil: 0.3,  sound: "knife" },
};


const DEFAULT_BEHAVIOR: WeaponBehavior = {
  mode: "single",
  interval: 0,
  cycle: 0.3,
  shots: 1,
  spread: 0.01,
  recoil: 1,
  sound: "pistol",
};

export function getWeaponBehavior(id: string | null): WeaponBehavior {
  return (id ? BEHAVIORS[id] : null) ?? DEFAULT_BEHAVIOR;
}

export const MAGAZINES: Record<string, number> = {
  ak47: 30,
  m4a1: 30,
  scar: 30,
  mp40: 32,
  ump: 25,
  m1014: 7,
  spas12: 6,
  awm: 5,
  kar98k: 5,
  m249: 100,
  deagle: 7,
  knife: 0,
};

export function getMagazine(id: string | null) {
  return (id ? MAGAZINES[id] : null) ?? 30;
}

export const RESERVE_AMMO: Record<string, number> = {
  ak47: 90,
  m4a1: 90,
  scar: 90,
  mp40: 96,
  ump: 75,
  m1014: 28,
  spas12: 24,
  awm: 20,
  kar98k: 20,
  m249: 200,
  deagle: 21,
  knife: 0,
};

export function getReserveAmmo(id: string | null) {
  return (id ? RESERVE_AMMO[id] : null) ?? 90;
}

export function getReloadTime(id: string | null) {
  const w = getWeapon(id);
  if (!w) return 1.5;
  if (w.cls === "Sniper") return 2.6;
  if (w.cls === "Shotgun") return 2.2;
  if (w.cls === "Heavy") return 3.2;
  if (w.cls === "Pistol") return 1.2;
  if (w.cls === "Melee") return 0;
  return 1.8;
}

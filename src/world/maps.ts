// The three sandbox layouts. Each builds terrain, water, props, characters,
// machines and light/dark zones from the same set of interactable pieces.

import type { Game } from '../game';
import { RGB, Vec } from '../core/math';
import type { Theme } from '../render/background';
import type { TerrainPalette } from './terrain';
import { Block } from './blocks';
import { Generator, Lamp } from './machines';
import { Tree } from './tree';

export interface MapDef {
  name: string;
  theme: Theme;
  w: number;
  h: number;
  ambient: number;
  tint: RGB;
  palette: TerrainPalette;
  moteColor: RGB;
  build(g: Game): Vec;
  drawBack?(ctx: CanvasRenderingContext2D, view: { x0: number; y0: number; x1: number; y1: number }, t: number): void;
  drawFront?(ctx: CanvasRenderingContext2D, view: { x0: number; y0: number; x1: number; y1: number }, t: number): void;
}

const crateStack = (g: Game, x: number, gy: number, cols: number, rows: number, size = 44) => {
  for (let r = 0; r < rows; r++) {
    const n = cols - (r > 0 && cols > 2 ? Math.floor(r / 1) : 0);
    for (let c = 0; c < n; c++) {
      g.spawnProp({ kind: 'crate', x: x + (c + r * 0.5) * (size + 1), y: gy - size / 2 - r * size, w: size, h: size });
    }
  }
};

// ----------------------------------------------------------------- TRAINING YARD
const yard: MapDef = {
  name: 'Training Yard',
  theme: 'yard',
  w: 4200, h: 1400,
  ambient: 0.46,
  tint: [6, 8, 22],
  palette: { ground: [18, 20, 30], groundTop: [40, 44, 58], rim: [90, 120, 110] },
  moteColor: [170, 190, 255],
  build(g) {
    const T = g.terrain;
    const GY = 1100;
    // ground with a pool basin
    T.add(0, GY, 1750, 300, 'ground');
    T.add(1750, GY + 170, 520, 130, 'dirt');
    T.add(2270, GY, 1930, 300, 'ground');
    g.water.add(1750, GY + 14, 520, 156);
    // platforms
    T.add(420, GY - 150, 190, 14, 'wood', { oneway: true });
    T.add(700, GY - 270, 170, 14, 'wood', { oneway: true });
    T.add(1520, GY - 160, 200, 30, 'stone');
    T.add(2320, GY - 190, 180, 14, 'wood', { oneway: true });
    // dummy row + lamp post (bright area)
    for (let i = 0; i < 4; i++) g.addDummy(820 + i * 95, GY);
    g.addEntity(new Lamp(1165, GY - 200, true, 330, [255, 225, 170]));
    T.add(1161, GY - 200, 8, 200, 'metal');
    // strawmen
    for (let i = 0; i < 3; i++) g.addStrawman(1230 + i * 95, GY);
    // crate stacks & hay
    crateStack(g, 2440, GY, 3, 3);
    g.spawnProp({ kind: 'barrel', x: 2640, y: GY - 28, w: 34, h: 56 });
    g.spawnProp({ kind: 'barrel', x: 2680, y: GY - 28, w: 34, h: 56 });
    for (let i = 0; i < 3; i++) g.spawnProp({ kind: 'hay', x: 2800 + i * 60, y: GY - 18, w: 58, h: 36 });
    g.spawnProp({ kind: 'hay', x: 2830, y: GY - 54, w: 58, h: 36 });
    g.spawnProp({ kind: 'hay', x: 2890, y: GY - 54, w: 58, h: 36 });
    g.spawnProp({ kind: 'hay', x: 2860, y: GY - 90, w: 58, h: 36 });
    // stone blocks to topple
    for (let r = 0; r < 4; r++) g.spawnProp({ kind: 'stoneblock', x: 3080, y: GY - 25 - r * 50, w: 60, h: 50 });
    g.spawnProp({ kind: 'metalbox', x: 3180, y: GY - 25, w: 50, h: 50 });
    // hill with a boulder
    T.add(3300, GY - 120, 500, 120, 'ground');
    T.add(3800, GY - 60, 120, 60, 'ground');
    g.spawnProp({ kind: 'boulder', x: 3340, y: GY - 160, r: 34 });
    // thick bunker wall with hidden space behind
    T.add(3560, GY - 380, 60, 260, 'thick');
    T.add(3560, GY - 400, 400, 20, 'concrete');
    T.add(3940, GY - 400, 60, 280, 'thick');
    g.lighting.zones.push({ x: 3620, y: GY - 380, w: 320, h: 260, light: -0.5 });
    g.addDummy(3760, GY - 120);
    g.spawnProp({ kind: 'crate', x: 3700, y: GY - 142, w: 40, h: 40 });
    // dark shed (wood structure)
    T.add(150, GY - 220, 14, 160, 'wood');
    T.add(150, GY - 230, 260, 14, 'wood');
    g.lighting.zones.push({ x: 164, y: GY - 216, w: 246, h: 216, light: -0.45 });
    g.spawnProp({ kind: 'crate', x: 260, y: GY - 22, w: 40, h: 40 });
    // breakable wall
    g.addBlock(new Block(3240, GY - 170, 30, 170, 'wall'));
    // floating log on the pool
    g.spawnProp({ kind: 'log', x: 1900, y: GY, w: 120, h: 18 });
    g.spawnProp({ kind: 'crate', x: 2100, y: GY - 10, w: 40, h: 40 });
    // wandering NPCs
    g.addNpc(2700, GY, '#9fd0ff');
    g.addNpc(3050, GY, '#b8f0b0');
    return { x: 300, y: GY - 60 };
  },
};

// ----------------------------------------------------------------- INDUSTRIAL
const industrial: MapDef = {
  name: 'Industrial Zone',
  theme: 'industrial',
  w: 4600, h: 1700,
  ambient: 0.32,
  tint: [10, 6, 12],
  palette: { ground: [22, 20, 24], groundTop: [48, 46, 52], rim: [150, 120, 70] },
  moteColor: [255, 190, 140],
  build(g) {
    const T = g.terrain;
    const GY = 1300;
    T.add(0, GY, 2560, 400, 'concrete');
    T.add(2700, GY, 1900, 400, 'concrete');
    // generator 1 + lamps of room A + door 1
    const gen1 = g.addEntity(new Generator(560, GY)) as Generator;
    T.add(400, GY - 30, 60, 30, 'metal');
    // Room A: bright (always-on lamps)
    T.add(860, GY - 330, 620, 24, 'metal');
    T.add(860, GY - 330, 24, 230, 'metal');
    const lampA1 = g.addEntity(new Lamp(1020, GY - 300, true, 300)) as Lamp;
    const lampA2 = g.addEntity(new Lamp(1300, GY - 300, true, 300)) as Lamp;
    void lampA1; void lampA2;
    for (let i = 0; i < 3; i++) g.addDummy(1000 + i * 110, GY);
    g.spawnProp({ kind: 'metalbox', x: 940, y: GY - 25, w: 50, h: 50 });
    g.spawnProp({ kind: 'metalbox', x: 940, y: GY - 75, w: 50, h: 50 });
    // door 1 (opens when gen1 powered)
    const door1 = g.addBlock(new Block(1456, GY - 306, 24, 306, 'door'));
    // Room B: dark (powered lamp only)
    T.add(1480, GY - 330, 640, 24, 'metal');
    const lampB = g.addEntity(new Lamp(1800, GY - 300, false, 320, [170, 220, 255])) as Lamp;
    gen1.links.push(door1, lampB);
    g.lighting.zones.push({ x: 1480, y: GY - 306, w: 640, h: 306, light: -0.55 });
    crateStack(g, 1560, GY, 2, 2);
    g.spawnProp({ kind: 'barrel', x: 1900, y: GY - 28, w: 34, h: 56, mat: 'metal' });
    g.addDummy(1980, GY);
    g.addNpc(1700, GY, '#ffd08f');
    // thick wall + sealed room behind it (phase in!)
    T.add(2120, GY - 420, 110, 420, 'thick');
    T.add(2230, GY - 420, 330, 24, 'concrete');
    T.add(2560, GY - 420, 60, 420, 'thick');
    g.lighting.zones.push({ x: 2230, y: GY - 396, w: 330, h: 396, light: -0.6 });
    g.addDummy(2320, GY);
    g.addDummy(2440, GY);
    g.spawnProp({ kind: 'metalbox', x: 2500, y: GY - 25, w: 46, h: 46 });
    // drop shaft (2560..2700) down to the lower level
    T.add(2620, GY + 300, 1600, 100, 'concrete');
    T.add(2560, GY, 60, 300, 'concrete');
    T.add(2620, GY, 80, 20, 'metal', { oneway: true });
    for (let i = 0; i < 3; i++) T.add(2640 + (i % 2) * 80, GY + 70 + i * 75, 90, 12, 'metal', { oneway: true });
    // lower level: flooded basin + pipes
    T.add(2700, GY, 900, 40, 'metal');
    g.water.add(3000, GY + 180, 520, 120);
    T.add(3520, GY + 140, 400, 160, 'concrete');
    T.add(2700, GY + 40, 300, 260, 'concrete');
    T.add(2700, GY + 210, 300, 90, 'concrete');
    g.lighting.zones.push({ x: 2620, y: GY + 40, w: 1300, h: 260, light: -0.35, tint: [80, 140, 255] });
    g.addEntity(new Lamp(3300, GY + 70, true, 240, [120, 200, 255]));
    g.addDummy(3720, GY + 140);
    // right side: generator 2, catwalks, beams, door 2
    T.add(3600, GY, 1000, 40, 'concrete');
    const gen2 = g.addEntity(new Generator(3800, GY)) as Generator;
    const lampC = g.addEntity(new Lamp(4100, GY - 280, false, 340, [255, 120, 90])) as Lamp;
    const door2 = g.addBlock(new Block(4300, GY - 260, 24, 260, 'door'));
    gen2.links.push(lampC, door2);
    T.add(4324, GY - 284, 276, 24, 'metal');
    g.lighting.zones.push({ x: 4324, y: GY - 260, w: 276, h: 260, light: -0.4 });
    g.addDummy(4450, GY);
    T.add(3950, GY - 200, 220, 16, 'metal', { oneway: true });
    T.add(3000, GY - 220, 300, 16, 'metal', { oneway: true });
    g.spawnProp({ kind: 'beam', x: 3150, y: GY - 240, w: 160, h: 14 });
    g.spawnProp({ kind: 'metalbox', x: 3100, y: GY - 260, w: 36, h: 36 });
    // breakable wall
    g.addBlock(new Block(3460, GY - 180, 34, 180, 'wall'));
    crateStack(g, 4000, GY, 2, 2);
    g.addNpc(3900, GY, '#ffb0a0');
    return { x: 200, y: GY - 60 };
  },
  drawBack(ctx, view) {
    // pipes along walls
    ctx.strokeStyle = '#2a2a30';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(Math.max(0, view.x0), 880); ctx.lineTo(Math.min(4600, view.x1), 880);
    ctx.moveTo(Math.max(0, view.x0), 905); ctx.lineTo(Math.min(4600, view.x1), 905);
    ctx.stroke();
    ctx.fillStyle = '#3a3238';
    for (let x = Math.floor(view.x0 / 300) * 300; x < view.x1; x += 300) ctx.fillRect(x, 870, 12, 46);
  },
};

// ----------------------------------------------------------------- RUINS
const ruins: MapDef = {
  name: 'Ruins / Forest Edge',
  theme: 'ruins',
  w: 4800, h: 1700,
  ambient: 0.38,
  tint: [4, 10, 10],
  palette: { ground: [14, 20, 18], groundTop: [34, 46, 38], rim: [70, 130, 90] },
  moteColor: [160, 255, 200],
  build(g) {
    const T = g.terrain;
    const GY = 1250;
    // forest edge: trees + strawmen field
    T.add(0, GY, 1900, 450, 'ground');
    for (const [x, h] of [[120, 200], [330, 240], [560, 180], [1650, 220], [1800, 190]] as const) g.addEntity(new Tree(x, GY, h, x));
    for (let i = 0; i < 3; i++) g.addStrawman(780 + i * 90, GY);
    // wooden watch tower made of dynamic logs/planks (flammable)
    T.add(1100, GY - 220, 220, 14, 'wood', { oneway: true });
    g.spawnProp({ kind: 'log', x: 1110, y: GY - 103, w: 16, h: 206 });
    g.spawnProp({ kind: 'log', x: 1310, y: GY - 103, w: 16, h: 206 });
    g.spawnProp({ kind: 'crate', x: 1210, y: GY - 244, w: 40, h: 40 });
    g.spawnProp({ kind: 'hay', x: 1210, y: GY - 18, w: 58, h: 36 });
    g.addNpc(1400, GY, '#d8f0a0');
    // river
    T.add(1900, GY + 200, 800, 250, 'dirt');
    g.water.add(1900, GY + 20, 800, 180);
    g.spawnProp({ kind: 'log', x: 2100, y: GY, w: 150, h: 20 });
    g.spawnProp({ kind: 'log', x: 2400, y: GY, w: 130, h: 20 });
    // ruins: pillars & stone blocks
    T.add(2700, GY, 2100, 450, 'ground');
    T.add(2800, GY - 300, 50, 300, 'stone');
    T.add(3060, GY - 300, 50, 300, 'stone');
    T.add(2780, GY - 330, 350, 30, 'stone');
    for (let i = 0; i < 3; i++) g.spawnProp({ kind: 'stoneblock', x: 2950, y: GY - 25 - i * 50, w: 54, h: 50 });
    g.spawnProp({ kind: 'boulder', x: 2955, y: GY - 360, r: 28 });
    g.addDummy(2900, GY);
    g.addDummy(3010, GY);
    g.addBlock(new Block(3250, GY - 200, 40, 200, 'wall'));
    // cave: rock ceiling, dark tunnels
    T.add(3400, GY - 460, 1400, 200, 'stone');
    T.add(3400, GY - 260, 120, 150, 'stone');
    g.lighting.zones.push({ x: 3520, y: GY - 260, w: 1280, h: 260, light: -0.65 });
    // tight tunnel: lowered ceiling
    T.add(3900, GY - 260, 400, 160, 'stone');
    g.addDummy(3700, GY);
    g.addDummy(4500, GY);
    g.spawnProp({ kind: 'crate', x: 4600, y: GY - 22, w: 40, h: 40 });
    // a single torch-lamp deep inside (break it with a rock for darkness)
    g.addEntity(new Lamp(4450, GY - 230, true, 220, [255, 170, 90]));
    // more trees beyond
    g.addEntity(new Tree(2760, GY, 160, 7));
    return { x: 300, y: GY - 60 };
  },
};

export const MAPS: MapDef[] = [yard, industrial, ruins];

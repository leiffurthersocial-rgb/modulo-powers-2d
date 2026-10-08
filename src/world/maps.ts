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

// All maps are single-screen arenas (1600 x 1000) that the camera fits to the
// screen. Ground sits at y=850 so the HUD covers only sky and bedrock.
const W = 1600, H = 1000, GY = 850;

// ----------------------------------------------------------------- TRAINING YARD
const yard: MapDef = {
  name: 'Training Yard',
  theme: 'yard',
  w: W, h: H,
  ambient: 0.56,
  tint: [6, 8, 22],
  palette: { ground: [18, 20, 30], groundTop: [40, 44, 58], rim: [90, 120, 110] },
  moteColor: [170, 190, 255],
  build(g) {
    const T = g.terrain;
    // ground with a pool basin
    T.add(0, GY, 880, H - GY, 'ground');
    T.add(880, GY + 130, 280, H - GY - 130, 'dirt');
    T.add(1160, GY, W - 1160, H - GY, 'ground');
    g.water.add(880, GY + 14, 280, 116);
    g.spawnProp({ kind: 'log', x: 1000, y: GY, w: 110, h: 18 });
    // bunker: thick wall with a dark room and a dummy behind it (phase in!)
    T.add(130, GY - 230, 50, 230, 'thick');
    T.add(0, GY - 254, 180, 24, 'concrete');
    g.lighting.zones.push({ x: 0, y: GY - 230, w: 130, h: 230, light: -0.55 });
    g.addDummy(62, GY);
    // lamp post + dummy row
    T.add(336, GY - 210, 8, 210, 'metal');
    g.addEntity(new Lamp(340, GY - 210, true, 320, [255, 225, 170]));
    for (let i = 0; i < 3; i++) g.addDummy(440 + i * 80, GY);
    for (let i = 0; i < 2; i++) g.addStrawman(700 + i * 80, GY);
    // platforms
    T.add(150, GY - 150, 150, 14, 'wood', { oneway: true });
    T.add(930, GY - 230, 180, 14, 'wood', { oneway: true });
    T.add(1240, GY - 350, 170, 24, 'stone');
    g.spawnProp({ kind: 'boulder', x: 1290, y: GY - 390, r: 30 });
    // crates, hay, stone
    crateStack(g, 1215, GY, 2, 2);
    for (let i = 0; i < 2; i++) g.spawnProp({ kind: 'hay', x: 1380 + i * 60, y: GY - 18, w: 58, h: 36 });
    g.spawnProp({ kind: 'hay', x: 1410, y: GY - 54, w: 58, h: 36 });
    for (let r = 0; r < 2; r++) g.spawnProp({ kind: 'stoneblock', x: 1540, y: GY - 25 - r * 50, w: 56, h: 50 });
    g.addNpc(1330, GY, '#9fd0ff');
    return { x: 270, y: GY - 60 };
  },
};

// ----------------------------------------------------------------- INDUSTRIAL
const industrial: MapDef = {
  name: 'Industrial Zone',
  theme: 'industrial',
  w: W, h: H,
  ambient: 0.42,
  tint: [10, 6, 12],
  palette: { ground: [22, 20, 24], groundTop: [48, 46, 52], rim: [150, 120, 70] },
  moteColor: [255, 190, 140],
  build(g) {
    const T = g.terrain;
    T.add(0, GY, 1300, H - GY, 'concrete');
    T.add(1300, GY + 110, 220, H - GY - 110, 'concrete');
    T.add(1520, GY, W - 1520, H - GY, 'concrete');
    // generator + steps up to the roof
    const gen = g.addEntity(new Generator(110, GY)) as Generator;
    T.add(30, GY - 190, 130, 14, 'metal', { oneway: true });
    T.add(150, GY - 330, 100, 14, 'metal', { oneway: true });
    // Room A (bright) and Room B (dark), shared roof
    T.add(240, GY - 270, 800, 24, 'metal');
    T.add(240, GY - 270, 22, 150, 'metal');
    g.addEntity(new Lamp(440, GY - 240, true, 300));
    g.addDummy(390, GY);
    g.addDummy(510, GY);
    g.spawnProp({ kind: 'metalbox', x: 300, y: GY - 25, w: 46, h: 46 });
    const door = g.addBlock(new Block(616, GY - 246, 24, 246, 'door'));
    const lampB = g.addEntity(new Lamp(840, GY - 240, false, 300, [170, 220, 255])) as Lamp;
    gen.links.push(door, lampB);
    g.lighting.zones.push({ x: 640, y: GY - 246, w: 400, h: 246, light: -0.55 });
    crateStack(g, 690, GY, 2, 1);
    g.spawnProp({ kind: 'barrel', x: 900, y: GY - 28, w: 34, h: 56, mat: 'metal' });
    g.addDummy(980, GY);
    g.addNpc(800, GY, '#ffd08f');
    // catwalk above the roof
    T.add(420, GY - 430, 420, 14, 'metal', { oneway: true });
    g.spawnProp({ kind: 'metalbox', x: 620, y: GY - 450, w: 36, h: 36 });
    // thick wall sealing a dark tank room on the right
    T.add(1040, GY - 430, 70, 430, 'thick');
    T.add(1110, GY - 430, W - 1110, 24, 'concrete');
    g.lighting.zones.push({ x: 1110, y: GY - 406, w: W - 1110, h: 516, light: -0.6 });
    g.water.add(1300, GY + 10, 220, 100);
    g.addDummy(1200, GY);
    g.addDummy(1560, GY);
    g.spawnProp({ kind: 'metalbox', x: 1410, y: GY - 10, w: 40, h: 40 });
    return { x: 200, y: GY - 60 };
  },
  drawBack(ctx) {
    // pipes along the back wall
    ctx.strokeStyle = '#2a2a30';
    ctx.lineWidth = 12;
    ctx.beginPath();
    ctx.moveTo(0, GY - 120); ctx.lineTo(W, GY - 120);
    ctx.moveTo(0, GY - 96); ctx.lineTo(W, GY - 96);
    ctx.stroke();
    ctx.fillStyle = '#3a3238';
    for (let x = 60; x < W; x += 220) ctx.fillRect(x, GY - 130, 12, 46);
  },
};

// ----------------------------------------------------------------- RUINS
const ruins: MapDef = {
  name: 'Ruins / Forest Edge',
  theme: 'ruins',
  w: W, h: H,
  ambient: 0.48,
  tint: [4, 10, 10],
  palette: { ground: [14, 20, 18], groundTop: [34, 46, 38], rim: [70, 130, 90] },
  moteColor: [160, 255, 200],
  build(g) {
    const T = g.terrain;
    T.add(0, GY, 760, H - GY, 'ground');
    T.add(760, GY + 150, 280, H - GY - 150, 'dirt');
    T.add(1040, GY, W - 1040, H - GY, 'ground');
    // forest edge
    g.addEntity(new Tree(70, GY, 210, 3));
    g.addEntity(new Tree(195, GY, 170, 5));
    for (let i = 0; i < 2; i++) g.addStrawman(380 + i * 75, GY);
    // little watch tower (flammable logs)
    T.add(535, GY - 190, 170, 14, 'wood', { oneway: true });
    g.spawnProp({ kind: 'log', x: 548, y: GY - 88, w: 14, h: 176 });
    g.spawnProp({ kind: 'log', x: 692, y: GY - 88, w: 14, h: 176 });
    g.spawnProp({ kind: 'crate', x: 620, y: GY - 214, w: 40, h: 40 });
    g.spawnProp({ kind: 'hay', x: 620, y: GY - 18, w: 58, h: 36 });
    g.addNpc(510, GY, '#d8f0a0');
    // river
    g.water.add(760, GY + 16, 280, 134);
    g.spawnProp({ kind: 'log', x: 870, y: GY, w: 120, h: 20 });
    // stone arch with a boulder on top
    T.add(1080, GY - 260, 40, 260, 'stone');
    T.add(1250, GY - 260, 40, 260, 'stone');
    T.add(1060, GY - 290, 250, 30, 'stone');
    g.spawnProp({ kind: 'boulder', x: 1185, y: GY - 325, r: 28 });
    g.addDummy(1150, GY);
    g.addDummy(1215, GY);
    // cave: rock mass, breakable entrance, dark tunnel with a torch
    T.add(1320, GY - 330, W - 1320, 180, 'stone');
    g.addBlock(new Block(1320, GY - 150, 34, 150, 'wall'));
    g.lighting.zones.push({ x: 1354, y: GY - 150, w: W - 1354, h: 150, light: -0.65 });
    g.addEntity(new Lamp(1520, GY - 140, true, 170, [255, 170, 90]));
    g.addDummy(1450, GY);
    return { x: 290, y: GY - 60 };
  },
};

export const MAPS: MapDef[] = [yard, industrial, ruins];

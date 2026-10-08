import { RGB } from '../core/math';

export type MatId = 'wood' | 'stone' | 'metal' | 'straw' | 'ice' | 'flesh' | 'ground' | 'rock';

export interface MatDef {
  density: number;
  friction: number;
  restitution: number;
  flammable: boolean;
  conductive: boolean;
  /** hp per 1000 px² of area */
  hpPerArea: number;
  color: RGB;
  dark: RGB;
  /** how much impact speed (px/s) before it takes damage */
  impactThreshold: number;
  burnRate: number;
}

export const MATS: Record<MatId, MatDef> = {
  wood: { density: 0.0011, friction: 0.7, restitution: 0.1, flammable: true, conductive: false, hpPerArea: 25, color: [150, 102, 58], dark: [88, 58, 32], impactThreshold: 520, burnRate: 1 },
  straw: { density: 0.0005, friction: 0.8, restitution: 0.05, flammable: true, conductive: false, hpPerArea: 12, color: [214, 178, 92], dark: [150, 112, 50], impactThreshold: 900, burnRate: 2.2 },
  stone: { density: 0.0028, friction: 0.85, restitution: 0.02, flammable: false, conductive: false, hpPerArea: 55, color: [120, 124, 136], dark: [70, 72, 84], impactThreshold: 600, burnRate: 0 },
  rock: { density: 0.0032, friction: 0.9, restitution: 0.05, flammable: false, conductive: false, hpPerArea: 60, color: [112, 98, 84], dark: [66, 56, 48], impactThreshold: 700, burnRate: 0 },
  metal: { density: 0.0024, friction: 0.45, restitution: 0.15, flammable: false, conductive: true, hpPerArea: 200, color: [126, 140, 156], dark: [60, 70, 84], impactThreshold: 1500, burnRate: 0 },
  ice: { density: 0.0009, friction: 0.02, restitution: 0.05, flammable: false, conductive: false, hpPerArea: 14, color: [170, 225, 255], dark: [90, 150, 200], impactThreshold: 420, burnRate: 0 },
  flesh: { density: 0.001, friction: 0.8, restitution: 0.05, flammable: false, conductive: true, hpPerArea: 0, color: [220, 220, 230], dark: [120, 120, 130], impactThreshold: 700, burnRate: 0.6 },
  ground: { density: 0, friction: 0.8, restitution: 0, flammable: false, conductive: false, hpPerArea: 0, color: [40, 44, 56], dark: [20, 22, 30], impactThreshold: 1e9, burnRate: 0 },
};

export type DmgType = 'blunt' | 'fire' | 'elec' | 'cold' | 'water' | 'shadow' | 'pierce' | 'steam';

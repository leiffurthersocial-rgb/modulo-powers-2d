# MODULO: POWERS

A 2D browser sandbox where you walk around as a stickman and find out what it would feel like to have superpowers: **Lightning, Fire, Water, Earth and Shadow**. There are no levels or goals. It's a toy for throwing lightning, setting crates on fire, freezing a pool into a bridge or slipping through a wall into a dark room.

Everything is procedural. Stickmen and environments are drawn in code, and every sound is synthesized with the Web Audio API. There are no image or audio assets.

## Run it locally

```bash
npm install
npm run dev      # http://localhost:5173
npm run build    # type-check + production build into dist/
npm run preview  # serve the production build
```

Vercel deploys with its defaults (`npm run build` → `dist/`), so there is no `vercel.json`.

## Controls

Designed for an iPad with a hardware keyboard. Keys use physical positions (`event.code`), so QWERTY and QWERTZ behave the same. Esc, Tab and Cmd/Ctrl are never used.

| Action | Keys |
|---|---|
| Move | A / D |
| Jump | W or Space (hold for a higher jump) |
| Crouch / drop through wooden & metal platforms | S |
| Aim | Arrow keys rotate the aim around you. A mouse/trackpad also aims, and a click (or tap) = ability 1 |
| Ability 1 (always an attack) | J |
| Abilities 2 / 3 / 4 | K / L / I |
| Switch power | 1 Lightning · 2 Fire · 3 Water · 4 Earth · 5 Shadow |
| Cycle powers | Q previous / E next |
| Pause (shows all controls) | P |
| Reset map, objects and dummies | R |
| Reset player only | T |
| Next map | N |
| Spawn a dummy or strawman at the aim point | B |
| Toggle auto-aim (locks onto the nearest dummy/NPC in front of you; arrows or mouse override it) | G |
| Slow motion | V |
| Sandbox mode: infinite energy, no cooldowns | F |
| Field guide: tabbed help with every power, controls and Power Lab combos (pauses the game; ← → or 1–5 switch tabs) | H |
| Mute | M |

## The powers

Every power has an attack on **J** plus utility and movement abilities. Energy is shared by Lightning, Fire, Water and Earth and refills quickly. Shadow has its own meter.

### ⚡ Lightning
- **J Lightning Bolt**: an instant forking bolt. It chains through metal, wet targets and conductors, ignites straw and electrifies water. The thunder arrives a moment later.
- **K Sky Strike**: marks a spot and the sky crackles. Then a huge bolt falls with a shockwave, a blinding flash and a scorch crater.
- **L Lightning Dash**: a 0.12 s high-speed run of about 300px along a jagged path with afterimages. It goes the way you're moving (arrows/mouse override that), zips through dummies while shocking them, stops at walls and keeps some momentum.
- **I Overcharge** (hold): static builds up with arcs and a rising hum. On release it powers generators, lamps and doors and sends out an EMP pulse.

### 🔥 Fire
- **J Fireball**: explodes with knockback (yours too, so you can rocket-jump), sets things on fire and leaves ground fire and scorch marks.
- **K Flamethrower** (hold): a sticky stream of fire with heat shimmer. It spreads onto crates, straw and trees, and boils water.
- **L Rocket Boost** (hold): thrust from your hands and feet, steered with A/D. It leaves a smoke trail and scorches whatever is below you.
- **I Heat Wave**: melts ice, boils pools into scalding steam, dries soaked things and singes everything nearby. It also gives you a short ember shield.

### 💧 Water
- **J Water Jet** (hold): a high-pressure stream that knocks dummies back, pins crates, soaks everything and puts out fires.
- **K Tidal Wave**: a wave that rolls along the ground and carries objects and characters with it.
- **L Freeze**: turns pools into walkable ice bridges and freezes soaked targets solid (hit them hard to shatter them). On dry ground it raises an ice wall.
- **I Geyser / Bubble**: tap to launch upward on a geyser (in water it's a swim boost toward your aim). Hold for a floating bubble shield that blocks fire and pushes things away.

### 🪨 Earth
- **J Rock Hurl**: tears a boulder out of the ground and flings it. Heavy, crushing and good for breaking lamps.
- **K Raise Pillar**: a stone pillar erupts at the aim point. Use it as a platform, a launcher, cover or a battering ram.
- **L Earthquake Stomp**: in mid-air you dive first. The shockwave cracks the ground, topples stacks and knocks everyone down.
- **I Stone Armor**: rock plating that makes you heavy, resistant and a battering ram when you run into things. It cracks over time; tap again to burst it.

### 🌑 Shadow
- **J Shadow Strike**: ink-black spikes lash out along the ground and the light around dims.
- **K Invisibility** (toggle): you fade to a heat-haze outline and NPCs lose track of you. Attacking or moving fast partially reveals you.
- **L Shadow Step**: teleport to the aim point. Range and line of sight are limited and you need room to stand. It leaves you briefly disoriented.
- **I Phase** (hold): walk through walls and floors (W/S move you up and down). The screen goes muffled and desaturated. **If your shadow energy runs out while you're inside a wall, you're violently ejected and take damage.**
- **Shadow energy** regenerates fast in darkness, slowly in dim light, and drains under lamps, fire and lightning. The HUD shows whether you're in shadow or exposed.

## Power Lab (combos to discover)
- Lightning + water pool: everything in the water gets shocked, including you.
- Lightning + metal: bolts chain through metal. Overcharge powers generators, which open doors and switch on lamps.
- Water, then lightning: soaked targets take much more shock damage.
- Fire + water: steam clouds that hide things and scald dummies.
- Water + Freeze: ice bridges over pools, and frozen dummies that shatter.
- Fire + ice: Heat Wave and fire melt ice walls and bridges.
- Fire + wood/straw: flames spread from crate to crate and burn things to ash.
- Earth + lamps: break lamps with rocks to make darkness for Shadow.
- Shadow + thick walls: phase into sealed rooms behind them.

## Maps (N to cycle)
1. **Training Yard**: open ground, platforms, a row of dummies under a lamp, strawmen, a pool, crate stacks, hay bales, stone blocks, a boulder on a hill and a dark shed. There's also a thick-walled bunker with a dummy inside.
2. **Industrial Zone**: generators that power doors and lamps, a bright room and a dark room, a thick-walled sealed room, a drop shaft to a flooded lower level, catwalks and breakable walls.
3. **Ruins / Forest Edge**: flammable trees, a wooden watch tower, a river with floating logs, stone ruins and a dark cave with a tight tunnel.

## Tech
- Vite + TypeScript with no framework. **Matter.js** handles rigid bodies, ragdolls and stacking.
- Fixed 60 Hz physics step with render interpolation, plus hit-stop and slow motion via time scaling.
- Canvas 2D rendering:
  - A low-res darkness buffer that lights cut into.
  - An additive glow buffer (`globalCompositeOperation = 'lighter'`) with a cheap downsample bloom.
  - Pooled particles (capped at 2,600, with an adaptive budget).
  - A saturation blend for Phase's desaturated look.
- Dummies and NPCs are **active ragdolls**. Every limb is a physics body, and PD "muscles" pull them toward an animated pose until a hit knocks them out. Then they flop, and later get back up.
- The player is a capsule body with acceleration/deceleration, coyote time, jump buffering, variable jump height, step-up assist, one-way platforms and swimming. The skeleton is animated procedurally with 2-bone IK.
- Audio is built from noise bursts, oscillators and filters, with simple stereo panning and distance falloff. Loops (flamethrower, hum, drone and others) are modulated live.

## Balancing
- Shared energy: 100, regenerating at 20/s after a 0.7 s pause. That's about 10 Lightning Bolts or 5 s of flamethrower before you have to wait. F removes all limits.
- A training dummy has 130 HP and takes about 5 bolts, 3–4 fireballs, 2–3 thrown rocks or 5 shadow strikes. Area abilities (Sky Strike, Quake, Heat Wave) hit everything nearby harder.
- Characters on fire burn for about 3 s instead of until they die. Impact and fall damage apply once per hit rather than once per limb, and a thrown rock's crush damage is capped. Knockback stays big and fun but is no longer automatically lethal.

## Design decisions
- **Aiming with a keyboard**: the arrow keys rotate the aim smoothly toward the pressed direction (Up+Right aims diagonally). When you turn around with A/D, the aim mirrors so it stays in front of you. A mouse or trackpad takes over when it moves.
- **Phase** is weightless (W/S move vertically) so you never sink through floors by accident. You can't re-materialize inside a wall: releasing I there keeps you phasing (and draining) until you're out or ejected.
- **Damage to the player** comes only from the environment: electrified water, fire, steam, falls and Phase ejection. Your own blasts push you but don't hurt you, which is what makes rocket-jumping work.
- **Destroyed dummies** respawn after a few seconds; strawmen respawn too. R restores everything.
- **Performance**: the backing store is capped at about 2.4 MP (DPR ≤ 2). Glow and lighting run at half and quarter resolution. Particles are pooled, and their spawn rate drops when frame time rises.

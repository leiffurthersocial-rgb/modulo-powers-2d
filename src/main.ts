import Matter from 'matter-js';
import { Input } from './core/input';
import { Loop, STEP } from './core/loop';
import { Camera } from './render/camera';

// Milestone 1 bootstrap: fixed-timestep loop, Matter.js world, input, pause, reset.

const canvas = document.getElementById('game') as HTMLCanvasElement;
const ctx = canvas.getContext('2d')!;
const input = new Input(canvas);
const camera = new Camera();
let dpr = 1;

function resize() {
  dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = window.innerWidth, h = window.innerHeight;
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  camera.resize(w, h);
}
window.addEventListener('resize', resize);
resize();
canvas.focus();

const engine = Matter.Engine.create();
engine.gravity.y = 1;
engine.gravity.scale = 0.0016;
let player: Matter.Body;
const prev = new Map<number, { x: number; y: number; a: number }>();

function build() {
  Matter.Composite.clear(engine.world, false);
  prev.clear();
  const ground = Matter.Bodies.rectangle(2000, 1300, 4000, 200, { isStatic: true });
  const wallL = Matter.Bodies.rectangle(-50, 700, 100, 1400, { isStatic: true });
  const wallR = Matter.Bodies.rectangle(4050, 700, 100, 1400, { isStatic: true });
  Matter.Composite.add(engine.world, [ground, wallL, wallR]);
  for (let i = 0; i < 12; i++) {
    Matter.Composite.add(engine.world, Matter.Bodies.rectangle(900 + (i % 4) * 46, 1150 - Math.floor(i / 4) * 46, 44, 44, { friction: 0.6 }));
  }
  player = Matter.Bodies.rectangle(400, 1100, 24, 60, { inertia: Infinity, friction: 0, frictionAir: 0, chamfer: { radius: 10 } });
  Matter.Composite.add(engine.world, player);
  camera.snap(400, 1100);
}
build();

const loop = new Loop({
  frame() {
    input.pollFrame();
    if (input.framePressedKey('KeyP')) loop.paused = !loop.paused;
    if (input.framePressedKey('KeyR')) build();
  },
  step() {
    input.poll();
    for (const b of Matter.Composite.allBodies(engine.world)) prev.set(b.id, { x: b.position.x, y: b.position.y, a: b.angle });
    const dir = (input.isDown('KeyD') ? 1 : 0) - (input.isDown('KeyA') ? 1 : 0);
    const vx = player.velocity.x + (dir * 5 - player.velocity.x) * 0.25;
    let vy = player.velocity.y;
    if ((input.wasPressed('KeyW') || input.wasPressed('Space')) && Math.abs(player.velocity.y) < 0.5) vy = -11.5;
    Matter.Body.setVelocity(player, { x: vx, y: vy });
    Matter.Engine.update(engine, STEP * 1000);
  },
  render(alpha, dt) {
    camera.update(dt, player.position.x, player.position.y, player.velocity.x * 60, 0, 0, 0);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#07080f';
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    camera.apply(ctx, dpr);
    for (const b of Matter.Composite.allBodies(engine.world)) {
      const p = prev.get(b.id);
      const x = p ? p.x + (b.position.x - p.x) * alpha : b.position.x;
      const y = p ? p.y + (b.position.y - p.y) * alpha : b.position.y;
      ctx.save();
      ctx.translate(x - b.position.x, y - b.position.y);
      ctx.beginPath();
      b.vertices.forEach((v, i) => (i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y)));
      ctx.closePath();
      ctx.fillStyle = b === player ? '#ffe36b' : b.isStatic ? '#1a1d2b' : '#6b4a2b';
      ctx.fill();
      ctx.restore();
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#9fb3ff';
    ctx.font = '600 16px system-ui, sans-serif';
    ctx.fillText('MODULO: POWERS (milestone 1): A/D move, W/Space jump, P pause, R reset', 16, 28);
    if (loop.paused) {
      ctx.fillStyle = 'rgba(0,0,0,0.6)';
      ctx.fillRect(0, 0, camera.vw, camera.vh);
      ctx.fillStyle = '#fff';
      ctx.font = '800 48px system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('PAUSED', camera.vw / 2, camera.vh / 2);
      ctx.textAlign = 'left';
    }
  },
});
loop.start();

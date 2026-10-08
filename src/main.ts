import { Game } from './game';

const canvas = document.getElementById('game') as HTMLCanvasElement;
canvas.focus();
const game = new Game(canvas);
game.start();
// keep focus on the canvas so keys always reach the game
window.addEventListener('pointerdown', () => canvas.focus());
document.addEventListener('visibilitychange', () => {
  if (document.hidden && !game.title) game.loop.paused = true;
});

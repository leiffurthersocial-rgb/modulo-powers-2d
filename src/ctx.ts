// Shared game reference. Systems import `G` (a live ES module binding) instead
// of passing the game object through every call.
import type { Game } from './game';

export let G: Game = null as unknown as Game;
export function setGame(g: Game) { G = g; }

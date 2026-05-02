/**
 * Genetic Algorithm per ottimizzare i pesi UtilityAi (DEFAULT_WEIGHTS).
 *
 * Fitness: candidato vs Default su tutti i 9 matchup × N partite × 2 lati = 18N partite.
 * Score = % vittorie del candidato.
 * Mating: top-K parents → crossover (uniform) + Gaussian mutation.
 *
 * Output: best weights + log per analisi.
 */
import { runBattle, AiConfig } from './simulate';
import { DEFAULT_WEIGHTS, UtilityWeights } from '@ai/utilityAi';

type Candidate = { w: UtilityWeights; fitness: number };

const PRESETS = ['spadaccino', 'arciere', 'tank'];

// CLI:
//   --preset <name>    ottimizza pesi A=preset vs default (tutti gli avversari)
//   --vs <name>        + ottimizza vs un avversario specifico
//   nessun arg         ottimizzazione globale (tutti i matchup, entrambi i lati)
const argv = process.argv.slice(2);
const presetIdx = argv.indexOf('--preset');
const TARGET_PRESET = presetIdx >= 0 ? argv[presetIdx + 1] : null;
const vsIdx = argv.indexOf('--vs');
const VS_PRESET = vsIdx >= 0 ? argv[vsIdx + 1] : null;

const MATCHUPS: [string, string][] = [];
if (TARGET_PRESET && VS_PRESET) {
  MATCHUPS.push([TARGET_PRESET, VS_PRESET]);
} else if (TARGET_PRESET) {
  for (const b of PRESETS) MATCHUPS.push([TARGET_PRESET, b]);
} else {
  for (const a of PRESETS) for (const b of PRESETS) MATCHUPS.push([a, b]);
}
console.log(`Target: ${TARGET_PRESET ?? 'GLOBALE'}, vs: ${VS_PRESET ?? 'all'}, matchups: ${MATCHUPS.length}`);

const POP_SIZE = 24;
const N_GENS = 40;
// Auto-scale: più partite per matchup quando ce ne sono pochi (mantenere ~50-72 partite/cand)
const BASE_BATTLES_PER_CAND = 50;
const TOP_K = 8; // elites
const MUTATION_RATE = 0.3;
const MUTATION_SIGMA = 0.3;

const KEYS: (keyof UtilityWeights)[] = [
  'damageDealt', 'damageAvoided', 'closeDistance', 'selfHp', 'saveDice', 'wastedMove'
];

function clone(w: UtilityWeights): UtilityWeights {
  return { ...w };
}

function randomCandidate(): UtilityWeights {
  // Inizializza in range ragionevole (intorno ai default ±0.5)
  const w: UtilityWeights = clone(DEFAULT_WEIGHTS);
  for (const k of KEYS) {
    const base = DEFAULT_WEIGHTS[k];
    w[k] = base + (Math.random() - 0.5) * 1.5;
  }
  return w;
}

function gaussianRandom(): number {
  // Box-Muller
  const u = 1 - Math.random();
  const v = Math.random();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
}

function mutate(w: UtilityWeights): UtilityWeights {
  const out = clone(w);
  for (const k of KEYS) {
    if (Math.random() < MUTATION_RATE) {
      out[k] += gaussianRandom() * MUTATION_SIGMA;
    }
  }
  return out;
}

function crossover(a: UtilityWeights, b: UtilityWeights): UtilityWeights {
  const out: UtilityWeights = clone(a);
  for (const k of KEYS) {
    if (Math.random() < 0.5) out[k] = b[k];
  }
  return out;
}

function evaluate(candidate: UtilityWeights, generation: number): number {
  let wins = 0, total = 0;
  const seedBase = 1000 * (generation + 1);
  for (const [a, b] of MATCHUPS) {
    const nBattles = Math.max(4, Math.ceil(BASE_BATTLES_PER_CAND / MATCHUPS.length));
    for (let i = 0; i < nBattles; i++) {
      // Lato A: candidato (preset target) vs default
      const seedA = seedBase + i;
      const r1 = runBattle(a, b, seedA, 30, false, 5, {
        modeA: 'utility', modeB: 'utility',
        weightsA: candidate, weightsB: DEFAULT_WEIGHTS,
      } as AiConfig);
      total++;
      if (r1.winner === 'A') wins++;
      // Skip "lato B" se TARGET_PRESET (candidato testa solo come A)
      if (!TARGET_PRESET) {
        const seedB = seedBase + i + 500;
        const r2 = runBattle(a, b, seedB, 30, false, 5, {
          modeA: 'utility', modeB: 'utility',
          weightsA: DEFAULT_WEIGHTS, weightsB: candidate,
        } as AiConfig);
        total++;
        if (r2.winner === 'B') wins++;
      }
    }
  }
  return wins / total;
}

function fmt(w: UtilityWeights): string {
  return KEYS.map(k => `${k}=${w[k].toFixed(3)}`).join(' ');
}

// === MAIN ===
const _nBattles = Math.max(4, Math.ceil(BASE_BATTLES_PER_CAND / MATCHUPS.length));
console.log(`GA: pop=${POP_SIZE}, gens=${N_GENS}, battles/cand=${MATCHUPS.length * _nBattles * (TARGET_PRESET ? 1 : 2)}`);
console.log(`Default weights baseline (50%): ${fmt(DEFAULT_WEIGHTS)}\n`);

// Inizializza population
let population: Candidate[] = [];
// Includi default come uno dei seed iniziali
population.push({ w: clone(DEFAULT_WEIGHTS), fitness: 0 });
for (let i = 1; i < POP_SIZE; i++) {
  population.push({ w: randomCandidate(), fitness: 0 });
}

let best: Candidate = { w: clone(DEFAULT_WEIGHTS), fitness: 0.5 };

for (let gen = 0; gen < N_GENS; gen++) {
  const t0 = Date.now();
  // Eval
  for (const c of population) c.fitness = evaluate(c.w, gen);
  population.sort((a, b) => b.fitness - a.fitness);
  const dt = Date.now() - t0;
  const bestGen = population[0];
  const avgFitness = population.reduce((s, c) => s + c.fitness, 0) / population.length;
  console.log(`gen ${gen}: best=${(bestGen.fitness * 100).toFixed(1)}% avg=${(avgFitness * 100).toFixed(1)}% [${dt}ms]  ${fmt(bestGen.w)}`);
  if (bestGen.fitness > best.fitness) best = { w: clone(bestGen.w), fitness: bestGen.fitness };

  // Selection: top K elites + tournament for rest
  const elites = population.slice(0, TOP_K).map(c => ({ w: clone(c.w), fitness: c.fitness }));
  const newPop: Candidate[] = [...elites];
  while (newPop.length < POP_SIZE) {
    const a = elites[Math.floor(Math.random() * elites.length)];
    const b = elites[Math.floor(Math.random() * elites.length)];
    const child: Candidate = { w: mutate(crossover(a.w, b.w)), fitness: 0 };
    newPop.push(child);
  }
  population = newPop;
}

console.log(`\nBEST: fitness=${(best.fitness * 100).toFixed(1)}%`);
console.log(`Weights: ${fmt(best.w)}`);
console.log(`\nDelta vs default:`);
for (const k of KEYS) {
  const delta = best.w[k] - DEFAULT_WEIGHTS[k];
  console.log(`  ${k}: ${DEFAULT_WEIGHTS[k].toFixed(3)} → ${best.w[k].toFixed(3)} (Δ ${delta >= 0 ? '+' : ''}${delta.toFixed(3)})`);
}

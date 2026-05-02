/**
 * Training Tabular Q-learning usando runBattle (gestione phase robusta).
 *
 * Ogni episodio: 1 partita Q vs Q (self-play). Reward terminale solo (±5 win/loss),
 * propagato all'indietro via TD(0) sulle transizioni accumulate durante la partita.
 */
import * as fs from 'fs';
import { runBattle } from './simulate';
import { QTable, QContext, qUpdate, qDecideMove } from '@ai/qLearningAi';

const EPISODES = 1800;
const ALPHA = 0.2;
const GAMMA = 0.9;
const EPS_START = 0.6;
const EPS_END = 0.05;

function mkRng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s + 0x6D2B79F5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return (((t ^ (t >>> 14)) >>> 0) / 4294967296);
  };
}

const PRESET_IDS = ['spadaccino', 'arciere', 'tank'];
const matchups: [string, string][] = [];
for (const a of PRESET_IDS) for (const b of PRESET_IDS) matchups.push([a, b]);

const table: QTable = {};

console.log(`Training Q-learning: ${EPISODES} episodi, α=${ALPHA}, γ=${GAMMA}, ε=${EPS_START}→${EPS_END}`);
const t0 = Date.now();
let wins = { A: 0, B: 0, draw: 0 };

for (let ep = 0; ep < EPISODES; ep++) {
  const t = ep / Math.max(1, EPISODES - 1);
  const eps = EPS_START + (EPS_END - EPS_START) * t;
  const [pA, pB] = matchups[ep % matchups.length];
  const seed = 1000 + ep;

  // Per ogni faction, accumula transizioni; alla fine applica reward terminale
  type Trans = { stateKey: string; actionIdx: number; nActions: number };
  const transitions: Record<'A' | 'B', Trans[]> = { A: [], B: [] };

  const rng = mkRng(seed * 31 + 7);
  const factionFromUnitId = (uid: string): 'A' | 'B' => uid.startsWith('A-') ? 'A' : 'B';

  const qctx: QContext = {
    table,
    epsilon: eps,
    rng,
    onTransition: (info) => {
      // Skip transitions con stato/azioni vuoti (es. END_TURN fallback)
      if (!info.stateKey || info.nActions === 0) return;
      const f = factionFromUnitId(info.unitId);
      transitions[f].push({ stateKey: info.stateKey, actionIdx: info.actionIdx, nActions: info.nActions });
    },
  };

  const r = runBattle(pA, pB, seed, 50, false, 5, {
    modeA: 'qlearning', modeB: 'qlearning',
    qctxA: qctx, qctxB: qctx,
  });

  const winner = r.winner;
  if (winner === 'A') wins.A++; else if (winner === 'B') wins.B++; else wins.draw++;

  // Apply terminal rewards via TD propagated backward
  for (const fac of ['A', 'B'] as const) {
    const trs = transitions[fac];
    const reward = winner === fac ? 5 : winner === 'draw' || !winner ? 0 : -5;
    // Backward update: l'ultima transizione riceve reward terminale; le precedenti propagano via gamma
    for (let i = trs.length - 1; i >= 0; i--) {
      const isLast = i === trs.length - 1;
      const next = isLast ? null : trs[i + 1];
      qUpdate(
        table,
        trs[i].stateKey,
        trs[i].actionIdx,
        isLast ? reward : 0,
        next?.stateKey ?? null,
        next?.nActions ?? 0,
        ALPHA,
        GAMMA,
      );
    }
  }

  if ((ep + 1) % 500 === 0) {
    const dt = Date.now() - t0;
    console.log(`ep ${ep + 1}/${EPISODES} eps=${eps.toFixed(3)} states=${Object.keys(table).length} A/B/draw=${wins.A}/${wins.B}/${wins.draw} [${dt}ms]`);
  }
}

console.log(`\nTraining done in ${Date.now() - t0}ms. ${Object.keys(table).length} stati esplorati.`);

// Dump top entries
const entries = Object.entries(table).map(([k, v]) => ({ k, v, span: Math.max(...v) - Math.min(...v) }));
entries.sort((a, b) => b.span - a.span);
console.log(`\nTop 15 stati con maggior spread Q (decisioni 'forti'):`);
for (const e of entries.slice(0, 15)) {
  const fmt = e.v.map(x => x.toFixed(2)).join(', ');
  const bestA = e.v.indexOf(Math.max(...e.v));
  console.log(`  ${e.k}: [${fmt}]  best=${bestA} span=${e.span.toFixed(2)}`);
}

fs.writeFileSync('/tmp/qtable.json', JSON.stringify(table, null, 2));
console.log(`\nQ-table salvata in /tmp/qtable.json`);

// Eval: Q vs Utility, 50 partite/matchup, ε=0 (greedy)
console.log(`\n=== EVAL Q-AI vs Utility AI (50 sim/matchup, ε=0) ===`);
const evalCtx: QContext = { table, epsilon: 0, rng: Math.random };
let qWins = 0, total = 0;
for (const [pA, pB] of matchups) {
  let qw = 0;
  for (let s = 1; s <= 50; s++) {
    const r = runBattle(pA, pB, 9000 + s, 50, false, 5, {
      modeA: 'qlearning', modeB: 'utility',
      qctxA: evalCtx,
    });
    if (r.winner === 'A') qw++;
    total++;
  }
  qWins += qw;
  console.log(`  ${pA} vs ${pB}: Q vince ${qw}/50`);
}
console.log(`\nQ vs Utility totale: ${qWins}/${total} (${(qWins/total*100).toFixed(1)}%)`);

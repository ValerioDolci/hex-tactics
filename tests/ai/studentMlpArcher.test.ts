/**
 * Hard AI (studentMlpAi distillato) — battery di test per l'arciere.
 *
 * Due livelli:
 *   1. SCENARI FISSI: stato deterministico, controllo la decisione MLP (argmax) sulla
 *      base aspettativa "gioca da arciere": carico→spara, scarico→ricarica se può.
 *   2. SIMULAZIONI COMPLETE: arciere(hard) vs vari avversari, 30 partite per matchup.
 *      Misura distribuzione azioni (#tiri, #ricariche, #move, #passive) + win rate.
 *
 * Esegui con:
 *   npx vitest run tests/ai/studentMlpArcher.test.ts --reporter=verbose
 *
 * Le soglie negli expect sono "ragionevoli" — un arciere che spara 0 volte in 30 partite
 * è palesemente rotto. Soglie tarate sull'evidenza CFR ("arciere batte spadaccino +16.5 wr%").
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '@core/state';
import { reduce } from '@core/reducer';
import { aiDecideStudentMlp } from '@ai/studentMlpAi';
import { legalMoves } from '@ai/legalMoves';
import { unitFromPreset, getPreset } from '@data/presets';
import { runBattle, SimResult } from '../../scripts/simulate';

// =============================================================================
// Helpers
// =============================================================================

function setupArcherVs(
  opponentId: 'spadaccino' | 'tank' | 'arciere',
  archerPos = { q: 0, r: 0 },
  oppPos = { q: 10, r: 0 },
  forceArcherFirst = true,
) {
  const archer = unitFromPreset(getPreset('arciere')!, 'A', archerPos, 'Arciere');
  archer.id = 'A';
  const opp = unitFromPreset(getPreset(opponentId)!, 'B', oppPos, opponentId);
  opp.id = 'B';
  let s = createInitialState({ units: [archer, opp], board: { cols: 24, rows: 18 }, rngSeed: 42 });
  s = reduce(s, { type: 'START_ROUND' });
  if (forceArcherFirst) {
    s = { ...s, turnOrder: ['A', 'B'], currentTurnIdx: 0, phase: 'turn-start' };
  }
  // Avvia turno con 2 dadi slancio (max)
  s = reduce(s, { type: 'START_TURN', slancioDice: 2 });
  return s;
}

function fmt(ev: any): string {
  if (!ev) return '?';
  if (ev.type === 'DECLARE_ATTACK') return `ATK ${ev.isRanged ? 'ranged' : 'melee'} (${ev.weaponId})`;
  if (ev.type === 'MOVE') return `MOVE → (${ev.targetHex.q},${ev.targetHex.r})`;
  if (ev.type === 'RELOAD') return 'RELOAD';
  if (ev.type === 'END_TURN') return 'END';
  return ev.type;
}

interface MatchupSummary {
  matchup: string;
  n: number;
  winRateA: number;
  drawRate: number;
  timeoutRate: number;
  avgRounds: number;
  avgArcherRanged: number;
  avgArcherReload: number;
  avgArcherMove: number;
  avgArcherPassive: number;
}

function summarize(matchup: string, results: SimResult[]): MatchupSummary {
  const n = results.length;
  const wins = results.filter((r) => r.winner === 'A').length;
  const draws = results.filter((r) => r.winner === 'draw').length;
  const timeouts = results.filter((r) => r.winner === 'timeout').length;
  const sum = (f: (r: SimResult) => number) => results.reduce((a, r) => a + f(r), 0);
  return {
    matchup,
    n,
    winRateA: wins / n,
    drawRate: draws / n,
    timeoutRate: timeouts / n,
    avgRounds: sum((r) => r.rounds) / n,
    avgArcherRanged: sum((r) => r.combatStats.rangedAttempts.A) / n,
    avgArcherReload: sum((r) => r.combatStats.reloadsAttempted.A) / n,
    avgArcherMove: sum((r) => r.combatStats.moves.A) / n,
    avgArcherPassive: sum((r) => r.combatStats.endTurnsPassive.A) / n,
  };
}

function printSummary(s: MatchupSummary) {
  // eslint-disable-next-line no-console
  console.log(
    `\n=== ${s.matchup} (n=${s.n}) ===\n` +
      `  win rate A:    ${(s.winRateA * 100).toFixed(1)}%\n` +
      `  draw / timeout: ${(s.drawRate * 100).toFixed(1)}% / ${(s.timeoutRate * 100).toFixed(1)}%\n` +
      `  avg rounds:    ${s.avgRounds.toFixed(1)}\n` +
      `  arciere — avg ranged shots: ${s.avgArcherRanged.toFixed(2)}\n` +
      `  arciere — avg reloads:      ${s.avgArcherReload.toFixed(2)}\n` +
      `  arciere — avg moves:        ${s.avgArcherMove.toFixed(2)}\n` +
      `  arciere — avg passive ends: ${s.avgArcherPassive.toFixed(2)}`,
  );
}

// =============================================================================
// Phase 1 — scenari fissi
// =============================================================================

describe('Hard AI arciere — scenari fissi', () => {
  it('LONTANO (dist 10), arco CARICO → deve sparare', () => {
    let s = setupArcherVs('spadaccino', { q: 0, r: 0 }, { q: 10, r: 0 });
    s = { ...s, units: { ...s.units, A: { ...s.units['A'], weaponLoaded: true } } };
    const ev = aiDecideStudentMlp(s, 'A');
    // eslint-disable-next-line no-console
    console.log(`[far+loaded] MLP → ${fmt(ev)}`);
    expect(ev.type).toBe('DECLARE_ATTACK');
    expect((ev as any).isRanged).toBe(true);
  });

  it('LONTANO, SCARICO, slancio 12 (≥9 = costo arco lungo) → deve ricaricare', () => {
    let s = setupArcherVs('spadaccino', { q: 0, r: 0 }, { q: 10, r: 0 });
    s = { ...s, units: { ...s.units, A: { ...s.units['A'], weaponLoaded: false, slancio: 12 } } };
    const ev = aiDecideStudentMlp(s, 'A');
    // eslint-disable-next-line no-console
    console.log(`[far+unloaded+sla12] MLP → ${fmt(ev)}`);
    expect(ev.type).toBe('RELOAD');
  });

  it('LONTANO, SCARICO, slancio 3 (<9, NON può ricaricare) → MOVE o END (no RELOAD legale)', () => {
    let s = setupArcherVs('spadaccino', { q: 0, r: 0 }, { q: 10, r: 0 });
    s = { ...s, units: { ...s.units, A: { ...s.units['A'], weaponLoaded: false, slancio: 3 } } };
    const moves = legalMoves(s, 'A');
    const reloadLegal = moves.some((m) => m.type === 'RELOAD');
    expect(reloadLegal).toBe(false);
    const ev = aiDecideStudentMlp(s, 'A');
    // eslint-disable-next-line no-console
    console.log(`[far+unloaded+sla3] MLP → ${fmt(ev)} (reload not legal: OK)`);
    expect(['MOVE', 'END_TURN'].includes(ev.type)).toBe(true);
  });

  it('MEDIA distanza (dist 5), CARICO, fuori melee threat → spara', () => {
    let s = setupArcherVs('spadaccino', { q: 0, r: 0 }, { q: 5, r: 0 });
    s = { ...s, units: { ...s.units, A: { ...s.units['A'], weaponLoaded: true } } };
    const ev = aiDecideStudentMlp(s, 'A');
    // eslint-disable-next-line no-console
    console.log(`[mid5+loaded] MLP → ${fmt(ev)}`);
    expect(ev.type).toBe('DECLARE_ATTACK');
    expect((ev as any).isRanged).toBe(true);
  });

  it('VICINO dist 1, CARICO, nemico con slancio>0 → ranged BLOCCATO (in melee threat)', () => {
    let s = setupArcherVs('spadaccino', { q: 0, r: 0 }, { q: 1, r: 0 });
    s = { ...s, units: { ...s.units, A: { ...s.units['A'], weaponLoaded: true } } };
    const moves = legalMoves(s, 'A');
    const rangedLegal = moves.some((m) => m.type === 'DECLARE_ATTACK' && (m as any).isRanged);
    const offhandLegal = moves.some(
      (m) => m.type === 'DECLARE_ATTACK' && (m as any).weaponId === 'pugnale',
    );
    expect(rangedLegal).toBe(false);
    const ev = aiDecideStudentMlp(s, 'A');
    // eslint-disable-next-line no-console
    console.log(
      `[melee threat] MLP → ${fmt(ev)} | ranged legal: ${rangedLegal} | offhand legal (TS): ${offhandLegal}`,
    );
    // Documenta solo: l'arciere è bloccato senza offhand attack legal (D-051 manca in TS)
    expect(ev).toBeDefined();
  });

  it('VICINO dist 1, CARICO, nemico con slancio=0 → ranged DEVE essere disponibile e MLP spara', () => {
    let s = setupArcherVs('spadaccino', { q: 0, r: 0 }, { q: 1, r: 0 });
    s = {
      ...s,
      units: {
        ...s.units,
        A: { ...s.units['A'], weaponLoaded: true },
        B: { ...s.units['B'], slancio: 0 },
      },
    };
    const moves = legalMoves(s, 'A');
    const rangedLegal = moves.some((m) => m.type === 'DECLARE_ATTACK' && (m as any).isRanged);
    expect(rangedLegal).toBe(true);
    const ev = aiDecideStudentMlp(s, 'A');
    // eslint-disable-next-line no-console
    console.log(`[melee dist1 no threat] MLP → ${fmt(ev)}`);
    expect(ev.type).toBe('DECLARE_ATTACK');
    expect((ev as any).isRanged).toBe(true);
  });

  it('CARICO, dist 4, in line of sight → spara (vs spadaccino)', () => {
    let s = setupArcherVs('spadaccino', { q: 0, r: 0 }, { q: 4, r: 0 });
    s = { ...s, units: { ...s.units, A: { ...s.units['A'], weaponLoaded: true } } };
    const ev = aiDecideStudentMlp(s, 'A');
    // eslint-disable-next-line no-console
    console.log(`[dist4+loaded] MLP → ${fmt(ev)}`);
    expect(ev.type).toBe('DECLARE_ATTACK');
    expect((ev as any).isRanged).toBe(true);
  });
});

// =============================================================================
// Phase 2 — simulazioni complete
// =============================================================================

describe('Hard AI arciere — simulazioni complete (30 partite/matchup)', () => {
  const N = 30;
  const SEEDS = Array.from({ length: N }, (_, i) => 7000 + i);

  /** Esegue N partite arciere(hard) vs preset(heuristic) e riassume. */
  function runSweep(opponent: string, deployHexDist = 19): MatchupSummary {
    const results: SimResult[] = [];
    for (const seed of SEEDS) {
      const r = runBattle('arciere', opponent, seed, 40, false, deployHexDist, {
        modeA: 'hard',
        modeB: 'heuristic',
      });
      results.push(r);
    }
    const s = summarize(`arciere(hard) vs ${opponent}(heuristic) [deploy=${deployHexDist}]`, results);
    printSummary(s);
    return s;
  }

  it('vs spadaccino (deploy lontano = standard 19 hex)', () => {
    const s = runSweep('spadaccino', 19);
    // Sanity: l'arciere deve fare almeno QUALCHE tiro ranged
    expect(s.avgArcherRanged).toBeGreaterThan(0.5);
    // Win rate accettabile (CFR diceva +16.5% in matchup ideale, qui è 1 livello "hard" vs heuristic)
    // Cap basso: anche 30% sarebbe accettabile per un MLP distillato
    expect(s.winRateA).toBeGreaterThan(0.25);
  }, 60000);

  it('vs tank (deploy lontano)', () => {
    const s = runSweep('tank', 19);
    expect(s.avgArcherRanged).toBeGreaterThan(0.5);
    // Tank vs arciere è considerato bilanciato — soglia >15%
    expect(s.winRateA).toBeGreaterThan(0.15);
  }, 60000);

  it('vs arciere mirror (deploy lontano) — sanity', () => {
    const s = runSweep('arciere', 19);
    // ⚠️ BUG MARKER: in mirror (hard vs heuristic) la partita finisce quasi sempre in timeout (~90%).
    // Verosimilmente conseguenza del bug B (basicAi.ts propone RELOAD senza verificare
    // slancio ≥ reloadCostSlancio → reducer rifiuta → loop fino al safety cap).
    // Se questo test passa, il bug è stato risolto.
    expect(s.timeoutRate).toBeLessThan(0.5);
  }, 60000);

  it('vs spadaccino DEPLOY VICINO (5 hex, ~2 turni a contatto)', () => {
    // Stress test: forza la situazione melee threat per esercitare il bug-A territory
    const s = runSweep('spadaccino', 5);
    // Anche qui ci aspettiamo che l'arciere riesca a tirare almeno qualcosa (es. ritirata + reload + shoot)
    // Soglia abbassata perché ranged è spesso bloccato
    expect(s.avgArcherRanged + s.avgArcherReload).toBeGreaterThan(0.2);
  }, 60000);

  it('aggregato — rapporto azioni (sanity comportamentale)', () => {
    // Aggrega su tutti i 3 matchup standard (deploy 19) per capire il "profilo" dell'arciere hard
    const all: SimResult[] = [];
    for (const opp of ['spadaccino', 'tank', 'arciere']) {
      for (const seed of SEEDS) {
        all.push(
          runBattle('arciere', opp, seed, 40, false, 19, { modeA: 'hard', modeB: 'heuristic' }),
        );
      }
    }
    const s = summarize('aggregato 3×30 (deploy 19)', all);
    printSummary(s);
    // Rapporto sano: ranged_shots dovrebbe essere comparabile a moves (non infinitamente meno)
    const ratio = s.avgArcherRanged / (s.avgArcherMove + 0.0001);
    // eslint-disable-next-line no-console
    console.log(`  ratio ranged/move: ${ratio.toFixed(3)}`);
    // ⚠️ BUG MARKER: con i bug attuali il rapporto ranged/move è 0.005 (200 mosse per 1 tiro!).
    // Soglia ragionevole per un arciere distillato sano: ≥ 0.30.
    expect(ratio).toBeGreaterThan(0.3);
  }, 180000);

  // ===========================================================================
  // Test diagnostico: MOVE-loop quando hard AI gira a vuoto
  // ===========================================================================
  it('NO MOVE-LOOP: arciere non deve fare > 30 MOVE per partita (sintomo loop)', () => {
    // Un arciere razionale a deploy 19 con maxRounds=40 e slancio_max≈14 può fare
    // al massimo ~5-10 MOVE per partita (1 mossa di avvicinamento × ~5 turni). Se vediamo
    // 100+ MOVE per partita è chiaramente un loop (MOVE rifiutato + MLP ripropone MOVE).
    const opponents = ['spadaccino', 'tank', 'arciere'];
    const offenders: { opp: string; seed: number; moves: number }[] = [];
    for (const opp of opponents) {
      for (const seed of SEEDS.slice(0, 15)) {
        const r = runBattle('arciere', opp, seed, 40, false, 19, {
          modeA: 'hard',
          modeB: 'heuristic',
        });
        if (r.combatStats.moves.A > 30) {
          offenders.push({ opp, seed, moves: r.combatStats.moves.A });
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n  MOVE-loop offenders (>30 MOVE in 1 partita): ${offenders.length}/45`);
    for (const o of offenders.slice(0, 5)) {
      // eslint-disable-next-line no-console
      console.log(`    vs ${o.opp} seed=${o.seed}: ${o.moves} MOVE`);
    }
    // ⚠️ BUG MARKER: ci aspettiamo 0 offender; oggi sono ~15-30 su 45.
    expect(offenders.length).toBe(0);
  }, 180000);
});

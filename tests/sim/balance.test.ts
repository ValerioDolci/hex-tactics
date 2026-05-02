/**
 * Simulation harness — esegue battaglie AI vs AI per analizzare bilanciamento.
 *
 * Esegui con:
 *   RUN_SIM=1 npx vitest run tests/sim/balance.test.ts --reporter=verbose
 *
 * NON è incluso nel default `npm test` (skipped via env var).
 *
 * Output:
 * - Console: matrice riassuntiva
 * - File: /tmp/sim-traces/<presetA>-vs-<presetB>-seed<N>.md (trace dettagliato per battaglia singola)
 */

import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import {
  runFullMatrix,
  formatReport,
  runMatchup,
  runBattle,
  formatTrace,
  analyzeMatchup,
  generateOptimizationReport,
  MatchupAnalysis,
  AiMode,
  AiConfig,
  SimResult,
} from '../../scripts/simulate';
import { PRESETS } from '../../src/data/presets';

const RUN = process.env.RUN_SIM === '1';
const TRACE_DIR = '/tmp/sim-traces';

if (RUN) {
  try {
    mkdirSync(TRACE_DIR, { recursive: true });
  } catch (e) {
    void e;
  }
}

describe.skipIf(!RUN)('simulation balance', () => {
  it('matrix 3×3 preset (30 battaglie per coppia)', () => {
    const N = 30;
    const start = Date.now();
    const matrix = runFullMatrix(N);
    const elapsed = Date.now() - start;

    const report = formatReport(matrix);
    // eslint-disable-next-line no-console
    console.log(
      '\n' + report + `\n\nElapsed: ${elapsed}ms · ${matrix.length} matchup × ${N} sim = ${matrix.length * N} battaglie\n`,
    );

    expect(matrix.length).toBeGreaterThan(0);
  }, 120000);

  it('focus matchup verbose: salva trace dettagliati su file', () => {
    // Genera UN trace verbose per ogni coppia distinct (9 file totali)
    const presets = ['spadaccino', 'arciere', 'tank'];
    const seeds = [1001];
    const files: string[] = [];
    for (const a of presets) {
      for (const b of presets) {
        for (const seed of seeds) {
          const result = runBattle(a, b, seed, 50, /*verbose=*/ true);
          const md = formatTrace(result);
          const filename = `${TRACE_DIR}/${a}-vs-${b}-seed${seed}.md`;
          writeFileSync(filename, md, 'utf8');
          files.push(filename);
        }
      }
    }
    // eslint-disable-next-line no-console
    console.log(`\n=== Trace files salvati ===`);
    for (const f of files) {
      // eslint-disable-next-line no-console
      console.log(`  ${f}`);
    }
    expect(files.length).toBe(9);
  }, 120000);

  it('focus: spadaccino vs spadaccino — investiga timeout (verbose)', () => {
    // 5 sim con seed diversi per capire perché va in timeout
    const seeds = [1001, 2002, 3003, 4004, 5005];
    const traces: string[] = [];
    for (const seed of seeds) {
      const result = runBattle('spadaccino', 'spadaccino', seed, 30, true);
      traces.push(`# Seed ${seed} — winner=${result.winner} rounds=${result.rounds} events=${result.events}\n\n` + formatTrace(result));
    }
    const merged = traces.join('\n\n---\n\n');
    const filename = `${TRACE_DIR}/_INVESTIGAZIONE_spada-vs-spada.md`;
    writeFileSync(filename, merged, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`\n=== Investigazione spada-vs-spada salvata in: ${filename}`);
    expect(traces.length).toBe(5);
  }, 60000);

  it('matrix 3×3 con deploy VICINO (5 hex, ~2 turni in mischia)', () => {
    const N = 30;
    const start = Date.now();
    const matrix = runFullMatrix(N, /*deployHexDist=*/ 5);
    const elapsed = Date.now() - start;
    const report = formatReport(matrix);
    // eslint-disable-next-line no-console
    console.log(
      '\n=== DEPLOY VICINO (5 hex) ===\n' + report + `\n\nElapsed: ${elapsed}ms\n`,
    );
    expect(matrix.length).toBeGreaterThan(0);
  }, 120000);

  it('confronto vicini vs lontani per i matchup mischia (Spada/Tank)', () => {
    const N = 50;
    const matchups = [
      ['spadaccino', 'spadaccino'],
      ['spadaccino', 'tank'],
      ['tank', 'spadaccino'],
      ['tank', 'tank'],
    ];
    for (const [a, b] of matchups) {
      const far = runMatchup(a, b, N, 1000, /*deploy=*/ 19);
      const near = runMatchup(a, b, N, 1000, /*deploy=*/ 5);
      // eslint-disable-next-line no-console
      console.log(
        `\n${a} vs ${b}:\n  LONTANO (19): A ${far.winsA}/${far.total}, B ${far.winsB}, draw ${far.draws}, TO ${far.timeouts}, avgRounds ${far.avgRounds.toFixed(1)}\n  VICINO  (5):  A ${near.winsA}/${near.total}, B ${near.winsB}, draw ${near.draws}, TO ${near.timeouts}, avgRounds ${near.avgRounds.toFixed(1)}`,
      );
    }
    expect(matchups.length).toBe(4);
  }, 120000);

  it('verbose trace: spadaccino vs spadaccino VICINO (seed1001)', () => {
    const result = runBattle('spadaccino', 'spadaccino', 1001, 50, /*verbose=*/ true, /*deploy=*/ 5);
    const md = formatTrace(result);
    const filename = `${TRACE_DIR}/_VICINI_spada-vs-spada-seed1001.md`;
    writeFileSync(filename, md, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`\nTrace VICINI salvato: ${filename}`);
    expect(result.events).toBeGreaterThan(0);
  }, 30000);

  it('REPORT OTTIMIZZAZIONE: matrice 3×3 con 100 sim/coppia + analisi avanzata + insight (UTILITY AI baseline)', () => {
    const N = 100;
    const ids = PRESETS.map((p) => p.id);
    const analyses: MatchupAnalysis[] = [];
    const start = Date.now();
    const cfg: AiConfig = { modeA: 'utility', modeB: 'utility' };
    for (const a of ids) {
      for (const b of ids) {
        const results = [];
        for (let i = 0; i < N; i++) {
          results.push(runBattle(a, b, 1000 + i, 50, false, 19, cfg));
        }
        analyses.push(analyzeMatchup(results));
      }
    }
    const elapsed = Date.now() - start;
    const report = generateOptimizationReport(analyses);
    const filename = `${TRACE_DIR}/_REPORT_OTTIMIZZAZIONE.md`;
    writeFileSync(
      filename,
      `# Report ottimizzazione (AI: Utility vs Utility — baseline)\n\n` + report + `\n\n---\nElapsed: ${elapsed}ms · ${analyses.length * N} battaglie totali\n`,
      'utf8',
    );
    // eslint-disable-next-line no-console
    console.log('\n' + report + `\n\nReport completo: ${filename}\n`);
    expect(analyses.length).toBeGreaterThan(0);
  }, 600000);

  it('REPORT OTTIMIZZAZIONE deploy VICINO (5 hex) con analisi avanzata', () => {
    const N = 100;
    const ids = PRESETS.map((p) => p.id);
    const analyses: MatchupAnalysis[] = [];
    for (const a of ids) {
      for (const b of ids) {
        const results = [];
        for (let i = 0; i < N; i++) {
          results.push(runBattle(a, b, 2000 + i, 50, false, 5));
        }
        analyses.push(analyzeMatchup(results));
      }
    }
    const report = generateOptimizationReport(analyses);
    const filename = `${TRACE_DIR}/_REPORT_OTTIMIZZAZIONE_VICINI.md`;
    writeFileSync(filename, report, 'utf8');
    // eslint-disable-next-line no-console
    console.log('\n=== DEPLOY VICINO (5 hex) ===\n' + report + `\n\nFile: ${filename}\n`);
    expect(analyses.length).toBeGreaterThan(0);
  }, 600000);

  it('SMOKE TEST: ogni AI mode esegue una battaglia senza crash', () => {
    const modes: AiMode[] = ['heuristic', 'utility', 'mcts'];
    for (const mode of modes) {
      const cfg: AiConfig = { modeA: mode, modeB: mode, mctsConfig: { iterations: 50, rolloutMaxEvents: 100 } };
      const result = runBattle('spadaccino', 'spadaccino', 1234, 30, false, 5, cfg);
      // eslint-disable-next-line no-console
      console.log(`Mode ${mode}: winner=${result.winner}, rounds=${result.rounds}, events=${result.events}`);
      expect(result.events).toBeGreaterThan(0);
    }
  }, 60000);

  it('AI TOURNAMENT: heuristic vs utility vs mcts su preset spadaccino, 30 sim per cella', () => {
    const modes: AiMode[] = ['heuristic', 'utility', 'mcts'];
    const N = 30;
    const lines: string[] = [];
    lines.push('# AI Tournament Report');
    lines.push('');
    lines.push('| A mode | B mode | Win A | Win B | TO | Round | DPR A | DPR B |');
    lines.push('|---|---|---|---|---|---|---|---|');
    const start = Date.now();
    for (const a of modes) {
      for (const b of modes) {
        const results: SimResult[] = [];
        const cfg: AiConfig = {
          modeA: a,
          modeB: b,
          mctsConfig: { iterations: 200, rolloutMaxEvents: 100 },
        };
        for (let i = 0; i < N; i++) {
          results.push(runBattle('spadaccino', 'spadaccino', 1000 + i, 30, false, 5, cfg));
        }
        const m = analyzeMatchup(results);
        lines.push(
          `| ${a} | ${b} | ${(m.winRateA * 100).toFixed(0)}% | ${(m.winRateB * 100).toFixed(0)}% | ${(m.timeoutRate * 100).toFixed(0)}% | ${m.avgRounds.toFixed(1)} | ${m.avgDamagePerRoundA.toFixed(1)} | ${m.avgDamagePerRoundB.toFixed(1)} |`,
        );
      }
    }
    const elapsed = Date.now() - start;
    lines.push('');
    lines.push(`Elapsed: ${elapsed}ms · ${modes.length * modes.length * N} battaglie totali`);
    const filename = `${TRACE_DIR}/_AI_TOURNAMENT_spadaccino.md`;
    writeFileSync(filename, lines.join('\n'), 'utf8');
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + `\n\nReport: ${filename}\n`);
    expect(modes.length).toBe(3);
  }, 600000);

  it('FULL TOURNAMENT: 3 AI × 3 preset, mirror match, 30 sim per cella', () => {
    const modes: AiMode[] = ['heuristic', 'utility', 'mcts'];
    const presets = ['spadaccino', 'arciere', 'tank'];
    const N = 30;
    const lines: string[] = [];
    lines.push('# Full AI Tournament — 3 AI × 3 preset (mirror)');
    lines.push('');
    lines.push('| Preset | A mode | B mode | Win A | Win B | TO | Round | DPR A | DPR B | Hit A | Hit B |');
    lines.push('|---|---|---|---|---|---|---|---|---|---|---|');
    const start = Date.now();
    for (const preset of presets) {
      for (const a of modes) {
        for (const b of modes) {
          const results: SimResult[] = [];
          const cfg: AiConfig = {
            modeA: a,
            modeB: b,
            mctsConfig: { iterations: 200, rolloutMaxEvents: 100 },
          };
          for (let i = 0; i < N; i++) {
            results.push(runBattle(preset, preset, 5000 + i, 30, false, 5, cfg));
          }
          const m = analyzeMatchup(results);
          lines.push(
            `| ${preset} | ${a} | ${b} | ${(m.winRateA * 100).toFixed(0)}% | ${(m.winRateB * 100).toFixed(0)}% | ${(m.timeoutRate * 100).toFixed(0)}% | ${m.avgRounds.toFixed(1)} | ${m.avgDamagePerRoundA.toFixed(1)} | ${m.avgDamagePerRoundB.toFixed(1)} | ${(m.hitRateA * 100).toFixed(0)}% | ${(m.hitRateB * 100).toFixed(0)}% |`,
          );
        }
      }
    }
    const elapsed = Date.now() - start;
    lines.push('');
    lines.push(`Elapsed: ${elapsed}ms · ${presets.length * modes.length * modes.length * N} battaglie totali`);
    const filename = `${TRACE_DIR}/_AI_FULL_TOURNAMENT.md`;
    writeFileSync(filename, lines.join('\n'), 'utf8');
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + `\n\nReport: ${filename}\n`);
    expect(modes.length).toBe(3);
  }, 1800000);

  it('NARRATIVE REPORT: descrizione e scelte frequenti per ogni matchup (100 sim, Utility AI)', () => {
    const presets = ['spadaccino', 'arciere', 'tank'];
    const N = 100;
    const lines: string[] = [];
    lines.push('# Descrizione narrativa partite — Utility AI');
    lines.push('');
    lines.push('100 sim per matchup. Mappa 5 hex (close deploy). Mostra: pattern, ritmo, scelte AI ricorrenti.');
    lines.push('');
    const cfg: AiConfig = { modeA: 'utility', modeB: 'utility' };

    for (const a of presets) {
      for (const b of presets) {
        const results: SimResult[] = [];
        for (let i = 0; i < N; i++) {
          results.push(runBattle(a, b, 6000 + i, 30, false, 5, cfg));
        }
        const m = analyzeMatchup(results);
        // Aggrega scelte per matchup
        let totalSlancioA0 = 0, totalSlancioA1 = 0, totalSlancioA2 = 0;
        let totalSlancioB0 = 0, totalSlancioB1 = 0, totalSlancioB2 = 0;
        let parryA = 0, dodgeA = 0, noneA = 0;
        let parryB = 0, dodgeB = 0, noneB = 0;
        let attDice1A = 0, attDice2A = 0;
        let attDice1B = 0, attDice2B = 0;
        for (const r of results) {
          totalSlancioA0 += r.combatStats.slancioDiceChoices.A.d0;
          totalSlancioA1 += r.combatStats.slancioDiceChoices.A.d1;
          totalSlancioA2 += r.combatStats.slancioDiceChoices.A.d2;
          totalSlancioB0 += r.combatStats.slancioDiceChoices.B.d0;
          totalSlancioB1 += r.combatStats.slancioDiceChoices.B.d1;
          totalSlancioB2 += r.combatStats.slancioDiceChoices.B.d2;
          parryA += r.combatStats.defenseChoices.A.parry;
          dodgeA += r.combatStats.defenseChoices.A.dodge;
          noneA += r.combatStats.defenseChoices.A.none;
          parryB += r.combatStats.defenseChoices.B.parry;
          dodgeB += r.combatStats.defenseChoices.B.dodge;
          noneB += r.combatStats.defenseChoices.B.none;
          attDice1A += r.combatStats.attackerDiceChoices.A.d1;
          attDice2A += r.combatStats.attackerDiceChoices.A.d2;
          attDice1B += r.combatStats.attackerDiceChoices.B.d1;
          attDice2B += r.combatStats.attackerDiceChoices.B.d2;
        }
        const totSlA = totalSlancioA0 + totalSlancioA1 + totalSlancioA2 || 1;
        const totSlB = totalSlancioB0 + totalSlancioB1 + totalSlancioB2 || 1;
        const totDefA = parryA + dodgeA + noneA || 1;
        const totDefB = parryB + dodgeB + noneB || 1;
        const totAtA = attDice1A + attDice2A || 1;
        const totAtB = attDice1B + attDice2B || 1;
        lines.push(`## ${a} (A) vs ${b} (B)`);
        lines.push('');
        lines.push(`**Esito**: A vince **${(m.winRateA * 100).toFixed(0)}%**, B vince **${(m.winRateB * 100).toFixed(0)}%**, draw ${(m.drawRate * 100).toFixed(0)}%, timeout ${(m.timeoutRate * 100).toFixed(0)}%`);
        lines.push(`**Ritmo**: ${m.avgRounds.toFixed(1)} round in media, ${m.avgEvents.toFixed(0)} eventi/partita`);
        lines.push(`**Combattimento**: A fa ${m.avgMeleeAttacksA.toFixed(1)} attacchi mischia + ${m.avgRangedAttacksA.toFixed(1)} ranged, hit rate ${(m.hitRateA * 100).toFixed(0)}%; B fa ${m.avgMeleeAttacksB.toFixed(1)} mischia + ${m.avgRangedAttacksB.toFixed(1)} ranged, hit ${(m.hitRateB * 100).toFixed(0)}%`);
        lines.push(`**Mobilità**: A muove ${m.avgMovesA.toFixed(1)}× partita, B muove ${m.avgMovesB.toFixed(1)}×`);
        lines.push('');
        lines.push('### Scelte ricorrenti A');
        lines.push(`- Slancio: ${(totalSlancioA0 / totSlA * 100).toFixed(0)}% scelta 0d, ${(totalSlancioA1 / totSlA * 100).toFixed(0)}% 1d, ${(totalSlancioA2 / totSlA * 100).toFixed(0)}% 2d`);
        lines.push(`- Difesa: ${(parryA / totDefA * 100).toFixed(0)}% parry, ${(dodgeA / totDefA * 100).toFixed(0)}% dodge, ${(noneA / totDefA * 100).toFixed(0)}% nessuna (parry success ${(m.parrySuccessA * 100).toFixed(0)}%, dodge success ${(m.dodgeSuccessA * 100).toFixed(0)}%)`);
        lines.push(`- Dadi attacco: ${(attDice1A / totAtA * 100).toFixed(0)}% 1d, ${(attDice2A / totAtA * 100).toFixed(0)}% 2d`);
        lines.push('');
        lines.push('### Scelte ricorrenti B');
        lines.push(`- Slancio: ${(totalSlancioB0 / totSlB * 100).toFixed(0)}% scelta 0d, ${(totalSlancioB1 / totSlB * 100).toFixed(0)}% 1d, ${(totalSlancioB2 / totSlB * 100).toFixed(0)}% 2d`);
        lines.push(`- Difesa: ${(parryB / totDefB * 100).toFixed(0)}% parry, ${(dodgeB / totDefB * 100).toFixed(0)}% dodge, ${(noneB / totDefB * 100).toFixed(0)}% nessuna (parry success ${(m.parrySuccessB * 100).toFixed(0)}%, dodge success ${(m.dodgeSuccessB * 100).toFixed(0)}%)`);
        lines.push(`- Dadi attacco: ${(attDice1B / totAtB * 100).toFixed(0)}% 1d, ${(attDice2B / totAtB * 100).toFixed(0)}% 2d`);
        lines.push('');
      }
    }
    const filename = `${TRACE_DIR}/_NARRATIVE_REPORT.md`;
    writeFileSync(filename, lines.join('\n'), 'utf8');
    // eslint-disable-next-line no-console
    console.log('\n' + lines.join('\n') + `\n\nReport: ${filename}`);
    expect(presets.length).toBe(3);
  }, 600000);

  it('quick matrix summary 100 sim per matchup chiave', () => {
    const matchups = [
      ['spadaccino', 'arciere'],
      ['arciere', 'spadaccino'],
      ['tank', 'arciere'],
      ['spadaccino', 'spadaccino'],
      ['tank', 'tank'],
    ];
    for (const [a, b] of matchups) {
      const summary = runMatchup(a, b, 100);
      // eslint-disable-next-line no-console
      console.log(
        `${a} vs ${b}: A wins ${summary.winsA} (${((summary.winsA / 100) * 100).toFixed(0)}%), B ${summary.winsB} (${((summary.winsB / 100) * 100).toFixed(0)}%), draw ${summary.draws}, TO ${summary.timeouts}, avgRounds ${summary.avgRounds.toFixed(1)}, avgEvents ${summary.avgEvents.toFixed(0)}`,
      );
    }
    expect(matchups.length).toBe(5);
  }, 120000);
});

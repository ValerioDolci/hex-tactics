/**
 * Skirmish balance sweep — gira N partite per ogni matchup variato e misura
 * win rate, durata, mortality, decisività (game-over vs timeout).
 *
 * Obiettivo: capire se i preset attuali in skirmish 2v2/3v3/4v4 producono
 * partite "sensate" (combat, esiti, no stallo) o se servono tweak.
 *
 * Run:
 *   PATH=/opt/homebrew/bin:$PATH node node_modules/.bin/vitest run \
 *     tests/sim/skirmish_balance.test.ts --reporter=verbose
 *
 * Output anche su /tmp/skirmish-balance.md
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';

interface BattleResult {
  matchupId: string;
  seed: number;
  winner: 'A' | 'B' | 'draw' | 'timeout';
  rounds: number;
  events: number;
  aliveA: number;
  aliveB: number;
  hpA: number;
  hpB: number;
  damageEvents: number;
  hitEvents: number;
  totalDamage: number;
}

async function runSkirmishMatch(
  teamA: string[],
  teamB: string[],
  seed: number,
  maxRounds = 60,
): Promise<BattleResult> {
  const { createInitialState } = await import('@core/state');
  const { reduce } = await import('@core/reducer');
  const { unitFromPreset, getPreset } = await import('@data/presets');
  const { aiDecideAction, aiDecideTurnStart, aiDecideAttackerDice, aiDecideDefense } = await import('@ai/basicAi');
  const { offsetToAxial } = await import('@core/hex/coords');

  // Deploy: linea verticale per faction (col 2 / col 21)
  const cols = 24, rows = 18;
  const midRow = Math.floor(rows / 2);
  const deployLine = (count: number): number[] => {
    const spacing = 4;
    const totalSpan = (count - 1) * spacing;
    const startRow = Math.max(2, Math.floor(midRow - totalSpan / 2));
    const out: number[] = [];
    for (let i = 0; i < count; i++) out.push(Math.min(rows - 3, startRow + i * spacing));
    return out;
  };
  const rowsA = deployLine(teamA.length);
  const rowsB = deployLine(teamB.length);
  const units: any[] = [];
  for (let i = 0; i < teamA.length; i++) {
    const p = getPreset(teamA[i])!;
    units.push(Object.assign(unitFromPreset(p, 'A', offsetToAxial({ col: 2, row: rowsA[i] })), { id: `A${i + 1}`, name: `${p.name}_A${i + 1}` }));
  }
  for (let i = 0; i < teamB.length; i++) {
    const p = getPreset(teamB[i])!;
    units.push(Object.assign(unitFromPreset(p, 'B', offsetToAxial({ col: 21, row: rowsB[i] })), { id: `B${i + 1}`, name: `${p.name}_B${i + 1}` }));
  }

  let s = createInitialState({ units, board: { cols, rows }, rngSeed: seed });
  s = reduce(s, { type: 'START_ROUND' });
  let events = 0;
  let damageEvents = 0;
  let hitEvents = 0;
  let totalDamage = 0;
  let safety = maxRounds * 50;
  while (s.phase !== 'game-over' && safety-- > 0) {
    if (s.round > maxRounds) break;
    const activeId = s.turnOrder[s.currentTurnIdx];
    if (!activeId) break;
    let ev: any;
    if (s.phase === 'turn-start') { const _d = aiDecideTurnStart(s, activeId); ev = { type: 'START_TURN', slancioDice: _d.slancioDice, impetoToSlancio: _d.impetoToSlancio }; }
    else if (s.phase === 'choosing-action') ev = aiDecideAction(s, activeId);
    else if (s.phase === 'declaring-attack') ev = { type: 'CHOOSE_ATTACKER_DICE', diceN: aiDecideAttackerDice(s, activeId) };
    else if (s.phase === 'awaiting-defense') {
      const defId = s.pendingAction!.targetId;
      const def = aiDecideDefense(s, defId);
      ev = { type: 'CHOOSE_DEFENSE', defenseType: def.defenseType, parryWith: def.parryWith, diceN: def.diceN };
    } else if (s.phase === 'resolving') ev = { type: 'RESOLVE_COMBAT' };
    else if (s.phase === 'awaiting-attacker-bid' || s.phase === 'awaiting-defender-bid') ev = { type: 'BID_MOVEMENT', amount: 0 };
    else if (s.phase === 'awaiting-carica') ev = { type: 'CHOOSE_CARICA', amount: 0 };
    else break;
    const prevPos = ev.type === 'MOVE' ? s.units[ev.unitId]?.position : undefined;
    s = reduce(s, ev);
    events++;
    if (ev.type === 'MOVE' && prevPos) {
      const after = s.units[ev.unitId];
      if (after && after.position.q === prevPos.q && after.position.r === prevPos.r && s.phase === 'choosing-action') {
        s = reduce(s, { type: 'END_TURN' });
        events++;
      }
    }
    if (ev.type === 'RESOLVE_COMBAT') {
      const lr = s.lastResolution;
      if (lr) {
        damageEvents++;
        if (lr.hit) hitEvents++;
        totalDamage += lr.effectiveDamage;
      }
    }
  }
  const aliveA = Object.values(s.units).filter((u) => u.faction === 'A' && u.alive).length;
  const aliveB = Object.values(s.units).filter((u) => u.faction === 'B' && u.alive).length;
  const hpA = Object.values(s.units).filter((u) => u.faction === 'A').reduce((sum, u) => sum + u.hp, 0);
  const hpB = Object.values(s.units).filter((u) => u.faction === 'B').reduce((sum, u) => sum + u.hp, 0);
  return {
    matchupId: `${teamA.join('+')} vs ${teamB.join('+')}`,
    seed,
    winner: (s.winner ?? 'timeout') as any,
    rounds: s.round,
    events,
    aliveA,
    aliveB,
    hpA,
    hpB,
    damageEvents,
    hitEvents,
    totalDamage,
  };
}

interface MatchupSummary {
  label: string;
  teamA: string[];
  teamB: string[];
  n: number;
  winRateA: number;
  winRateB: number;
  drawRate: number;
  timeoutRate: number;
  avgRounds: number;
  avgDamageEvents: number;
  avgTotalDamage: number;
  avgHitRate: number;
  avgAliveA: number;
  avgAliveB: number;
  decisiveRate: number; // partite finite (no timeout)
}

function summarize(label: string, teamA: string[], teamB: string[], rs: BattleResult[]): MatchupSummary {
  const n = rs.length;
  const wA = rs.filter((r) => r.winner === 'A').length;
  const wB = rs.filter((r) => r.winner === 'B').length;
  const draw = rs.filter((r) => r.winner === 'draw').length;
  const to = rs.filter((r) => r.winner === 'timeout').length;
  const sum = (f: (r: BattleResult) => number) => rs.reduce((a, r) => a + f(r), 0);
  const avgHitRate = (() => {
    const totalAtt = sum((r) => r.damageEvents);
    return totalAtt > 0 ? sum((r) => r.hitEvents) / totalAtt : 0;
  })();
  return {
    label,
    teamA,
    teamB,
    n,
    winRateA: wA / n,
    winRateB: wB / n,
    drawRate: draw / n,
    timeoutRate: to / n,
    avgRounds: sum((r) => r.rounds) / n,
    avgDamageEvents: sum((r) => r.damageEvents) / n,
    avgTotalDamage: sum((r) => r.totalDamage) / n,
    avgHitRate,
    avgAliveA: sum((r) => r.aliveA) / n,
    avgAliveB: sum((r) => r.aliveB) / n,
    decisiveRate: 1 - to / n,
  };
}

function fmt(s: MatchupSummary): string {
  const wA = (s.winRateA * 100).toFixed(0).padStart(3);
  const wB = (s.winRateB * 100).toFixed(0).padStart(3);
  const to = (s.timeoutRate * 100).toFixed(0).padStart(3);
  const r = s.avgRounds.toFixed(1).padStart(5);
  const d = s.avgTotalDamage.toFixed(0).padStart(4);
  const at = s.avgDamageEvents.toFixed(1).padStart(5);
  const hr = (s.avgHitRate * 100).toFixed(0).padStart(3);
  const aA = s.avgAliveA.toFixed(1);
  const aB = s.avgAliveB.toFixed(1);
  return `${s.label.padEnd(45)} A:${wA}% B:${wB}% TO:${to}% | rounds:${r} | atk:${at} hit:${hr}% | dmg:${d} | alive A:${aA}/${s.teamA.length} B:${aB}/${s.teamB.length}`;
}

describe('Skirmish balance sweep', () => {
  it('Battery di 12 matchup × 20 partite — analisi WR + decisività', async () => {
    const SEEDS_PER_MATCH = 20;
    const matchups: { label: string; teamA: string[]; teamB: string[] }[] = [
      // 2v2
      { label: '2v2 mirror arc+spa', teamA: ['arciere', 'spadaccino'], teamB: ['arciere', 'spadaccino'] },
      { label: '2v2 mirror tank+tank', teamA: ['tank', 'tank'], teamB: ['tank', 'tank'] },
      { label: '2v2 mirror spa+spa', teamA: ['spadaccino', 'spadaccino'], teamB: ['spadaccino', 'spadaccino'] },
      { label: '2v2 spa+arc vs tank+arc', teamA: ['spadaccino', 'arciere'], teamB: ['tank', 'arciere'] },
      { label: '2v2 spa+spa vs arc+arc', teamA: ['spadaccino', 'spadaccino'], teamB: ['arciere', 'arciere'] },
      { label: '2v2 tank+tank vs arc+arc', teamA: ['tank', 'tank'], teamB: ['arciere', 'arciere'] },
      // 3v3
      { label: '3v3 mirror balanced', teamA: ['arciere', 'spadaccino', 'tank'], teamB: ['arciere', 'spadaccino', 'tank'] },
      { label: '3v3 spam arc vs balanced', teamA: ['arciere', 'arciere', 'arciere'], teamB: ['arciere', 'spadaccino', 'tank'] },
      { label: '3v3 spam spada vs balanced', teamA: ['spadaccino', 'spadaccino', 'spadaccino'], teamB: ['arciere', 'spadaccino', 'tank'] },
      { label: '3v3 spam tank vs balanced', teamA: ['tank', 'tank', 'tank'], teamB: ['arciere', 'spadaccino', 'tank'] },
      // 4v4
      { label: '4v4 mirror balanced', teamA: ['arciere', 'spadaccino', 'tank', 'spadaccino'], teamB: ['arciere', 'spadaccino', 'tank', 'spadaccino'] },
      { label: '4v4 archers vs all-melee', teamA: ['arciere', 'arciere', 'arciere', 'arciere'], teamB: ['spadaccino', 'spadaccino', 'tank', 'tank'] },
    ];

    const results: MatchupSummary[] = [];
    for (const m of matchups) {
      const battles: BattleResult[] = [];
      for (let i = 0; i < SEEDS_PER_MATCH; i++) {
        battles.push(await runSkirmishMatch(m.teamA, m.teamB, 20000 + i * 17, 80));
      }
      results.push(summarize(m.label, m.teamA, m.teamB, battles));
    }

    // Stampa risultati
    const lines: string[] = [];
    lines.push(`# Skirmish balance sweep (${SEEDS_PER_MATCH} partite × ${matchups.length} matchup, AI heuristic vs heuristic)\n`);
    lines.push(`Generato il ${new Date().toISOString()}\n`);
    lines.push('Legenda: WR% A/B/TO | round avg | atk avg = # tentativi attacco/partita | hit% = colpi a segno');
    lines.push('         dmg = damage totale avg/partita | alive = unit superstiti avg per faction\n');
    lines.push('```');
    for (const s of results) {
      lines.push(fmt(s));
    }
    lines.push('```\n');
    // Insight automatici
    lines.push('## Indicatori automatici di squilibrio\n');
    for (const s of results) {
      const issues: string[] = [];
      if (s.winRateA > 0.75) issues.push(`A dominante (WR ${(s.winRateA * 100).toFixed(0)}%)`);
      if (s.winRateB > 0.75) issues.push(`B dominante (WR ${(s.winRateB * 100).toFixed(0)}%)`);
      if (s.timeoutRate > 0.30) issues.push(`alto stallo (timeout ${(s.timeoutRate * 100).toFixed(0)}%)`);
      if (s.avgDamageEvents < 3) issues.push(`pochi attacchi/partita (${s.avgDamageEvents.toFixed(1)})`);
      if (s.avgHitRate < 0.20) issues.push(`hit rate basso (${(s.avgHitRate * 100).toFixed(0)}%)`);
      if (s.avgRounds > 50) issues.push(`partite molto lunghe (${s.avgRounds.toFixed(0)} round avg)`);
      if (issues.length > 0) {
        lines.push(`- **${s.label}**: ${issues.join('; ')}`);
      }
    }

    const md = lines.join('\n');
    writeFileSync('/tmp/skirmish-balance.md', md, 'utf8');
    // eslint-disable-next-line no-console
    console.log(`\n${md}\n`);
    expect(results.length).toBe(matchups.length);
  }, 240000);
});

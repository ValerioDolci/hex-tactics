/**
 * 3 arcieri vs 3 tank: WR + dump comportamento tank
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';

async function runMatch(
  teamA: string[],
  teamB: string[],
  seed: number,
  verbose: boolean,
): Promise<{ winner: string; rounds: number; aliveA: number; aliveB: number; log: string[] }> {
  const { createInitialState } = await import('@core/state');
  const { reduce } = await import('@core/reducer');
  const { unitFromPreset, getPreset } = await import('@data/presets');
  const { aiDecideAction, aiDecideTurnStart, aiDecideAttackerDice, aiDecideDefense } = await import('@ai/basicAi');
  const { offsetToAxial } = await import('@core/hex/coords');

  const cols = 24, rows = 18;
  const midRow = 9;
  const sp = 4;
  const start = Math.max(2, midRow - sp);
  const ra = Array.from({ length: teamA.length }, (_, i) => Math.min(rows - 3, start + i * sp));
  const rb = Array.from({ length: teamB.length }, (_, i) => Math.min(rows - 3, start + i * sp));
  const units: any[] = [];
  for (let i = 0; i < teamA.length; i++) {
    const p = getPreset(teamA[i])!;
    units.push(Object.assign(unitFromPreset(p, 'A', offsetToAxial({ col: 2, row: ra[i] })), { id: `A${i + 1}`, name: `A${i + 1}_${p.name}` }));
  }
  for (let i = 0; i < teamB.length; i++) {
    const p = getPreset(teamB[i])!;
    units.push(Object.assign(unitFromPreset(p, 'B', offsetToAxial({ col: 21, row: rb[i] })), { id: `B${i + 1}`, name: `B${i + 1}_${p.name}` }));
  }
  let s = createInitialState({ units, board: { cols, rows }, rngSeed: seed });
  s = reduce(s, { type: 'START_ROUND' });
  const log: string[] = [];
  let lastRound = 0;
  let safety = 5000;
  while (s.phase !== 'game-over' && safety-- > 0) {
    if (s.round > 50) break;
    const activeId = s.turnOrder[s.currentTurnIdx];
    if (!activeId) break;
    if (verbose && s.round !== lastRound) {
      log.push(`\n## Round ${s.round}`);
      log.push(`Order: ${s.turnOrder.map((id) => `${s.units[id].name}(hp${s.units[id].hp}/sla${s.units[id].slancio}/imp${s.units[id].impeto})`).join(' → ')}`);
      lastRound = s.round;
    }
    const u = s.units[activeId];
    let ev: any;
    if (s.phase === 'turn-start') { const d = aiDecideTurnStart(s, activeId); ev = { type: 'START_TURN', slancioDice: d.slancioDice, impetoToSlancio: d.impetoToSlancio }; }
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
    if (ev.type === 'MOVE' && prevPos) {
      const after = s.units[ev.unitId];
      if (after && after.position.q === prevPos.q && after.position.r === prevPos.r && s.phase === 'choosing-action') {
        s = reduce(s, { type: 'END_TURN' });
        if (verbose) log.push(`  ${u.name}: MOVE rifiutato → END_TURN`);
        continue;
      }
    }
    if (verbose) {
      if (ev.type === 'START_TURN') {
        const after = s.units[activeId];
        log.push(`  ${u.name}: TURN dice=${ev.slancioDice} transfer=${ev.impetoToSlancio ?? 0} → sla ${after.slancio} imp ${after.impeto} dadi ${after.dadiAzione}`);
      } else if (ev.type === 'MOVE') {
        const a = s.units[activeId];
        log.push(`  ${u.name}: MOVE → (${a.position.q},${a.position.r}) sla ${a.slancio}`);
      } else if (ev.type === 'DECLARE_ATTACK') {
        log.push(`  ${u.name}: DECLARE ${ev.isRanged ? 'RANGED' : 'MELEE'} con ${ev.weaponId} → ${s.units[ev.targetId].name}`);
      } else if (ev.type === 'RESOLVE_COMBAT') {
        const lr = s.lastResolution;
        if (lr) log.push(`    RESOLVE: ${lr.attackerName}→${lr.defenderName} ${lr.hit ? `HIT eff${lr.effectiveDamage}` : 'MISS'}`);
      } else if (ev.type === 'RELOAD') {
        log.push(`  ${u.name}: RELOAD`);
      }
    }
  }
  return {
    winner: s.winner ?? 'timeout',
    rounds: s.round,
    aliveA: Object.values(s.units).filter((u) => u.faction === 'A' && u.alive).length,
    aliveB: Object.values(s.units).filter((u) => u.faction === 'B' && u.alive).length,
    log,
  };
}

describe('3 arcieri vs 3 tank', () => {
  it('WR sweep 30 seed + dump 1 partita verbose', async () => {
    // Sweep
    let winA = 0, winB = 0, draw = 0, timeout = 0;
    const rounds: number[] = [];
    for (let i = 0; i < 30; i++) {
      const r = await runMatch(['arciere', 'arciere', 'arciere'], ['tank', 'tank', 'tank'], 30000 + i * 13, false);
      if (r.winner === 'A') winA++;
      else if (r.winner === 'B') winB++;
      else if (r.winner === 'draw') draw++;
      else timeout++;
      rounds.push(r.rounds);
    }
    const avgRound = rounds.reduce((a, b) => a + b, 0) / rounds.length;
    // eslint-disable-next-line no-console
    console.log(`\n=== 3 arcieri vs 3 tank — 30 partite ===`);
    // eslint-disable-next-line no-console
    console.log(`WR arcieri: ${(winA / 30 * 100).toFixed(0)}% | WR tank: ${(winB / 30 * 100).toFixed(0)}% | draw: ${draw} | timeout: ${timeout}`);
    // eslint-disable-next-line no-console
    console.log(`avg rounds: ${avgRound.toFixed(1)}`);

    // Dump verbose 1 partita
    const dump = await runMatch(['arciere', 'arciere', 'arciere'], ['tank', 'tank', 'tank'], 30000, true);
    const md = `# 3 arcieri vs 3 tank — sweep + dump\n\nWR arc: ${(winA / 30 * 100).toFixed(0)}%  WR tank: ${(winB / 30 * 100).toFixed(0)}%  avg round: ${avgRound.toFixed(1)}\n\n## Dump verbose seed 30000\nWinner: ${dump.winner} round ${dump.rounds} alive A=${dump.aliveA}/3 B=${dump.aliveB}/3\n\n${dump.log.join('\n')}`;
    writeFileSync('/tmp/arc-vs-tank-3v3.md', md);
    // eslint-disable-next-line no-console
    console.log(`Dump in /tmp/arc-vs-tank-3v3.md`);
    expect(winA + winB + draw + timeout).toBe(30);
  }, 60000);
});

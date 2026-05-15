/**
 * Diagnostic dei 3 squilibri identificati: traccia colpo-per-colpo per
 * capire la meccanica esatta che li produce.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';

async function dumpMatch(
  teamA: string[],
  teamB: string[],
  seed: number,
  label: string,
): Promise<string> {
  const { createInitialState } = await import('@core/state');
  const { reduce } = await import('@core/reducer');
  const { unitFromPreset, getPreset } = await import('@data/presets');
  const { aiDecideAction, aiDecideTurnStart, aiDecideAttackerDice, aiDecideDefense } = await import('@ai/basicAi');
  const { offsetToAxial } = await import('@core/hex/coords');

  const cols = 24, rows = 18;
  const midRow = 9;
  const deployLine = (n: number) => {
    const sp = 4;
    const tot = (n - 1) * sp;
    const start = Math.max(2, Math.floor(midRow - tot / 2));
    return Array.from({ length: n }, (_, i) => Math.min(rows - 3, start + i * sp));
  };
  const rA = deployLine(teamA.length), rB = deployLine(teamB.length);
  const units: any[] = [];
  for (let i = 0; i < teamA.length; i++) {
    const p = getPreset(teamA[i])!;
    units.push(Object.assign(unitFromPreset(p, 'A', offsetToAxial({ col: 2, row: rA[i] })), { id: `A${i + 1}`, name: `A${i + 1}_${p.name}` }));
  }
  for (let i = 0; i < teamB.length; i++) {
    const p = getPreset(teamB[i])!;
    units.push(Object.assign(unitFromPreset(p, 'B', offsetToAxial({ col: 21, row: rB[i] })), { id: `B${i + 1}`, name: `B${i + 1}_${p.name}` }));
  }

  let s = createInitialState({ units, board: { cols, rows }, rngSeed: seed });
  s = reduce(s, { type: 'START_ROUND' });

  const log: string[] = [];
  log.push(`# ${label}`);
  log.push(`Seed: ${seed}`);
  log.push(`Setup:`);
  for (const u of Object.values(s.units)) {
    log.push(`  ${u.name}: ${u.weapon ?? 'no-weapon'} ${u.offhand ? `+ ${u.offhand}` : ''} ${u.armor ?? 'no-armor'} | HP ${u.hp} sla ${u.slancio} imp ${u.impeto}`);
  }
  log.push('');

  const fmtUnit = (u: any) => `${u.name}(hp${u.hp}/sla${u.slancio})`;
  let safety = 5000;
  let lastRound = 0;
  while (s.phase !== 'game-over' && safety-- > 0) {
    if (s.round > 60) break;
    const activeId = s.turnOrder[s.currentTurnIdx];
    if (!activeId) break;
    if (s.round !== lastRound) {
      log.push(`\n## Round ${s.round}`);
      log.push(`Order: ${s.turnOrder.map((id) => fmtUnit(s.units[id])).join(' → ')}`);
      lastRound = s.round;
    }
    const u = s.units[activeId];
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
    const prev = s;
    s = reduce(s, ev);
    if (ev.type === 'MOVE' && prevPos) {
      const after = s.units[ev.unitId];
      if (after && after.position.q === prevPos.q && after.position.r === prevPos.r && s.phase === 'choosing-action') {
        s = reduce(s, { type: 'END_TURN' });
        log.push(`  ${u.name}: MOVE rifiutato → END_TURN`);
        continue;
      }
    }

    // Log significativo
    if (ev.type === 'START_TURN') {
      const after = s.units[activeId];
      log.push(`  ${u.name}: TURNO start, slancio_dice=${ev.slancioDice} → sla ${after.slancio} imp ${after.impeto} dadi ${after.dadiAzione}`);
    } else if (ev.type === 'MOVE') {
      const before = prev.units[activeId];
      const after = s.units[activeId];
      const tgt = ev.targetHex;
      const dist = Math.abs(before.position.q - tgt.q) + Math.abs(before.position.r - tgt.r);
      const pos2 = `(${after.position.q},${after.position.r})`;
      log.push(`  ${u.name}: MOVE → ${pos2} (∆${dist}), sla ${after.slancio}`);
    } else if (ev.type === 'DECLARE_ATTACK') {
      const target = s.units[ev.targetId];
      log.push(`  ${u.name}: DECLARE ${ev.isRanged ? 'RANGED' : 'MELEE'} con ${ev.weaponId} → ${target.name}`);
    } else if (ev.type === 'CHOOSE_ATTACKER_DICE') {
      log.push(`    → atk ${ev.diceN} dadi`);
    } else if (ev.type === 'CHOOSE_DEFENSE') {
      log.push(`    → def: ${ev.defenseType} ${ev.parryWith ?? ''} (${ev.diceN}d)`);
    } else if (ev.type === 'RESOLVE_COMBAT') {
      const lr = s.lastResolution;
      if (lr) {
        log.push(
          `    RESOLVE: ${lr.attackerName} → ${lr.defenderName}: var=[${lr.attackerDice.join(',')}] sum${lr.attackerVariable} +fix${lr.attackerFixed}=tot${lr.attackerTotal}` +
            ` vs def_tot${lr.defenderTotal} → ${lr.hit ? `HIT raw${lr.rawDamage} eff${lr.effectiveDamage}` : 'MISS'}`,
        );
      }
    } else if (ev.type === 'RELOAD') {
      log.push(`  ${u.name}: RELOAD`);
    } else if (ev.type === 'END_TURN') {
      // skip noise
    }
  }
  log.push(`\n## END: phase=${s.phase} winner=${s.winner ?? 'timeout'} round=${s.round}`);
  log.push(`Final HP/alive:`);
  for (const u of Object.values(s.units)) {
    log.push(`  ${u.name}: hp ${u.hp} ${u.alive ? 'alive' : '✝'}`);
  }
  return log.join('\n');
}

describe('Skirmish imbalance diagnostic', () => {
  it('Dump 3 partite: tank vs arc, arc vs all-melee, mirror arc+spa', async () => {
    const dumps: string[] = [];
    dumps.push(await dumpMatch(['tank', 'tank'], ['arciere', 'arciere'], 20000, '🔴 Tank+Tank vs Arc+Arc (WR A 95%)'));
    dumps.push('\n\n---\n\n');
    dumps.push(await dumpMatch(['arciere', 'arciere', 'arciere', 'arciere'], ['spadaccino', 'spadaccino', 'tank', 'tank'], 20000, '🔴 4 arcieri vs all-melee (WR B 90%)'));
    dumps.push('\n\n---\n\n');
    dumps.push(await dumpMatch(['arciere', 'spadaccino'], ['arciere', 'spadaccino'], 20000, '⚠️ Mirror arc+spa (WR A 75%) seed 20000'));
    dumps.push('\n\n---\n\n');
    dumps.push(await dumpMatch(['arciere', 'spadaccino'], ['arciere', 'spadaccino'], 20051, '⚠️ Mirror arc+spa (WR A 75%) seed 20051'));

    writeFileSync('/tmp/skirmish-imbalance-diag.md', dumps.join(''), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`Diag salvato in /tmp/skirmish-imbalance-diag.md (${dumps.join('').length} chars)`);
    expect(dumps.length).toBeGreaterThan(0);
  }, 60000);
});

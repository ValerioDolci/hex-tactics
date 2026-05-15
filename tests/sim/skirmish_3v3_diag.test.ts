/**
 * Diagnostic: cosa succede in una partita 3v3 che timeout?
 * Conta i tipi di evento, gli HP totali per faction, i damage event,
 * e dumpa cosa fanno le unit.
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync } from 'fs';

describe('Skirmish 3v3 timeout — diagnosi', () => {
  it('dump dettagliato eventi e stato', async () => {
    const { createInitialState } = await import('@core/state');
    const { reduce } = await import('@core/reducer');
    const { unitFromPreset, getPreset } = await import('@data/presets');
    const { aiDecideAction, aiDecideSlancio, aiDecideAttackerDice, aiDecideDefense } = await import('@ai/basicAi');
    const { offsetToAxial } = await import('@core/hex/coords');

    const presets = ['arciere', 'spadaccino', 'tank'];
    const units: any[] = [];
    for (let i = 0; i < 3; i++) {
      const preset = getPreset(presets[i])!;
      const rA = 4 + i * 4;
      const rB = 4 + i * 4;
      units.push(Object.assign(unitFromPreset(preset, 'A', offsetToAxial({ col: 2, row: rA })), { id: `A${i + 1}`, name: `${preset.name}_A${i + 1}` }));
      units.push(Object.assign(unitFromPreset(preset, 'B', offsetToAxial({ col: 21, row: rB })), { id: `B${i + 1}`, name: `${preset.name}_B${i + 1}` }));
    }

    let s = createInitialState({ units, board: { cols: 24, rows: 18 }, rngSeed: 11003 });
    s = reduce(s, { type: 'START_ROUND' });

    const eventCounts: Record<string, number> = {};
    const damageEvents: { round: number; attacker: string; target: string; damage: number; hit: boolean }[] = [];
    const trace: string[] = [];
    let safety = 5000;
    while (s.phase !== 'game-over' && safety-- > 0) {
      if (s.round > 100) break;
      const activeId = s.turnOrder[s.currentTurnIdx];
      if (!activeId) break;
      let ev: any;
      if (s.phase === 'turn-start') ev = { type: 'START_TURN', slancioDice: aiDecideSlancio(s, activeId) };
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
      eventCounts[ev.type] = (eventCounts[ev.type] ?? 0) + 1;
      const prevPos = ev.type === 'MOVE' ? s.units[ev.unitId]?.position : undefined;
      const prev = s;
      s = reduce(s, ev);
      if (ev.type === 'MOVE' && prevPos) {
        const after = s.units[ev.unitId];
        if (after && after.position.q === prevPos.q && after.position.r === prevPos.r && s.phase === 'choosing-action') {
          s = reduce(s, { type: 'END_TURN' });
          eventCounts['END_TURN_FALLBACK'] = (eventCounts['END_TURN_FALLBACK'] ?? 0) + 1;
        }
      }
      // RESOLVE_COMBAT: registra danno
      if (ev.type === 'RESOLVE_COMBAT') {
        const lr = s.lastResolution;
        if (lr) {
          damageEvents.push({
            round: s.round,
            attacker: lr.attackerName,
            target: lr.defenderName,
            damage: lr.effectiveDamage,
            hit: lr.hit,
          });
        }
      }
      // Trace turn-by-turn (più dettagliato per capire cosa fa ogni unit)
      if (s.round !== prev.round || (ev.type === 'END_TURN' && s.round <= 3) || (ev.type === 'MOVE' && s.round <= 3)) {
        const fmt = (u: any) => `${u.name}@(${u.position.q},${u.position.r}) hp${u.hp} sla${u.slancio} imp${u.impeto} dadi${u.dadiAzione}`;
        const aliveA = Object.values(s.units).filter((u) => u.faction === 'A' && u.alive);
        const aliveB = Object.values(s.units).filter((u) => u.faction === 'B' && u.alive);
        trace.push(
          `[r${s.round} after ${ev.type}] A: ${aliveA.map(fmt).join(' | ')} || B: ${aliveB.map(fmt).join(' | ')}`,
        );
      }
    }

    const summary = `
=== Skirmish 3v3 diag ===
Final phase: ${s.phase}
Final round: ${s.round}
Winner: ${s.winner ?? 'timeout'}
Safety left: ${safety}
Events totali: ${Object.values(eventCounts).reduce((a, b) => a + b, 0)}

Event counts:
${Object.entries(eventCounts)
      .sort((a, b) => b[1] - a[1])
      .map(([t, n]) => `  ${t}: ${n}`)
      .join('\n')}

Damage events: ${damageEvents.length}
- Hit: ${damageEvents.filter((d) => d.hit).length}
- Miss: ${damageEvents.filter((d) => !d.hit).length}
- Damage totale: ${damageEvents.reduce((s, d) => s + d.damage, 0)}
- Damage avg per hit: ${
      damageEvents.filter((d) => d.hit).length > 0
        ? (damageEvents.filter((d) => d.hit).reduce((s, d) => s + d.damage, 0) / damageEvents.filter((d) => d.hit).length).toFixed(2)
        : 'n/a'
    }
- Damage > 0 events: ${damageEvents.filter((d) => d.damage > 0).length}

Sample combat events:
${damageEvents.slice(0, 20).map((d) => `  r${d.round} ${d.attacker} → ${d.target}: ${d.hit ? `HIT ${d.damage}` : 'MISS'}`).join('\n')}
${damageEvents.length > 20 ? `... and ${damageEvents.length - 20} more` : ''}

Sample trace (last 30 entries):
${trace.slice(-30).join('\n')}
`;
    writeFileSync('/tmp/skirmish-3v3-diag.txt', summary, 'utf8');
    // eslint-disable-next-line no-console
    console.log(summary);
    expect(s.round).toBeGreaterThan(0); // dummy assert, vogliamo solo il dump
  }, 30000);
});

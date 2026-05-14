/**
 * Smoke test del combat narrator — verifica che per ogni famiglia di evento
 * generi una stringa non vuota nel tono atteso. Non valida la qualità letteraria
 * (quella si tara a vista), ma cattura regressioni tipo "evento muto".
 */
import { describe, it, expect } from 'vitest';
import { createInitialState } from '@core/state';
import { reduce } from '@core/reducer';
import { unitFromPreset, getPreset } from '@data/presets';
import { narrate } from '@ui/combatNarrator';
import { GameEvent } from '@core/events';

function setup() {
  const a = unitFromPreset(getPreset('arciere')!, 'A', { q: 0, r: 0 }, 'Arciere');
  a.id = 'A';
  const b = unitFromPreset(getPreset('tank')!, 'B', { q: 4, r: 0 }, 'Tank');
  b.id = 'B';
  return createInitialState({ units: [a, b], board: { cols: 24, rows: 18 }, rngSeed: 42 });
}

describe('combatNarrator', () => {
  it('narra START_ROUND iniziale (prende l\'iniziativa)', () => {
    const prev = setup();
    const curr = reduce(prev, { type: 'START_ROUND' });
    const line = narrate({ prev, curr, event: { type: 'START_ROUND' } });
    expect(line).not.toBeNull();
    expect(line!.tone).toBe('initiative');
    expect(line!.text.length).toBeGreaterThan(5);
    // eslint-disable-next-line no-console
    console.log(`  [start-round] ${line!.text}`);
  });

  it('narra RELOAD per arco', () => {
    const prev = setup();
    let s = reduce(prev, { type: 'START_ROUND' });
    s = { ...s, units: { ...s.units, A: { ...s.units['A'], weaponLoaded: false, slancio: 12 } } };
    // Force A first
    s = { ...s, turnOrder: ['A', 'B'], currentTurnIdx: 0, phase: 'turn-start' };
    s = reduce(s, { type: 'START_TURN', slancioDice: 2 });
    const before = s;
    const after = reduce(s, { type: 'RELOAD', unitId: 'A', diceN: 1 });
    const line = narrate({ prev: before, curr: after, event: { type: 'RELOAD', unitId: 'A', diceN: 1 } });
    expect(line).not.toBeNull();
    expect(line!.text).toMatch(/arco|corda|faretra/i);
    // eslint-disable-next-line no-console
    console.log(`  [reload-bow] ${line!.text}`);
  });

  it('narra MOVE avvicinamento', () => {
    const prev = setup();
    let s = reduce(prev, { type: 'START_ROUND' });
    s = { ...s, turnOrder: ['A', 'B'], currentTurnIdx: 0, phase: 'turn-start' };
    s = reduce(s, { type: 'START_TURN', slancioDice: 2 });
    const before = s;
    const target = { q: 1, r: 0 };
    const after = reduce(s, { type: 'MOVE', unitId: 'A', targetHex: target });
    const line = narrate({ prev: before, curr: after, event: { type: 'MOVE', unitId: 'A', targetHex: target } });
    // Può essere null se il move è bloccato/contestato; se invece c'è movimento, deve narrare
    if (line !== null) {
      expect(line.text.length).toBeGreaterThan(5);
      // eslint-disable-next-line no-console
      console.log(`  [move-approach] ${line.text}`);
    }
  });

  it('non narra eventi sub-step (CHOOSE_DEFENSE, CHOOSE_ATTACKER_DICE)', () => {
    const prev = setup();
    const curr = prev;
    const noisy: any = { type: 'CHOOSE_DEFENSE', defenseType: 'dodge', diceN: 2 };
    const line = narrate({ prev, curr, event: noisy });
    expect(line).toBeNull();
  });

  it('narra RESOLVE_COMBAT ranged hit (arco, magnitudo > 0)', () => {
    const prev = setup();
    let s = reduce(prev, { type: 'START_ROUND' });
    s = { ...s, turnOrder: ['A', 'B'], currentTurnIdx: 0, phase: 'turn-start' };
    s = reduce(s, { type: 'START_TURN', slancioDice: 2 });
    // setup ranged attack
    s = reduce(s, {
      type: 'DECLARE_ATTACK',
      attackerId: 'A',
      targetId: 'B',
      weaponId: 'arco_lungo',
      attackModeIdx: 0,
      chosenStat: 'agilità',
      isRanged: true,
    });
    s = reduce(s, { type: 'CHOOSE_ATTACKER_DICE', diceN: 2 });
    const before = s;
    const after = reduce(s, { type: 'RESOLVE_COMBAT' });
    const line = narrate({ prev: before, curr: after, event: { type: 'RESOLVE_COMBAT' } });
    expect(line).not.toBeNull();
    expect(line!.text.length).toBeGreaterThan(10);
    expect(['hit', 'miss'].includes(line!.tone)).toBe(true);
    // eslint-disable-next-line no-console
    console.log(`  [resolve-ranged] tone=${line!.tone} → ${line!.text}`);
  });

  it('determinismo: stesso seed = stessa narrazione', () => {
    const prev = setup();
    const curr = reduce(prev, { type: 'START_ROUND' });
    const a = narrate({ prev, curr, event: { type: 'START_ROUND' } });
    const b = narrate({ prev, curr, event: { type: 'START_ROUND' } });
    expect(a?.text).toBe(b?.text);
  });

  // ===========================================================================
  // Dump cronaca completa: arciere vs tank — verifica tono "vivo"
  // ===========================================================================
  it('CRONACA — dump partita completa arciere vs tank', async () => {
    const { runBattle } = await import('../../scripts/simulate');
    const r = runBattle('arciere', 'tank', 9001, 30, true, 19, {
      modeA: 'hard',
      modeB: 'heuristic',
    });
    // rawLog contiene tutto, ma noi vogliamo solo gli eventi narrabili.
    // Replay manuale per generare la cronaca completa.
    let s = createInitialState({
      units: [
        Object.assign(unitFromPreset(getPreset('arciere')!, 'A', { q: 8, r: 0 }, 'Arciere'), { id: 'A' }),
        Object.assign(unitFromPreset(getPreset('tank')!, 'B', { q: 16, r: 0 }, 'Tank'), { id: 'B' }),
      ],
      board: { cols: 24, rows: 18 },
      rngSeed: 9001,
    });
    // Mini-driver: replica i dispatch da runBattle ma chiama narrate ad ogni evento
    const events: { ev: any; text: string | null }[] = [];
    void r;
    // Per semplicità, simulo eventi base usando le AI direttamente
    const { aiDecideStudentMlp } = await import('../../src/ai/studentMlpAi');
    const { aiDecideAction, aiDecideSlancio, aiDecideAttackerDice, aiDecideDefense } = await import('../../src/ai/basicAi');
    let safety = 600;
    s = (() => { const prev = s; const curr = reduce(s, { type: 'START_ROUND' }); events.push({ ev: { type: 'START_ROUND' }, text: narrate({ prev, curr, event: { type: 'START_ROUND' } })?.text ?? null }); return curr; })();
    while (s.phase !== 'game-over' && safety-- > 0) {
      const activeId = s.turnOrder[s.currentTurnIdx];
      if (!activeId) break;
      const u = s.units[activeId];
      if (!u) break;
      let ev: any;
      if (s.phase === 'turn-start') {
        ev = u.faction === 'A' ? aiDecideStudentMlp(s, activeId) : { type: 'START_TURN', slancioDice: aiDecideSlancio(s, activeId) };
        if (ev.type !== 'START_TURN') ev = { type: 'START_TURN', slancioDice: 2 };
      } else if (s.phase === 'choosing-action') {
        ev = u.faction === 'A' ? aiDecideStudentMlp(s, activeId) : aiDecideAction(s, activeId);
      } else if (s.phase === 'declaring-attack') {
        ev = { type: 'CHOOSE_ATTACKER_DICE', diceN: aiDecideAttackerDice(s, activeId) };
      } else if (s.phase === 'awaiting-defense') {
        const defId = s.pendingAction!.targetId;
        const def = aiDecideDefense(s, defId);
        ev = { type: 'CHOOSE_DEFENSE', defenseType: def.defenseType, parryWith: def.parryWith, diceN: def.diceN };
      } else if (s.phase === 'resolving') {
        ev = { type: 'RESOLVE_COMBAT' };
      } else if (s.phase === 'awaiting-attacker-bid' || s.phase === 'awaiting-defender-bid') {
        ev = { type: 'BID_MOVEMENT', amount: 0 };
      } else if (s.phase === 'awaiting-carica') {
        ev = { type: 'CHOOSE_CARICA', amount: 0 };
      } else {
        break;
      }
      const prev = s;
      const prevPos = ev.type === 'MOVE' ? s.units[ev.unitId]?.position : undefined;
      s = reduce(s, ev as GameEvent);
      // MOVE rifiutato → END_TURN fallback
      if (ev.type === 'MOVE' && prevPos) {
        const after = s.units[ev.unitId];
        if (after && after.position.q === prevPos.q && after.position.r === prevPos.r && s.phase === 'choosing-action') {
          s = reduce(s, { type: 'END_TURN' });
          continue;
        }
      }
      const line = narrate({ prev, curr: s, event: ev });
      events.push({ ev, text: line?.text ?? null });
    }
    // eslint-disable-next-line no-console
    console.log('\n========== CRONACA ==========');
    for (const e of events) {
      if (e.text) {
        // eslint-disable-next-line no-console
        console.log(`  · ${e.text}`);
      }
    }
    // eslint-disable-next-line no-console
    console.log(`============================== (${events.filter((x) => x.text).length} righe, ${events.length} eventi totali, vincitore ${s.winner})`);
    expect(events.filter((x) => x.text).length).toBeGreaterThan(2);
  }, 30000);
});

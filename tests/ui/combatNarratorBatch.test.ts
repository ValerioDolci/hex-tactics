/**
 * Batch dump cronache narrate — gira N partite variate (matchup + seed), salva
 * la cronaca aggregata in /tmp per valutazione "a freddo" del tono.
 *
 * NON è una vera unit test: passa sempre. Serve a generare il corpus da rivedere.
 *
 * Esegui:
 *   PATH=/opt/homebrew/bin:$PATH node node_modules/.bin/vitest run \
 *     tests/ui/combatNarratorBatch.test.ts --reporter=verbose
 *
 * Output: /tmp/narrator-batch.md
 */
import { describe, it, expect } from 'vitest';
import { writeFileSync, mkdirSync } from 'fs';
import { createInitialState, GameState } from '@core/state';
import { reduce } from '@core/reducer';
import { unitFromPreset, getPreset } from '@data/presets';
import { aiDecideStudentMlp } from '@ai/studentMlpAi';
import { aiDecideAction, aiDecideAttackerDice, aiDecideDefense, aiDecideSlancio } from '@ai/basicAi';
import { offsetToAxial } from '@core/hex/coords';
import { narrate, NarrationLine } from '@ui/combatNarrator';
import { GameEvent } from '@core/events';

function setupMatch(presetA: string, presetB: string, seed: number, deployHexDist = 19) {
  const cols = 24;
  const rows = 18;
  const midRow = Math.floor(rows / 2);
  const halfDist = Math.floor(deployHexDist / 2);
  const cxCenter = Math.floor(cols / 2);
  const colA = Math.max(0, cxCenter - halfDist - 1);
  const colB = Math.min(cols - 1, cxCenter + halfDist);
  const a = Object.assign(
    unitFromPreset(getPreset(presetA)!, 'A', offsetToAxial({ col: colA, row: midRow }), `A·${presetA}`),
    { id: 'A' },
  );
  const b = Object.assign(
    unitFromPreset(getPreset(presetB)!, 'B', offsetToAxial({ col: colB, row: midRow }), `B·${presetB}`),
    { id: 'B' },
  );
  return createInitialState({ units: [a, b], board: { cols, rows }, rngSeed: seed });
}

interface ChronicleEntry {
  text: string;
  tone: NonNullable<NarrationLine>['tone'];
}

function runMatchChronicle(
  presetA: string,
  presetB: string,
  seed: number,
  deployHexDist: number,
  modeA: 'hard' | 'heuristic',
  modeB: 'hard' | 'heuristic',
): { entries: ChronicleEntry[]; winner: string; rounds: number } {
  let s = setupMatch(presetA, presetB, seed, deployHexDist);
  const entries: ChronicleEntry[] = [];
  const pushLine = (prev: GameState, curr: GameState, ev: GameEvent) => {
    const line = narrate({ prev, curr, event: ev });
    if (line) entries.push({ text: line.text, tone: line.tone });
  };

  const decide = (st: GameState, unitId: string, mode: 'hard' | 'heuristic'): GameEvent => {
    if (mode === 'hard') return aiDecideStudentMlp(st, unitId);
    // heuristic: dispatch sub-fase
    if (st.phase === 'turn-start') return { type: 'START_TURN', slancioDice: aiDecideSlancio(st, unitId) };
    if (st.phase === 'choosing-action') return aiDecideAction(st, unitId);
    if (st.phase === 'declaring-attack')
      return { type: 'CHOOSE_ATTACKER_DICE', diceN: aiDecideAttackerDice(st, unitId) };
    if (st.phase === 'awaiting-defense') {
      const defId = st.pendingAction?.targetId ?? unitId;
      const def = aiDecideDefense(st, defId);
      return { type: 'CHOOSE_DEFENSE', defenseType: def.defenseType, parryWith: def.parryWith, diceN: def.diceN };
    }
    if (st.phase === 'resolving') return { type: 'RESOLVE_COMBAT' };
    return { type: 'END_TURN' };
  };

  // START_ROUND iniziale
  {
    const prev = s;
    s = reduce(s, { type: 'START_ROUND' });
    pushLine(prev, s, { type: 'START_ROUND' });
  }

  let safety = 500;
  while (s.phase !== 'game-over' && safety-- > 0) {
    if (s.round > 30) break;
    const activeId = s.turnOrder[s.currentTurnIdx];
    if (!activeId) break;
    const u = s.units[activeId];
    if (!u) break;

    let ev: GameEvent;
    if (s.phase === 'awaiting-defense') {
      const defId = s.pendingAction!.targetId;
      const def = s.units[defId];
      const defMode = def.faction === 'A' ? modeA : modeB;
      ev = decide(s, defId, defMode);
    } else if (s.phase === 'awaiting-attacker-bid' || s.phase === 'awaiting-defender-bid') {
      ev = { type: 'BID_MOVEMENT', amount: 0 };
    } else if (s.phase === 'awaiting-carica') {
      ev = { type: 'CHOOSE_CARICA', amount: 0 };
    } else if (s.phase === 'resolving') {
      ev = { type: 'RESOLVE_COMBAT' };
    } else {
      const mode = u.faction === 'A' ? modeA : modeB;
      ev = decide(s, activeId, mode);
    }

    const prev = s;
    const prevPos = ev.type === 'MOVE' ? s.units[ev.unitId]?.position : undefined;
    const prevRound = prev.round;
    s = reduce(s, ev);
    // Fallback MOVE rifiutato
    if (ev.type === 'MOVE' && prevPos) {
      const after = s.units[ev.unitId];
      if (after && after.position.q === prevPos.q && after.position.r === prevPos.r && s.phase === 'choosing-action') {
        s = reduce(s, { type: 'END_TURN' });
        continue;
      }
    }
    pushLine(prev, s, ev);
    // Se è cambiato il round (END_ROUND ha triggerato un nuovo START_ROUND implicito)
    // narra il start_round
    if (s.round > prevRound && s.round > 1) {
      const synthetic: GameEvent = { type: 'START_ROUND' };
      pushLine(prev, s, synthetic);
    }
  }

  return { entries, winner: s.winner ?? 'timeout', rounds: s.round };
}

describe('Combat narrator — batch cronache per review qualità tono', () => {
  it('Genera 20 cronache su matchup variati → /tmp/narrator-batch.md', () => {
    const matchups: Array<{
      a: string;
      b: string;
      deploy: number;
      modeA: 'hard' | 'heuristic';
      modeB: 'hard' | 'heuristic';
      title: string;
    }> = [
      // Variazione matchup × deploy × AI mode
      { a: 'arciere', b: 'spadaccino', deploy: 19, modeA: 'hard', modeB: 'heuristic', title: 'Arciere (hard) vs Spadaccino (heuristic) — deploy lontano' },
      { a: 'arciere', b: 'spadaccino', deploy: 5, modeA: 'hard', modeB: 'heuristic', title: 'Arciere (hard) vs Spadaccino (heuristic) — deploy ravvicinato' },
      { a: 'arciere', b: 'tank', deploy: 19, modeA: 'hard', modeB: 'heuristic', title: 'Arciere (hard) vs Tank (heuristic) — deploy lontano' },
      { a: 'arciere', b: 'tank', deploy: 7, modeA: 'hard', modeB: 'heuristic', title: 'Arciere (hard) vs Tank (heuristic) — deploy medio' },
      { a: 'spadaccino', b: 'tank', deploy: 7, modeA: 'heuristic', modeB: 'heuristic', title: 'Spadaccino vs Tank — duello classico' },
      { a: 'tank', b: 'tank', deploy: 7, modeA: 'heuristic', modeB: 'heuristic', title: 'Tank vs Tank — mirror tank' },
      { a: 'spadaccino', b: 'spadaccino', deploy: 7, modeA: 'heuristic', modeB: 'heuristic', title: 'Spadaccino vs Spadaccino — mirror' },
      { a: 'arciere', b: 'arciere', deploy: 19, modeA: 'hard', modeB: 'heuristic', title: 'Arciere mirror' },
    ];
    const seedsPerMatchup = [3001, 3007, 3013]; // 3 partite × 8 matchup = 24 → ne tengo 20 (taglio le ultime 4 più brevi)

    const md: string[] = [];
    md.push('# Cronache narrate — batch review\n');
    md.push(`Generato il ${new Date().toISOString()}\n`);
    md.push('Per ogni partita: matchup, esito, e cronaca completa nello stile "Codex Tacticus".\n');
    md.push('Scopo: leggere a freddo per scovare ripetizioni, frasi che suonano male, gap.\n\n---\n');

    let total = 0;
    const allLines: string[] = [];
    for (const m of matchups) {
      for (const seed of seedsPerMatchup) {
        if (total >= 20) break;
        total++;
        const r = runMatchChronicle(m.a, m.b, seed, m.deploy, m.modeA, m.modeB);
        md.push(`\n## ${total}. ${m.title} — seed ${seed}\n`);
        md.push(`*Esito: vincitore **${r.winner}** in ${r.rounds} round, ${r.entries.length} righe narrate*\n\n`);
        if (r.entries.length === 0) {
          md.push('_(nessuna narrazione generata)_\n');
        } else {
          for (const e of r.entries) {
            md.push(`- *(${e.tone})* ${e.text}\n`);
            allLines.push(e.text);
          }
        }
      }
      if (total >= 20) break;
    }

    // Sezione "tutte le frasi flat" per scovare ripetizioni rapidamente
    md.push('\n---\n\n# Tutte le frasi (flat, ordinate per frequenza)\n\n');
    const counts = new Map<string, number>();
    for (const l of allLines) counts.set(l, (counts.get(l) ?? 0) + 1);
    const sorted = Array.from(counts.entries()).sort((a, b) => b[1] - a[1]);
    for (const [text, n] of sorted) md.push(`- **×${n}** ${text}\n`);

    try {
      mkdirSync('/tmp', { recursive: true });
    } catch (e) {
      void e;
    }
    writeFileSync('/tmp/narrator-batch.md', md.join(''), 'utf8');
    // eslint-disable-next-line no-console
    console.log(`\n=== Batch generato: /tmp/narrator-batch.md ===`);
    // eslint-disable-next-line no-console
    console.log(`  Partite: ${total}`);
    // eslint-disable-next-line no-console
    console.log(`  Righe narrate totali: ${allLines.length}`);
    // eslint-disable-next-line no-console
    console.log(`  Righe uniche: ${sorted.length}`);
    // eslint-disable-next-line no-console
    console.log(`  Top ripetizioni: ${sorted.slice(0, 5).map(([t, n]) => `${n}×"${t.slice(0, 40)}…"`).join(', ')}`);
    expect(total).toBeGreaterThan(0);
  }, 60000);
});

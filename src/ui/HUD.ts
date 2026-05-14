import Phaser from 'phaser';
import { Unit } from '@entities/Unit';
import { GameState } from '@core/state';
import { FONTS, PALETTE, makeCodexPanel, factionTincture } from './theme';

/**
 * HUD principale (Codex Tacticus): pannello vellum con bordo doppio inchiostro.
 * Mostra round, fazione di turno (con tintura araldica) e stat dell'unità attiva
 * in mono ink. Fissato alla camera (scrollFactor 0).
 *
 * Layout:
 *   ╔═══════════════════════════════╗
 *   ║ Round III  ·  azzurra         ║   ← display serif italic, faction tincture
 *   ║ Spadaccino                    ║   ← display serif, ink
 *   ║ HP 18/20  imp 32  sl 4        ║   ← mono ink
 *   ║ dadi 5/9                      ║
 *   ║ spada lunga · scudo · armatura║   ← body serif italic, ink soft
 *   ║ — fase: scelta azione         ║   ← body italic, ink faded
 *   ╚═══════════════════════════════╝
 */
export class HUD {
  private container: Phaser.GameObjects.Container;
  private title: Phaser.GameObjects.Text;
  private unitName: Phaser.GameObjects.Text;
  private statsLine: Phaser.GameObjects.Text;
  private equipLine: Phaser.GameObjects.Text;
  private phaseLine: Phaser.GameObjects.Text;

  constructor(scene: Phaser.Scene, x: number, y: number) {
    const w = 420;
    const h = 152;
    const panel = makeCodexPanel({ scene, x, y, width: w, height: h, tone: 'vellum', alpha: 0.96 });
    this.container = panel.container;
    this.container.setScrollFactor(0);

    this.title = scene.add.text(16, 12, '', {
      fontFamily: FONTS.display,
      fontSize: '20px',
      color: PALETTE.ink.css,
      fontStyle: 'italic',
    });

    this.unitName = scene.add.text(16, 38, '', {
      fontFamily: FONTS.display,
      fontSize: '19px',
      color: PALETTE.ink.css,
    });

    this.statsLine = scene.add.text(16, 64, '', {
      fontFamily: FONTS.mono,
      fontSize: '15px',
      color: PALETTE.ink.css,
    });

    this.equipLine = scene.add.text(16, 88, '', {
      fontFamily: FONTS.body,
      fontSize: '14px',
      color: PALETTE.inkSoft.css,
      fontStyle: 'italic',
      wordWrap: { width: w - 32 },
    });

    this.phaseLine = scene.add.text(16, 126, '', {
      fontFamily: FONTS.body,
      fontSize: '13px',
      color: PALETTE.inkSoft.css,
      fontStyle: 'italic',
    });

    this.container.add([this.title, this.unitName, this.statsLine, this.equipLine, this.phaseLine]);
  }

  update(state: GameState): void {
    if (state.turnOrder.length === 0) {
      this.title.setText('In attesa…');
      this.unitName.setText('');
      this.statsLine.setText('');
      this.equipLine.setText('');
      this.phaseLine.setText('');
      return;
    }
    const unitId = state.turnOrder[state.currentTurnIdx];
    const unit: Unit | undefined = state.units[unitId];
    if (!unit) return;

    const tincture = factionTincture(unit.faction);
    const roman = toRoman(state.round);
    this.title.setText(`Round ${roman}  ·  ${tincture.blason}`);
    this.title.setColor(tincture.css);

    this.unitName.setText(unit.name);
    this.statsLine.setText(
      `HP ${unit.hp}/${unit.hpMax}    imp ${unit.impeto}    sl ${unit.slancio}    dadi ${unit.dadiAzione}/${unit.dadiAzioneMax}`,
    );

    const equipParts = [unit.weapon, unit.offhand, unit.armor].filter(Boolean) as string[];
    this.equipLine.setText(equipParts.length > 0 ? equipParts.join(' · ') : '— disarmato —');
    this.phaseLine.setText(`— ${humanPhase(state.phase)} —`);
  }
}

function humanPhase(phase: string): string {
  switch (phase) {
    case 'turn-start':
      return 'inizio turno';
    case 'choosing-slancio':
      return 'tiro di slancio';
    case 'choosing-action':
      return 'scelta dell\'azione';
    case 'choosing-target':
      return 'scelta del bersaglio';
    case 'choosing-attack-dice':
      return 'preparazione dell\'attacco';
    case 'choosing-defense':
      return 'difesa attiva';
    case 'choosing-defense-dice':
      return 'preparazione della difesa';
    case 'resolving':
      return 'risoluzione';
    case 'game-over':
      return 'duello concluso';
    case 'handoff':
      return 'cambio di mano';
    default:
      return phase;
  }
}

function toRoman(n: number): string {
  if (n <= 0) return '0';
  const map: Array<[number, string]> = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of map) {
    while (n >= v) {
      out += s;
      n -= v;
    }
  }
  return out;
}

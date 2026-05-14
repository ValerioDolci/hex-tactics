import Phaser from 'phaser';
import { TUTORIAL_SCENARIOS, TutorialScenario, allCompleted } from '@data/tutorial';
import { paintVellum } from '@/ui/Vellum';
import { FONTS, PALETTE, makeCodexButton, makeCodexPanel } from '@/ui/theme';

const COMPLETION_KEY = 'hexTactics.tutorialCompletion';

interface CompletionState {
  completed: string[];
}

function loadCompletion(): CompletionState {
  try {
    const s = localStorage.getItem(COMPLETION_KEY);
    if (!s) return { completed: [] };
    return JSON.parse(s);
  } catch {
    return { completed: [] };
  }
}

export function saveCompletion(scenarioId: string): void {
  try {
    const c = loadCompletion();
    if (!c.completed.includes(scenarioId)) {
      c.completed.push(scenarioId);
      localStorage.setItem(COMPLETION_KEY, JSON.stringify(c));
    }
  } catch {
    // ignora
  }
}

/**
 * Lista degli scenari del tutorial, con stato (completed/in_progress/locked).
 * Gli scenari sono sequenziali: il primo è sempre disponibile, gli altri si
 * sbloccano completando i precedenti.
 */
export class TutorialMenuScene extends Phaser.Scene {
  constructor() {
    super({ key: 'TutorialMenuScene' });
  }

  create(): void {
    // Restart on resize (orientation change su mobile)
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize, this);
    });
    const w = this.scale.width;
    const h = this.scale.height;

    paintVellum(this, w, h);

    // Header
    const headerH = 60;
    this.add
      .text(w / 2, headerH / 2 - 4, 'Tutorial', {
        fontFamily: FONTS.display,
        fontSize: '28px',
        color: PALETTE.ink.css,
        fontStyle: 'italic',
      })
      .setOrigin(0.5, 0.5);
    this.add
      .text(w / 2, headerH / 2 + 18, 'Esercizi di scherma esagonale, in ordine', {
        fontFamily: FONTS.body,
        fontSize: '14px',
        color: PALETTE.inkSoft.css,
        fontStyle: 'italic',
      })
      .setOrigin(0.5, 0.5);

    // Filetto oro
    const ornament = this.add.graphics();
    ornament.lineStyle(1.2, PALETTE.gold.num, 0.85);
    ornament.lineBetween(w / 2 - 200, headerH + 8, w / 2 + 200, headerH + 8);

    this.makeBackButton(20, 12);

    // Carica stato completamenti
    const completion = loadCompletion();

    // Layout scenari
    const startY = headerH + 30;
    const itemW = Math.min(720, w - 80);
    const itemH = 78;
    const itemX = (w - itemW) / 2;
    const spacing = 14;

    let yy = startY;
    let prevCompleted = true; // il primo è sempre sbloccato

    for (const scenario of TUTORIAL_SCENARIOS) {
      const isCompleted = completion.completed.includes(scenario.id);
      const isUnlocked = isCompleted || prevCompleted;
      this.makeScenarioItem(itemX, yy, itemW, itemH, scenario, isCompleted, isUnlocked);
      yy += itemH + spacing;
      prevCompleted = isCompleted;
    }

    // Footer / banner di completamento
    const footerY = yy + 16;
    if (allCompleted(completion.completed)) {
      // Banner verde di completamento totale
      const bannerW = Math.min(680, w - 80);
      const bannerH = 60;
      const bx = (w - bannerW) / 2;
      makeCodexPanel({ scene: this, x: bx, y: footerY, width: bannerW, height: bannerH, tone: 'vellum', alpha: 0.95 });
      this.add
        .text(w / 2, footerY + bannerH / 2, '✦  Tutti gli esercizi completati. Si entra nel duello libero.', {
          fontFamily: FONTS.display,
          fontSize: '17px',
          color: PALETTE.goldDeep.css,
          fontStyle: 'italic bold',
        })
        .setOrigin(0.5, 0.5);
    } else {
      this.add
        .text(w / 2, footerY, 'Completa gli esercizi per padroneggiare le armi del Codex.', {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.inkSoft.css,
          fontStyle: 'italic',
        })
        .setOrigin(0.5, 0);
    }
  }

  private makeScenarioItem(
    x: number,
    y: number,
    w: number,
    h: number,
    scenario: TutorialScenario,
    completed: boolean,
    unlocked: boolean,
  ): void {
    // Pannello item codex
    const panel = makeCodexPanel({
      scene: this,
      x,
      y,
      width: w,
      height: h,
      tone: 'vellum',
      alpha: unlocked ? 0.95 : 0.5,
    });

    const titleColor = !unlocked ? PALETTE.inkFaded.css : completed ? PALETTE.verde.css : PALETTE.ink.css;
    const title = this.add
      .text(20, 16, scenario.title, {
        fontFamily: FONTS.display,
        fontSize: '19px',
        color: titleColor,
        fontStyle: 'italic bold',
      })
      .setOrigin(0, 0);

    const descColor = !unlocked ? PALETTE.inkFaded.css : PALETTE.ink.css;
    const desc = this.add
      .text(20, 44, scenario.shortDescription, {
        fontFamily: FONTS.body,
        fontSize: '14px',
        color: descColor,
        fontStyle: 'italic',
      })
      .setOrigin(0, 0);

    const statusText = !unlocked ? '⊘' : completed ? '✓ completato' : 'gioca  →';
    const statusColor = !unlocked
      ? PALETTE.inkFaded.css
      : completed
        ? PALETTE.verde.css
        : PALETTE.goldDeep.css;
    const status = this.add
      .text(w - 20, h / 2, statusText, {
        fontFamily: FONTS.display,
        fontSize: '17px',
        color: statusColor,
        fontStyle: 'italic bold',
      })
      .setOrigin(1, 0.5);

    panel.container.add([title, desc, status]);

    if (unlocked) {
      panel.bg.setInteractive({ useHandCursor: true });
      panel.bg.on('pointerover', () => panel.bg.setFillStyle(PALETTE.vellumDeep.num, 0.95));
      panel.bg.on('pointerout', () => panel.bg.setFillStyle(PALETTE.vellumDark.num, 0.95));
      panel.bg.on('pointerup', () => {
        this.scene.start('BattleScene', { tutorialMode: scenario.id });
      });
    }
  }

  private makeBackButton(x: number, y: number): void {
    makeCodexButton({
      scene: this,
      x,
      y,
      width: 110,
      height: 36,
      label: '←  Frontespizio',
      variant: 'outline',
      fontKind: 'display',
      fontSize: 13,
      onClick: () => this.scene.start('MainMenuScene'),
    });
  }
}

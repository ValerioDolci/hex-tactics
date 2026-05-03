import Phaser from 'phaser';
import { TUTORIAL_SCENARIOS, TutorialScenario, allCompleted } from '@data/tutorial';

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

    this.add.rectangle(0, 0, w, h, 0x121821, 1).setOrigin(0, 0);

    // Header
    const headerH = 60;
    this.add.rectangle(0, 0, w, headerH, 0x1c2530, 1).setOrigin(0, 0);
    this.add
      .text(w / 2, headerH / 2, 'Tutorial — Impara hex-tactics passo per passo', {
        fontFamily: 'monospace',
        fontSize: '20px',
        color: '#fff',
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5);

    this.makeBackButton(20, 12);

    // Carica stato completamenti
    const completion = loadCompletion();

    // Layout scenari
    const startY = headerH + 30;
    const itemW = Math.min(680, w - 80);
    const itemH = 70;
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
      const banner = this.add.rectangle(bx, footerY, bannerW, bannerH, 0x2d6a2d, 1).setOrigin(0, 0);
      banner.setStrokeStyle(3, 0x66dd66);
      this.add
        .text(w / 2, footerY + bannerH / 2, '🎉 Tutti gli scenari completati! Sei pronto per la battaglia libera.', {
          fontFamily: 'monospace',
          fontSize: '14px',
          color: '#fff',
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 0.5);
    } else {
      this.add
        .text(w / 2, footerY, 'Completa tutti gli scenari per padroneggiare il gioco.', {
          fontFamily: 'monospace',
          fontSize: '13px',
          color: '#888',
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
    const c = this.add.container(x, y);
    const bgColor = !unlocked ? 0x222222 : completed ? 0x2a4a2a : 0x223344;
    const strokeColor = !unlocked ? 0x444444 : completed ? 0x66aa66 : 0x6699bb;
    const bg = this.add.rectangle(0, 0, w, h, bgColor, 1).setOrigin(0, 0);
    bg.setStrokeStyle(2, strokeColor);

    const titleColor = unlocked ? '#fff' : '#666';
    const title = this.add
      .text(20, 18, scenario.title, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: titleColor,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);

    const descColor = unlocked ? '#aac' : '#555';
    const desc = this.add
      .text(20, 42, scenario.shortDescription, {
        fontFamily: 'monospace',
        fontSize: '12px',
        color: descColor,
      })
      .setOrigin(0, 0);

    const statusText = !unlocked ? '🔒' : completed ? '✓ completato' : 'gioca →';
    const statusColor = !unlocked ? '#666' : completed ? '#9c9' : '#fc6';
    const status = this.add
      .text(w - 20, h / 2, statusText, {
        fontFamily: 'monospace',
        fontSize: '14px',
        color: statusColor,
        fontStyle: 'bold',
      })
      .setOrigin(1, 0.5);

    c.add([bg, title, desc, status]);

    if (unlocked) {
      bg.setInteractive({ useHandCursor: true });
      bg.on('pointerover', () => bg.setFillStyle(completed ? 0x3a5a3a : 0x2c4458));
      bg.on('pointerout', () => bg.setFillStyle(bgColor));
      bg.on('pointerup', () => {
        this.scene.start('BattleScene', { tutorialMode: scenario.id });
      });
    }
  }

  private makeBackButton(x: number, y: number): void {
    const w = 100;
    const h = 36;
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, 0x335577, 1).setOrigin(0, 0);
    bg.setStrokeStyle(2, 0x6699bb);
    const t = this.add
      .text(w / 2, h / 2, '← Indietro', {
        fontFamily: 'monospace',
        fontSize: '13px',
        color: '#fff',
      })
      .setOrigin(0.5, 0.5);
    c.add([bg, t]);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(0x447aaa));
    bg.on('pointerout', () => bg.setFillStyle(0x335577));
    bg.on('pointerup', () => this.scene.start('MainMenuScene'));
  }
}

/**
 * SkirmishSetupScene — build-a-team con budget exp (Phase 1.6 — 2026-05-14).
 *
 * UX:
 *  - 2 colonne (faction A azzurra, B gules) con: budget rimanente, slot delle unit
 *    già selezionate, lista preset disponibili (ognuno con costo).
 *  - Click su preset disponibile (con budget sufficiente) → aggiunto al team.
 *  - Click su unit del team → rimossa, budget rifondato.
 *  - Bottone "Inizia skirmish" → naviga a BattleScene con setup multi-unit.
 *
 * Vincoli MVP:
 *  - Budget default 4000 exp/faction (configurabile da UI? in MVP solo via slider semplice)
 *  - Max 10 unit per faction (target Phase 2)
 *  - Min 1 unit per faction (altrimenti niente da combattere)
 *  - I preset hanno costo fisso (presetCost): 1750-2000 exp ciascuno
 *
 * Estetica: Codex Tacticus (Vellum + Iron). Minimal stagger reveal.
 */
import Phaser from 'phaser';
import { PRESETS, getPreset, presetCost } from '@data/presets';
import { BattleSetup } from '@persistence/storage';
import { paintVellum } from '@ui/Vellum';
import { FONTS, PALETTE, makeCodexButton, factionTincture } from '@ui/theme';
import { FactionId } from '@entities/Unit';

const DEFAULT_BUDGET = 4000;
const MAX_TEAM_SIZE = 10;
const MIN_TEAM_SIZE = 1;

interface FactionTeam {
  faction: FactionId;
  budget: number;
  units: string[]; // preset id, in ordine inserimento
}

export class SkirmishSetupScene extends Phaser.Scene {
  private teamA: FactionTeam = { faction: 'A', budget: DEFAULT_BUDGET, units: [] };
  private teamB: FactionTeam = { faction: 'B', budget: DEFAULT_BUDGET, units: [] };
  private modeA: 'human' | 'ai' = 'human';
  private modeB: 'human' | 'ai' = 'ai';
  private aiLevelA: 'easy' | 'hard' = 'easy';
  private aiLevelB: 'easy' | 'hard' = 'hard';
  private vellumHandle?: ReturnType<typeof paintVellum>;
  /** Rendering tracking per re-render su click */
  private root!: Phaser.GameObjects.Container;

  constructor() {
    super({ key: 'SkirmishSetupScene' });
  }

  create(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.vellumHandle = paintVellum(this, w, h);
    this.root = this.add.container(0, 0);
    this.scale.on('resize', this.onResize, this);
    this.events.on(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', this.onResize, this);
    });
    this.render();
  }

  private onResize(): void {
    const w = this.scale.width;
    const h = this.scale.height;
    this.vellumHandle?.destroy?.();
    this.vellumHandle = paintVellum(this, w, h);
    this.root.destroy(true);
    this.root = this.add.container(0, 0);
    this.render();
  }

  private render(): void {
    this.root.removeAll(true);
    const w = this.scale.width;
    const h = this.scale.height;

    // Titolo
    const title = this.add.text(w / 2, 36, 'Skirmish — costruisci la tua banda', {
      fontFamily: FONTS.display,
      fontSize: '30px',
      color: PALETTE.ink.css,
      fontStyle: 'italic',
    });
    title.setOrigin(0.5, 0);
    this.root.add(title);

    // Sottotitolo budget rules
    const subtitle = this.add.text(
      w / 2,
      72,
      `Budget ${DEFAULT_BUDGET} exp per fazione · Min ${MIN_TEAM_SIZE}, Max ${MAX_TEAM_SIZE} unità`,
      {
        fontFamily: FONTS.body,
        fontSize: '14px',
        color: PALETTE.inkFaded.css,
        fontStyle: 'italic',
      },
    );
    subtitle.setOrigin(0.5, 0);
    this.root.add(subtitle);

    // 2 colonne (A sinistra, B destra)
    const colOffsetX = Math.min(w * 0.24, 280);
    const cx = w / 2;
    const colY = 110;
    this.renderFactionColumn(cx - colOffsetX, colY, this.teamA);
    this.renderFactionColumn(cx + colOffsetX, colY, this.teamB);

    // Bottone Inizia + Back
    const btnY = h - 100;
    const canStart = this.teamA.units.length >= MIN_TEAM_SIZE && this.teamB.units.length >= MIN_TEAM_SIZE;
    const startBtn = makeCodexButton({
      scene: this,
      x: cx,
      y: btnY,
      width: 260,
      height: 56,
      label: canStart ? 'Inizia skirmish' : 'Aggiungi almeno 1 unit per parte',
      variant: 'primary',
      fontKind: 'display',
      fontSize: 20,
      disabled: !canStart,
      onClick: canStart ? () => this.startBattle() : undefined,
    });
    this.root.add(startBtn);

    const backBtn = makeCodexButton({
      scene: this,
      x: 100,
      y: btnY,
      width: 130,
      height: 44,
      label: '← Indietro',
      variant: 'outline',
      fontKind: 'body',
      fontSize: 16,
      onClick: () => this.scene.start('MainMenuScene'),
    });
    this.root.add(backBtn);
  }

  private renderFactionColumn(x: number, y: number, team: FactionTeam): void {
    const tincture = factionTincture(team.faction);
    const colW = 280;
    const spent = team.units.reduce(
      (sum, presetId) => sum + (getPreset(presetId) ? presetCost(getPreset(presetId)!) : 0),
      0,
    );
    const remaining = team.budget - spent;

    // Header faction
    const header = this.add.text(x, y, team.faction === 'A' ? 'Fazione A · azzurra' : 'Fazione B · gules', {
      fontFamily: FONTS.display,
      fontSize: '20px',
      color: tincture.css,
      fontStyle: 'italic',
    });
    header.setOrigin(0.5, 0);
    this.root.add(header);

    // Budget rimanente
    const budgetTxt = this.add.text(x, y + 28, `Speso: ${spent} / ${team.budget}   ·   resta ${remaining}`, {
      fontFamily: FONTS.mono,
      fontSize: '13px',
      color: remaining < 0 ? PALETTE.gules.css : PALETTE.ink.css,
    });
    budgetTxt.setOrigin(0.5, 0);
    this.root.add(budgetTxt);

    // Modalità (human/ai)
    const isFactionA = team.faction === 'A';
    const mode = isFactionA ? this.modeA : this.modeB;
    const aiLevel = isFactionA ? this.aiLevelA : this.aiLevelB;
    const modeLabel = mode === 'human' ? 'Umano' : `AI ${aiLevel}`;
    const modeBtn = makeCodexButton({
      scene: this,
      x,
      y: y + 56,
      width: 200,
      height: 32,
      label: `Modalità: ${modeLabel}`,
      variant: 'outline',
      fontKind: 'body',
      fontSize: 13,
      onClick: () => {
        // Toggle: human → ai easy → ai hard → human
        if (mode === 'human') {
          if (isFactionA) {
            this.modeA = 'ai';
            this.aiLevelA = 'easy';
          } else {
            this.modeB = 'ai';
            this.aiLevelB = 'easy';
          }
        } else if (aiLevel === 'easy') {
          if (isFactionA) this.aiLevelA = 'hard';
          else this.aiLevelB = 'hard';
        } else {
          if (isFactionA) this.modeA = 'human';
          else this.modeB = 'human';
        }
        this.render();
      },
    });
    this.root.add(modeBtn);

    // Lista unit già nel team
    const teamY = y + 100;
    const rowH = 38;
    if (team.units.length === 0) {
      const empty = this.add.text(x, teamY, '(nessuna unit)', {
        fontFamily: FONTS.body,
        fontSize: '13px',
        color: PALETTE.inkFaded.css,
        fontStyle: 'italic',
      });
      empty.setOrigin(0.5, 0);
      this.root.add(empty);
    }
    for (let i = 0; i < team.units.length; i++) {
      const presetId = team.units[i];
      const preset = getPreset(presetId);
      if (!preset) continue;
      const cost = presetCost(preset);
      const rowY = teamY + i * rowH;
      const rowBg = this.add.rectangle(x, rowY, colW, rowH - 4, PALETTE.vellumDark.num, 0.85);
      rowBg.setOrigin(0.5, 0);
      rowBg.setStrokeStyle(1, tincture.num, 0.7);
      const txt = this.add.text(
        x - colW / 2 + 12,
        rowY + 8,
        `${preset.name}  —  ${cost} exp`,
        {
          fontFamily: FONTS.body,
          fontSize: '14px',
          color: PALETTE.ink.css,
        },
      );
      const removeBtn = this.add.text(x + colW / 2 - 12, rowY + 8, '✕', {
        fontFamily: FONTS.display,
        fontSize: '16px',
        color: PALETTE.gules.css,
      });
      removeBtn.setOrigin(1, 0);
      removeBtn.setInteractive({ useHandCursor: true });
      removeBtn.on('pointerdown', () => {
        team.units.splice(i, 1);
        this.render();
      });
      this.root.add([rowBg, txt, removeBtn]);
    }

    // Lista preset disponibili (sotto)
    const presetsY = teamY + team.units.length * rowH + 24;
    const sectionLabel = this.add.text(x, presetsY, 'Aggiungi unit:', {
      fontFamily: FONTS.body,
      fontSize: '14px',
      color: PALETTE.inkSoft.css,
      fontStyle: 'italic',
    });
    sectionLabel.setOrigin(0.5, 0);
    this.root.add(sectionLabel);

    let listY = presetsY + 24;
    for (const preset of PRESETS) {
      const cost = presetCost(preset);
      const canAfford = cost <= remaining && team.units.length < MAX_TEAM_SIZE;
      const labelTxt = `+ ${preset.name}  ·  ${cost} exp`;
      const btn = makeCodexButton({
        scene: this,
        x,
        y: listY,
        width: colW - 20,
        height: 30,
        label: labelTxt,
        variant: 'outline',
        fontKind: 'body',
        fontSize: 13,
        disabled: !canAfford,
        onClick: canAfford
          ? () => {
              team.units.push(preset.id);
              this.render();
            }
          : undefined,
      });
      this.root.add(btn);
      listY += 36;
    }
  }

  private startBattle(): void {
    const setup: BattleSetup = {
      // Compat: presetA/B usati come fallback in BattleScene se skirmish vuoto
      presetA: this.teamA.units[0] ?? 'spadaccino',
      presetB: this.teamB.units[0] ?? 'arciere',
      modeA: this.modeA,
      modeB: this.modeB,
      aiLevelA: this.aiLevelA,
      aiLevelB: this.aiLevelB,
      skirmishA: [...this.teamA.units],
      skirmishB: [...this.teamB.units],
      budgetA: this.teamA.budget,
      budgetB: this.teamB.budget,
    };
    this.scene.start('BattleScene', setup);
  }
}

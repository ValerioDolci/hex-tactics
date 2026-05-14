import Phaser from 'phaser';
import {
  CharacterBuild,
  defaultBuild,
  describeSkill,
  generateBuildId,
  loadAllBuilds,
  saveBuild,
  unitFromBuild,
  validateBuild,
  listAllWeapons,
  listAllShields,
  listAllArmors,
} from '@data/builds';
import { htmlPrompt, htmlAlert } from '@ui/HtmlPrompt';
import { Tooltip } from '@ui/Tooltip';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { getArmor } from '@data/armors';
import {
  AcquiredSkill,
  SkillModifier,
  ActionType,
  computeSkillCost,
  countSpecializations,
} from '@entities/Skill';
import { Stat, EquipCategory } from '@entities/Equipment';
import { paintVellum } from '@/ui/Vellum';
import { FONTS, PALETTE } from '@/ui/theme';

/**
 * Scena Character Builder.
 *
 * Layout:
 *   - Header: titolo + "← Indietro" + "📁 Carica build"
 *   - Sinistra: Equipaggiamento (3 sezioni con bottoni di scelta + preview)
 *   - Destra: Riepilogo (HP/F/A/V, exp spent, validità) + lista skill + bottone "Aggiungi skill"
 *   - Footer: input nome + "Salva" + "Usa per battaglia"
 *
 * Sub-panel modali:
 *   - PickerOverlay: lista di scelte (per equip / lista build / etc.)
 *   - SkillEditorOverlay: editor di una nuova skill
 */
export class CharacterBuilderScene extends Phaser.Scene {
  private build!: CharacterBuild;
  /** Faction destinataria (per torno indietro a MainMenu con la build selezionata) */
  private targetFaction: 'A' | 'B' = 'A';

  private elements: Phaser.GameObjects.GameObject[] = [];

  // Sub-panel state
  private overlay?: Phaser.GameObjects.Container;
  private tooltip?: Tooltip;

  // Editor skill — state persistente attraverso re-render del modale
  private editingSkill: {
    modifier: SkillModifier;
    level: number;
    abilita?: Stat;
    azione?: ActionType;
    classeOggetto?: EquipCategory;
    oggettoSpecifico?: string;
  } | null = null;

  constructor() {
    super({ key: 'CharacterBuilderScene' });
  }

  init(data?: { faction?: 'A' | 'B'; build?: CharacterBuild }): void {
    this.targetFaction = data?.faction ?? 'A';
    this.build = data?.build ? { ...data.build, skills: [...data.build.skills] } : defaultBuild();
  }

  create(): void {
    if (!this.tooltip) this.tooltip = new Tooltip(this);
    // Vellum + grain una tantum (sotto tutto, depth -100). Sopravvive ai renderAll
    // perché this.elements gestisce solo gli elementi del builder.
    paintVellum(this, this.scale.width, this.scale.height);
    // Restart on resize (orientation change su mobile): re-render tutto
    const onResize = () => this.scene.restart();
    this.scale.on('resize', onResize, this);
    this.events.once(Phaser.Scenes.Events.SHUTDOWN, () => {
      this.scale.off('resize', onResize, this);
    });
    this.renderAll();
  }

  /** Helper: descrizione testuale di un'arma/scudo/armatura per i tooltip */
  private describeItemForTooltip(id: string): string {
    const w = getWeapon(id);
    if (w) {
      const lines: string[] = [w.name];
      const m0 = w.attackModes[0];
      lines.push(`ATK: ${m0.diceVariable}d6+${m0.fixedBonus}${w.attackModes.length > 1 ? ' (mode multipli)' : ''}`);
      if (w.parry) lines.push(`Parry: ${w.parry.dice}d6+${w.parry.fixed}`);
      lines.push(`Imp: ${w.impediment}`);
      if (w.range) {
        const rangeStr: string[] = [];
        if (w.range.reach) rangeStr.push(`reach ${w.range.reach} hex`);
        if (w.range.distance) rangeStr.push(`dist ${w.range.distance} hex`);
        if (w.range.throw) rangeStr.push(`lancio ${w.range.throw}`);
        if (w.range.reload) rangeStr.push(`ricarica ${w.range.reload}`);
        if (rangeStr.length) lines.push(rangeStr.join(' · '));
      }
      return lines.join('\n');
    }
    const s = getShield(id);
    if (s) {
      return `${s.name}\nParry: ${s.parry.dice}d6+${s.parry.fixed}\nImp: ${s.impediment}`;
    }
    const a = getArmor(id);
    if (a) {
      return `${a.name}\nRD: ${a.damageReduction}\nImp: ${a.impediment}`;
    }
    return id;
  }

  /** Re-render completo della scena (chiamato dopo ogni modifica). */
  private renderAll(): void {
    // Pulisce tutto
    this.elements.forEach((e) => e.destroy());
    this.elements = [];

    const w = this.scale.width;
    const h = this.scale.height;

    // Header
    this.renderHeader(w);

    // Body: 2 colonne
    const padding = 20;
    const headerH = 60;
    const footerH = 80;
    const bodyTop = headerH + padding;
    const bodyH = h - bodyTop - footerH - padding;
    const colW = (w - padding * 3) / 2;
    const leftX = padding;
    const rightX = padding * 2 + colW;

    this.renderEquipmentColumn(leftX, bodyTop, colW, bodyH);
    this.renderRightColumn(rightX, bodyTop, colW, bodyH);

    // Footer
    this.renderFooter(w, h - footerH - padding);
  }

  // =======================================================================
  // Header
  // =======================================================================

  private renderHeader(w: number): void {
    const headerH = 60;
    const bg = this.add.rectangle(0, 0, w, headerH, PALETTE.vellumDark.num, 1).setOrigin(0, 0);
    bg.setStrokeStyle(2, PALETTE.ink.num);
    this.elements.push(bg);

    const title = this.add
      .text(w / 2, headerH / 2, `Crea personaggio (Fazione ${this.targetFaction})`, {
        fontFamily: FONTS.body,
        fontSize: '20px',
        color: PALETTE.ink.css,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5);
    this.elements.push(title);

    // ← Frontespizio
    this.makeButton(20, 12, 110, 36, '←  Frontespizio', PALETTE.vellumDark.num, () => {
      this.scene.start('MainMenuScene');
    });

    // Carica
    this.makeButton(w - 140, 12, 120, 36, 'Carica', PALETTE.gold.num, () => {
      this.openLoadDialog();
    });
  }

  // =======================================================================
  // Equipment column (left)
  // =======================================================================

  private renderEquipmentColumn(x: number, y: number, w: number, h: number): void {
    const bg = this.add.rectangle(x, y, w, h, PALETTE.vellumDark.num, 1).setOrigin(0, 0);
    bg.setStrokeStyle(1, PALETTE.ink.num);
    this.elements.push(bg);

    const title = this.add
      .text(x + 16, y + 12, 'Equipaggiamento', {
        fontFamily: FONTS.body,
        fontSize: '17px',
        color: PALETTE.goldDeep.css,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    this.elements.push(title);

    let cy = y + 50;
    const innerW = w - 32;

    // Arma principale
    cy = this.renderEquipPicker(
      x + 16,
      cy,
      innerW,
      'Arma principale',
      this.build.weaponId,
      (id) => {
        if (!id) return; // non rimuovibile
        this.build.weaponId = id;
        // Se l'arma è 2h, libera offhand
        const w2 = getWeapon(id);
        if (w2 && /2h/.test(w2.name)) {
          this.build.offhandId = undefined;
        }
        this.renderAll();
      },
      'weapon',
      false,
    );

    cy += 16;

    // Offhand
    cy = this.renderEquipPicker(
      x + 16,
      cy,
      innerW,
      'Offhand',
      this.build.offhandId,
      (id) => {
        this.build.offhandId = id ?? undefined;
        this.renderAll();
      },
      'offhand',
      true,
    );

    cy += 16;

    // Armatura
    cy = this.renderEquipPicker(
      x + 16,
      cy,
      innerW,
      'Armatura',
      this.build.armorId,
      (id) => {
        this.build.armorId = id ?? undefined;
        this.renderAll();
      },
      'armor',
      true,
    );
  }

  private renderEquipPicker(
    x: number,
    y: number,
    w: number,
    label: string,
    currentId: string | undefined,
    onChoose: (id: string | null) => void,
    type: 'weapon' | 'offhand' | 'armor',
    allowEmpty: boolean,
  ): number {
    const lbl = this.add
      .text(x, y, label, {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.inkSoft.css,
      })
      .setOrigin(0, 0);
    this.elements.push(lbl);

    const btnY = y + 20;
    const btnH = 38;
    const c = this.add.container(x, btnY);
    const bg = this.add.rectangle(0, 0, w, btnH, PALETTE.vellumDark.num, 1).setOrigin(0, 0);
    bg.setStrokeStyle(2, PALETTE.ink.num);
    let displayText = '— Nessuno —';
    if (currentId) {
      if (type === 'weapon' || type === 'offhand') {
        const wp = getWeapon(currentId);
        const sh = getShield(currentId);
        displayText = wp?.name ?? sh?.name ?? currentId;
      } else {
        const a = getArmor(currentId);
        displayText = a?.name ?? currentId;
      }
    }
    const t = this.add
      .text(10, btnH / 2, displayText, {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.ink.css,
      })
      .setOrigin(0, 0.5);
    const arrow = this.add
      .text(w - 14, btnH / 2, '▼', {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.inkSoft.css,
      })
      .setOrigin(1, 0.5);
    c.add([bg, t, arrow]);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(PALETTE.vellumDeep.num));
    bg.on('pointerout', () => bg.setFillStyle(PALETTE.vellumDark.num));
    bg.on('pointerup', () => {
      const items: { id: string | null; label: string }[] = [];
      if (allowEmpty) items.push({ id: null, label: '— Nessuno —' });
      if (type === 'weapon') {
        for (const it of listAllWeapons()) items.push({ id: it.id, label: it.name });
      } else if (type === 'offhand') {
        for (const it of listAllWeapons()) items.push({ id: it.id, label: `🗡 ${it.name}` });
        for (const it of listAllShields()) items.push({ id: it.id, label: `🛡 ${it.name}` });
      } else {
        for (const it of listAllArmors()) items.push({ id: it.id, label: it.name });
      }
      this.openPicker(label, items, (id) => onChoose(id));
    });
    this.elements.push(c);

    let descCy = btnY + btnH + 6;
    // Preview
    if (currentId) {
      const lines: string[] = [];
      if (type === 'weapon' || type === 'offhand') {
        const wp = getWeapon(currentId);
        const sh = getShield(currentId);
        if (wp) {
          const m0 = wp.attackModes[0];
          lines.push(`ATK: ${m0.diceVariable}d6 + ${m0.fixedBonus} fissi`);
          if (wp.parry) lines.push(`DIF parry: ${wp.parry.dice}d6 + ${wp.parry.fixed}`);
          lines.push(`IMP: ${wp.impediment}`);
          if (wp.range) {
            const rangeStr: string[] = [];
            if (wp.range.reach) rangeStr.push(`reach ${wp.range.reach}`);
            if (wp.range.distance) rangeStr.push(`distanza ${wp.range.distance}`);
            if (wp.range.throw) rangeStr.push(`lancio ${wp.range.throw}`);
            if (wp.range.reload) rangeStr.push(`ricarica ${wp.range.reload}`);
            if (rangeStr.length) lines.push(rangeStr.join(' · '));
          }
        } else if (sh) {
          lines.push(`Parry: ${sh.parry.dice}d6 + ${sh.parry.fixed}`);
          lines.push(`IMP: ${sh.impediment}`);
        }
      } else {
        const a = getArmor(currentId);
        if (a) {
          lines.push(`RD: ${a.damageReduction}`);
          lines.push(`IMP: ${a.impediment}`);
        }
      }
      const desc = this.add
        .text(x + 8, descCy, lines.join('\n'), {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.inkSoft.css,
          lineSpacing: 3,
        })
        .setOrigin(0, 0);
      this.elements.push(desc);
      descCy += desc.height + 2;
    }

    return descCy;
  }

  // =======================================================================
  // Right column: Skills + Summary
  // =======================================================================

  private renderRightColumn(x: number, y: number, w: number, h: number): void {
    // Summary in alto — altezza dinamica in base ai warnings
    const validation = validateBuild(this.build);
    const baseSummaryH = 200;
    const warningH = validation.warnings.length > 0 ? 22 + validation.warnings.length * 18 + 10 : 0;
    const summaryH = baseSummaryH + warningH;

    const summaryBg = this.add.rectangle(x, y, w, summaryH, PALETTE.vellumDark.num, 1).setOrigin(0, 0);
    summaryBg.setStrokeStyle(1, PALETTE.ink.num);
    this.elements.push(summaryBg);

    const summaryTitle = this.add
      .text(x + 16, y + 12, 'Riepilogo', {
        fontFamily: FONTS.body,
        fontSize: '17px',
        color: PALETTE.goldDeep.css,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    this.elements.push(summaryTitle);

    const summaryLines = this.computeSummaryLines(validation);
    const summaryText = this.add
      .text(x + 16, y + 42, summaryLines.join('\n'), {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.ink.css,
        lineSpacing: 4,
      })
      .setOrigin(0, 0);
    this.elements.push(summaryText);

    // Barra exp
    const barY = y + baseSummaryH - 36;
    const barX = x + 16;
    const barW = w - 32;
    const pct = Math.min(1, validation.totalCost / 2000);
    const barColor = pct < 0.8 ? PALETTE.verde.num : pct <= 1 ? PALETTE.gold.num : PALETTE.gules.num;
    const barBg = this.add.rectangle(barX, barY, barW, 18, PALETTE.vellumDeep.num, 1).setOrigin(0, 0);
    barBg.setStrokeStyle(1, PALETTE.ink.num);
    this.elements.push(barBg);
    if (pct > 0) {
      const fill = this.add.rectangle(barX, barY, barW * pct, 18, barColor, 1).setOrigin(0, 0);
      this.elements.push(fill);
    }

    // Warnings (sotto la barra exp, dentro la stessa box riepilogo)
    if (validation.warnings.length > 0) {
      const warnY = y + baseSummaryH + 4;
      const warnTitle = this.add
        .text(x + 16, warnY, `⚠ Avvisi (${validation.warnings.length})`, {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.gold.css,
          fontStyle: 'bold',
        })
        .setOrigin(0, 0);
      this.elements.push(warnTitle);
      let wcy = warnY + 20;
      for (const wmsg of validation.warnings) {
        const wt = this.add
          .text(x + 16, wcy, '• ' + wmsg, {
            fontFamily: FONTS.body,
            fontSize: '15px',
            color: PALETTE.goldDeep.css,
            wordWrap: { width: w - 32 },
          })
          .setOrigin(0, 0);
        this.elements.push(wt);
        wcy += 18;
      }
    }

    // Skill section
    const skillTop = y + summaryH + 12;
    const skillH = h - summaryH - 12;
    const skillBg = this.add.rectangle(x, skillTop, w, skillH, PALETTE.vellumDark.num, 1).setOrigin(0, 0);
    skillBg.setStrokeStyle(1, PALETTE.ink.num);
    this.elements.push(skillBg);

    const skillTitle = this.add
      .text(x + 16, skillTop + 12, 'Skill acquistate', {
        fontFamily: FONTS.body,
        fontSize: '17px',
        color: PALETTE.goldDeep.css,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    this.elements.push(skillTitle);

    let cy = skillTop + 46;
    if (this.build.skills.length === 0) {
      const emptyT = this.add
        .text(x + 16, cy, 'Nessuna skill. Aggiungine una qui sotto.', {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.inkFaded.css,
          fontStyle: 'italic',
        })
        .setOrigin(0, 0);
      this.elements.push(emptyT);
      cy += 24;
    }
    for (let i = 0; i < this.build.skills.length; i++) {
      const s = this.build.skills[i];
      const desc = describeSkill(s);
      const t = this.add
        .text(x + 16, cy, '• ' + desc, {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.ink.css,
        })
        .setOrigin(0, 0);
      this.elements.push(t);
      // Bottone × per rimuovere
      const removeC = this.add.container(x + w - 36, cy - 2);
      const removeBg = this.add.rectangle(0, 0, 24, 22, PALETTE.gulesWash.num, 1).setOrigin(0, 0);
      removeBg.setStrokeStyle(1, PALETTE.gulesDeep.num);
      const removeT = this.add
        .text(12, 11, '×', {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.ink.css,
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 0.5);
      removeC.add([removeBg, removeT]);
      removeBg.setInteractive({ useHandCursor: true });
      removeBg.on('pointerover', () => removeBg.setFillStyle(PALETTE.gules.num));
      removeBg.on('pointerout', () => removeBg.setFillStyle(PALETTE.gulesWash.num));
      const idx = i;
      removeBg.on('pointerup', () => {
        this.build.skills.splice(idx, 1);
        this.renderAll();
      });
      this.elements.push(removeC);
      cy += 22;
    }

    cy += 12;
    // Bottone aggiungi skill (reset state per nuova skill)
    this.makeButton(x + 16, cy, w - 32, 40, '+  Aggiungi skill', PALETTE.azureWash.num, () => {
      this.openSkillEditor(true);
    });
  }

  private computeSummaryLines(val: ReturnType<typeof validateBuild>): string[] {
    // Calcola impedimento raw e con skill
    let rawImp = 0;
    if (this.build.weaponId) {
      const w = getWeapon(this.build.weaponId);
      if (w) rawImp += w.impediment;
    }
    if (this.build.offhandId) {
      const w = getWeapon(this.build.offhandId);
      const s = getShield(this.build.offhandId);
      rawImp += w?.impediment ?? s?.impediment ?? 0;
    }
    if (this.build.armorId) {
      const a = getArmor(this.build.armorId);
      if (a) rawImp += a.impediment;
    }
    // Imp con skill: simula creando un Unit fittizio
    let withSkillImp = rawImp;
    try {
      const unit = unitFromBuild(this.build, 'A', { q: 0, r: 0 });
      // import getImpedimentTotal
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const stats = require('@core/stats');
      withSkillImp = stats.getImpedimentTotal(unit);
    } catch {
      // ignora — fallback su raw
    }

    const lines: string[] = [
      `HP: 20`,
      `Forza/Agilità/Volontà: 2/2/2`,
      `Impeto base: 14`,
      `Impedimento totale: ${rawImp} (con skill: ${withSkillImp})`,
      ``,
      `Exp spesa: ${val.totalCost} / 2000`,
      val.valid ? '✓ Build valida' : `✗ Invalida: ${val.errors[0] ?? ''}`,
    ];
    return lines;
  }

  // =======================================================================
  // Footer
  // =======================================================================

  private renderFooter(w: number, y: number): void {
    const padding = 20;

    // Input nome (sostituito con un placeholder cliccabile che apre prompt browser)
    const nameLbl = this.add
      .text(padding, y + 4, 'Nome build:', {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.inkSoft.css,
      })
      .setOrigin(0, 0);
    this.elements.push(nameLbl);

    const inputW = 280;
    const inputH = 32;
    const inputY = y + 24;
    const inputC = this.add.container(padding, inputY);
    const inputBg = this.add.rectangle(0, 0, inputW, inputH, PALETTE.vellumDeep.num, 1).setOrigin(0, 0);
    inputBg.setStrokeStyle(2, PALETTE.ink.num);
    const inputT = this.add
      .text(10, inputH / 2, this.build.name || '(clicca per inserire un nome)', {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: this.build.name ? '#fff' : '#778',
      })
      .setOrigin(0, 0.5);
    inputC.add([inputBg, inputT]);
    inputBg.setInteractive({ useHandCursor: true });
    inputBg.on('pointerup', async () => {
      const v = await htmlPrompt({
        title: 'Nome della build',
        default: this.build.name,
        placeholder: 'Es. Tank pesante',
        maxLength: 40,
      });
      if (v !== null) {
        this.build.name = v;
        this.renderAll();
      }
    });
    this.elements.push(inputC);

    // Bottone Salva
    this.makeButton(padding + inputW + 16, inputY, 130, inputH, 'Salva', PALETTE.verde.num, async () => {
      if (!this.build.name) {
        const v = await htmlPrompt({
          title: 'Inserisci un nome per salvare',
          placeholder: 'Es. Tank pesante',
          maxLength: 40,
        });
        if (!v) return;
        this.build.name = v;
      }
      saveBuild({ ...this.build, id: this.build.id ?? generateBuildId() });
      this.renderAll();
      await htmlAlert({ title: 'Salvata', message: `Build "${this.build.name}" salvata.` });
    });

    // Bottone Usa per battaglia
    this.makeButton(w - padding - 240, inputY, 240, inputH, 'Apri il duello con questa build', PALETTE.gold.num, async () => {
      const val = validateBuild(this.build);
      if (!val.valid) {
        await htmlAlert({
          title: 'Build non valida',
          message: val.errors.join('\n'),
        });
        return;
      }
      if (!this.build.name) this.build.name = 'Custom';
      saveBuild(this.build);
      this.scene.start('MainMenuScene', {
        selectCustomBuildFor: this.targetFaction,
        buildId: this.build.id,
      });
    });
  }

  // =======================================================================
  // Helpers
  // =======================================================================

  private makeButton(
    x: number,
    y: number,
    w: number,
    h: number,
    text: string,
    color: number,
    onClick: () => void,
  ): Phaser.GameObjects.Container {
    const c = this.add.container(x, y);
    const bg = this.add.rectangle(0, 0, w, h, color, 1).setOrigin(0, 0);
    bg.setStrokeStyle(2, this.lighten(color));
    const t = this.add
      .text(w / 2, h / 2, text, {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.ink.css,
      })
      .setOrigin(0.5, 0.5);
    c.add([bg, t]);
    bg.setInteractive({ useHandCursor: true });
    bg.on('pointerover', () => bg.setFillStyle(this.lighten(color)));
    bg.on('pointerout', () => bg.setFillStyle(color));
    bg.on('pointerup', () => onClick());
    this.elements.push(c);
    return c;
  }

  private lighten(color: number): number {
    const r = Math.min(255, ((color >> 16) & 0xff) + 30);
    const g = Math.min(255, ((color >> 8) & 0xff) + 30);
    const b = Math.min(255, (color & 0xff) + 30);
    return (r << 16) | (g << 8) | b;
  }

  // =======================================================================
  // Sub-panel: Picker (lista scelte semplici)
  // =======================================================================

  private openPicker(
    title: string,
    items: { id: string | null; label: string }[],
    onChoose: (id: string | null) => void,
  ): void {
    this.closeOverlay();
    const w = this.scale.width;
    const h = this.scale.height;
    const overlayBg = this.add.rectangle(0, 0, w, h, 0x000000, 0.7).setOrigin(0, 0);
    overlayBg.setInteractive(); // blocca click sotto
    overlayBg.setDepth(500);

    const boxW = 480;
    const itemH = 36;
    const headerH = 50;
    const maxItems = Math.min(items.length, Math.floor((h - 200) / itemH));
    const boxH = headerH + maxItems * itemH + 20;
    const bx = w / 2 - boxW / 2;
    const by = h / 2 - boxH / 2;

    this.overlay = this.add.container(0, 0);
    this.overlay.setDepth(501);

    const box = this.add.rectangle(bx, by, boxW, boxH, PALETTE.vellumDark.num, 1).setOrigin(0, 0);
    box.setStrokeStyle(3, PALETTE.ink.num);
    this.overlay.add([overlayBg, box]);

    const headerT = this.add
      .text(bx + boxW / 2, by + headerH / 2, title, {
        fontFamily: FONTS.body,
        fontSize: '16px',
        color: PALETTE.ink.css,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5);
    this.overlay.add(headerT);

    let cy = by + headerH;
    for (const item of items.slice(0, maxItems)) {
      const c = this.add.container(bx + 10, cy);
      const ibg = this.add.rectangle(0, 0, boxW - 20, itemH - 2, PALETTE.vellumDeep.num, 1).setOrigin(0, 0);
      ibg.setStrokeStyle(1, PALETTE.ink.num);
      const it = this.add
        .text(12, itemH / 2 - 1, item.label, {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.ink.css,
          wordWrap: { width: boxW - 50 },
        })
        .setOrigin(0, 0.5);
      c.add([ibg, it]);
      ibg.setInteractive({ useHandCursor: true });
      ibg.on('pointerover', (p: Phaser.Input.Pointer) => {
        ibg.setFillStyle(PALETTE.vellumDeep.num);
        // Tooltip dinamico se l'item è un equip riconoscibile
        if (item.id && this.tooltip) {
          const desc = this.describeItemForTooltip(item.id);
          if (desc !== item.id) this.tooltip.show(p.x, p.y, desc);
        }
      });
      ibg.on('pointermove', (p: Phaser.Input.Pointer) => {
        if (this.tooltip) this.tooltip.move(p.x, p.y);
      });
      ibg.on('pointerout', () => {
        ibg.setFillStyle(PALETTE.vellumDeep.num);
        if (this.tooltip) this.tooltip.hide();
      });
      ibg.on('pointerup', () => {
        if (this.tooltip) this.tooltip.hide();
        this.closeOverlay();
        onChoose(item.id);
      });
      this.overlay.add(c);
      cy += itemH;
    }
  }

  private closeOverlay(): void {
    if (this.overlay) {
      this.overlay.destroy();
      this.overlay = undefined;
    }
  }

  // =======================================================================
  // Sub-panel: Skill Editor
  // =======================================================================

  private openSkillEditor(reset: boolean = false): void {
    this.closeOverlay();
    if (reset || !this.editingSkill) {
      this.editingSkill = {
        modifier: '-1impedimento',
        level: 1,
        abilita: undefined,
        azione: undefined,
        classeOggetto: undefined,
        oggettoSpecifico: undefined,
      };
    }
    const w = this.scale.width;
    const h = this.scale.height;
    const overlayBg = this.add.rectangle(0, 0, w, h, 0x000000, 0.75).setOrigin(0, 0);
    overlayBg.setInteractive();
    overlayBg.setDepth(500);
    this.overlay = this.add.container(0, 0);
    this.overlay.setDepth(501);

    const boxW = 560;
    const boxH = 480;
    const bx = w / 2 - boxW / 2;
    const by = h / 2 - boxH / 2;
    const box = this.add.rectangle(bx, by, boxW, boxH, PALETTE.vellumDark.num, 1).setOrigin(0, 0);
    box.setStrokeStyle(3, PALETTE.ink.num);
    this.overlay.add([overlayBg, box]);

    const title = this.add
      .text(bx + boxW / 2, by + 20, 'Aggiungi skill', {
        fontFamily: FONTS.body,
        fontSize: '18px',
        color: PALETTE.ink.css,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0);
    this.overlay.add(title);

    // State del form: alias verso instance property (sopravvive ai re-render)
    const editing = this.editingSkill!;
    let modifier: SkillModifier = editing.modifier;
    let level = editing.level;
    let abilita: Stat | undefined = editing.abilita;
    let azione: ActionType | undefined = editing.azione;
    let classeOggetto: EquipCategory | undefined = editing.classeOggetto;
    let oggettoSpecifico: string | undefined = editing.oggettoSpecifico;

    const refreshCost = () => {
      const specCount =
        (abilita ? 1 : 0) + (azione ? 1 : 0) + (classeOggetto ? 1 : 0) + (oggettoSpecifico ? 1 : 0);
      const cost = computeSkillCost(modifier, level, specCount);
      costText.setText(`Costo: ${cost} exp`);
      return cost;
    };

    let cy = by + 60;
    const innerX = bx + 24;
    const innerW = boxW - 48;

    // 1. Modificatore
    const labelMod = this.add
      .text(innerX, cy, '1. Modificatore', {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.goldDeep.css,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    this.overlay.add(labelMod);
    cy += 22;
    const modOptions: { id: SkillModifier; label: string }[] = [
      { id: '-1impedimento', label: '−1 impedimento (100/lv1)' },
      { id: '+1tiro', label: '+1 al tiro (600/lv1)' },
      { id: '+1dado', label: '+1 dado (3600/lv1)' },
      { id: '+1dadomax', label: '+1 dado max (1200/lv1)' },
    ];
    const modButtons: { btn: Phaser.GameObjects.Rectangle; id: SkillModifier }[] = [];
    let mx = innerX;
    const modBtnW = (innerW - 12) / 4;
    for (const opt of modOptions) {
      const btnBg = this.add
        .rectangle(mx, cy, modBtnW - 4, 32, opt.id === modifier ? PALETTE.gold.num : PALETTE.vellumDeep.num, 1)
        .setOrigin(0, 0);
      btnBg.setStrokeStyle(2, opt.id === modifier ? PALETTE.gold.num : PALETTE.ink.num);
      const btnT = this.add
        .text(mx + (modBtnW - 4) / 2, cy + 16, opt.label, {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.ink.css,
          align: 'center',
        })
        .setOrigin(0.5, 0.5);
      this.overlay!.add([btnBg, btnT]);
      btnBg.setInteractive({ useHandCursor: true });
      btnBg.on('pointerup', () => {
        modifier = opt.id;
        if (this.editingSkill) this.editingSkill.modifier = modifier;
        for (const mb of modButtons) {
          mb.btn.setFillStyle(mb.id === modifier ? PALETTE.gold.num : PALETTE.vellumDeep.num);
          mb.btn.setStrokeStyle(2, mb.id === modifier ? PALETTE.gold.num : PALETTE.ink.num);
        }
        refreshCost();
      });
      modButtons.push({ btn: btnBg, id: opt.id });
      mx += modBtnW;
    }
    cy += 44;

    // 2. Livello
    const labelLv = this.add
      .text(innerX, cy, '2. Livello', {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.goldDeep.css,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    this.overlay.add(labelLv);
    cy += 22;
    const lvBtns: { btn: Phaser.GameObjects.Rectangle; lv: number }[] = [];
    const lvBtnW = 50;
    let lx = innerX;
    for (let lv = 1; lv <= 6; lv++) {
      const btnBg = this.add
        .rectangle(lx, cy, lvBtnW - 4, 32, lv === level ? PALETTE.gold.num : PALETTE.vellumDeep.num, 1)
        .setOrigin(0, 0);
      btnBg.setStrokeStyle(2, lv === level ? PALETTE.gold.num : PALETTE.ink.num);
      const btnT = this.add
        .text(lx + (lvBtnW - 4) / 2, cy + 16, `${lv}`, {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.ink.css,
          fontStyle: 'bold',
        })
        .setOrigin(0.5, 0.5);
      this.overlay!.add([btnBg, btnT]);
      btnBg.setInteractive({ useHandCursor: true });
      btnBg.on('pointerup', () => {
        level = lv;
        if (this.editingSkill) this.editingSkill.level = level;
        for (const lb of lvBtns) {
          lb.btn.setFillStyle(lb.lv === level ? PALETTE.gold.num : PALETTE.vellumDeep.num);
          lb.btn.setStrokeStyle(2, lb.lv === level ? PALETTE.gold.num : PALETTE.ink.num);
        }
        refreshCost();
      });
      lvBtns.push({ btn: btnBg, lv });
      lx += lvBtnW;
    }
    cy += 44;

    // 3. Specializzazioni
    const labelSpec = this.add
      .text(innerX, cy, '3. Specializzazioni (max 1 per lista, dimezzano il costo)', {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.goldDeep.css,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    this.overlay.add(labelSpec);
    cy += 22;

    const specRowH = 28;
    const labelW = 120;
    const dropdownW = innerW - labelW - 8;

    const makeSpecDropdown = (
      labelText: string,
      currentLabel: string,
      onClick: () => void,
    ): Phaser.GameObjects.Container => {
      const c = this.add.container(innerX, cy);
      const lbl = this.add
        .text(0, specRowH / 2, labelText, {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.inkSoft.css,
        })
        .setOrigin(0, 0.5);
      const ddBg = this.add.rectangle(labelW, 0, dropdownW, specRowH, PALETTE.vellumDeep.num, 1).setOrigin(0, 0);
      ddBg.setStrokeStyle(1, PALETTE.ink.num);
      const ddT = this.add
        .text(labelW + 8, specRowH / 2, currentLabel, {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.ink.css,
        })
        .setOrigin(0, 0.5);
      const arr = this.add
        .text(labelW + dropdownW - 8, specRowH / 2, '▼', {
          fontFamily: FONTS.body,
          fontSize: '15px',
          color: PALETTE.inkSoft.css,
        })
        .setOrigin(1, 0.5);
      c.add([lbl, ddBg, ddT, arr]);
      ddBg.setInteractive({ useHandCursor: true });
      ddBg.on('pointerup', onClick);
      this.overlay!.add(c);
      return c;
    };

    // Helper: aggiorna lo state persistente prima di riaprire l'editor
    const persistAndReopen = () => {
      this.editingSkill = { modifier, level, abilita, azione, classeOggetto, oggettoSpecifico };
      this.openSkillEditor(false);
    };

    // Abilità
    makeSpecDropdown('Abilità:', abilita ?? 'nessuna', () => {
      // Persisto lo state attuale prima di aprire il picker
      this.editingSkill = { modifier, level, abilita, azione, classeOggetto, oggettoSpecifico };
      this.openPicker(
        'Abilità',
        [
          { id: null, label: 'nessuna' },
          { id: 'forza', label: 'forza' },
          { id: 'agilità', label: 'agilità' },
          { id: 'volontà', label: 'volontà' },
        ],
        (id) => {
          abilita = (id as Stat | null) ?? undefined;
          persistAndReopen();
        },
      );
    });
    cy += specRowH + 6;

    makeSpecDropdown('Azione:', azione ?? 'nessuna', () => {
      this.editingSkill = { modifier, level, abilita, azione, classeOggetto, oggettoSpecifico };
      this.openPicker(
        'Azione',
        [
          { id: null, label: 'nessuna' },
          { id: 'attaccare', label: 'attaccare' },
          { id: 'parare', label: 'parare' },
          { id: 'schivare', label: 'schivare' },
          { id: 'slancio', label: 'slancio' },
          { id: 'ricaricare', label: 'ricaricare' },
        ],
        (id) => {
          azione = (id as ActionType | null) ?? undefined;
          persistAndReopen();
        },
      );
    });
    cy += specRowH + 6;

    makeSpecDropdown('Classe oggetto:', classeOggetto ?? 'nessuna', () => {
      this.editingSkill = { modifier, level, abilita, azione, classeOggetto, oggettoSpecifico };
      const opts: { id: string | null; label: string }[] = [
        { id: null, label: 'nessuna' },
        { id: 'pugnali', label: 'pugnali' },
        { id: 'spade', label: 'spade' },
        { id: 'mazze', label: 'mazze' },
        { id: 'asce', label: 'asce' },
        { id: 'lance', label: 'lance' },
        { id: 'archi', label: 'archi' },
        { id: 'balestre', label: 'balestre' },
        { id: 'giavellotti', label: 'giavellotti' },
        { id: 'scudi', label: 'scudi' },
        { id: 'armature', label: 'armature' },
      ];
      this.openPicker('Classe oggetto', opts, (id) => {
        classeOggetto = (id as EquipCategory | null) ?? undefined;
        persistAndReopen();
      });
    });
    cy += specRowH + 6;

    makeSpecDropdown('Oggetto sp.:', oggettoSpecifico ?? 'nessuno', () => {
      this.editingSkill = { modifier, level, abilita, azione, classeOggetto, oggettoSpecifico };
      const opts: { id: string | null; label: string }[] = [{ id: null, label: 'nessuno' }];
      for (const it of listAllWeapons()) opts.push({ id: it.id, label: it.name });
      for (const it of listAllShields()) opts.push({ id: it.id, label: it.name });
      for (const it of listAllArmors()) opts.push({ id: it.id, label: it.name });
      this.openPicker('Oggetto specifico', opts, (id) => {
        oggettoSpecifico = id ?? undefined;
        persistAndReopen();
      });
    });
    cy += specRowH + 16;

    // Costo
    const costText = this.add
      .text(innerX, cy, 'Costo: 100 exp', {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.gold.css,
        fontStyle: 'bold',
      })
      .setOrigin(0, 0);
    this.overlay.add(costText);
    refreshCost();

    cy += 30;

    // Bottoni footer
    const cancelBg = this.add.rectangle(innerX, cy, 110, 36, 0x554433, 1).setOrigin(0, 0);
    cancelBg.setStrokeStyle(2, 0x886633);
    const cancelT = this.add
      .text(innerX + 55, cy + 18, 'Annulla', {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.ink.css,
      })
      .setOrigin(0.5, 0.5);
    this.overlay.add([cancelBg, cancelT]);
    cancelBg.setInteractive({ useHandCursor: true });
    cancelBg.on('pointerup', () => {
      this.editingSkill = null;
      this.closeOverlay();
    });

    const confirmX = innerX + innerW - 130;
    const confirmBg = this.add.rectangle(confirmX, cy, 130, 36, 0x336633, 1).setOrigin(0, 0);
    confirmBg.setStrokeStyle(2, 0x66aa66);
    const confirmT = this.add
      .text(confirmX + 65, cy + 18, 'Conferma', {
        fontFamily: FONTS.body,
        fontSize: '15px',
        color: PALETTE.ink.css,
        fontStyle: 'bold',
      })
      .setOrigin(0.5, 0.5);
    this.overlay.add([confirmBg, confirmT]);
    confirmBg.setInteractive({ useHandCursor: true });
    confirmBg.on('pointerup', () => {
      const skill: Omit<AcquiredSkill, 'id'> = {
        modifier,
        level,
        abilita,
        azione,
        classeOggetto,
        oggettoSpecifico,
        cost: computeSkillCost(modifier, level, countSpecializations({ abilita, azione, classeOggetto, oggettoSpecifico })),
      };
      this.build.skills.push(skill);
      this.editingSkill = null;
      this.closeOverlay();
      this.renderAll();
    });
  }

  // =======================================================================
  // Sub-panel: Load build dialog
  // =======================================================================

  private async openLoadDialog(): Promise<void> {
    const builds = loadAllBuilds();
    if (builds.length === 0) {
      await htmlAlert({
        title: 'Nessuna build',
        message: 'Non hai ancora salvato build. Crea una build e clicca "💾 Salva" per riutilizzarla in futuro.',
      });
      return;
    }
    const items = builds.map((b) => ({
      id: b.id,
      label: `${b.name || '(senza nome)'} — ${b.weaponId}, ${b.skills.length} skill`,
    }));
    items.push({ id: '__cancel__', label: '— Annulla —' });
    this.openPicker('Carica build', items, (id) => {
      if (!id || id === '__cancel__') return;
      const b = builds.find((x) => x.id === id);
      if (!b) return;
      this.build = { ...b, skills: [...b.skills] };
      this.renderAll();
    });
  }
}

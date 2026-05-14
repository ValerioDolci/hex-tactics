/**
 * TeamRosterHUD — pannello compatto con barre HP/slancio di tutte le unit della
 * propria fazione + tutte quelle nemiche. Una colonna per faction.
 *
 * Mostrato in skirmish (>1 unit per faction). In 1v1 può essere nascosto via flag
 * `setVisible(false)`.
 *
 * Layout (entry per unit):
 *   ┌────────────────────────────┐
 *   │ ▼ Spadaccino A1            │   ← caret se unit attiva
 *   │  ▓▓▓▓▓▓▓▓░░ 16/20   sl 12  │
 *   ├────────────────────────────┤
 *   │   Arciere A2               │
 *   │  ▓▓▓▓▓▓░░░░ 12/20    sl 8  │
 *   └────────────────────────────┘
 *
 * Pos: in alto sopra il CombatLog (basso-sinistra) — colonna verticale.
 * Per 2 fazioni mostriamo entrambe affiancate.
 */
import Phaser from 'phaser';
import { GameState } from '@core/state';
import { Unit, FactionId, UnitId } from '@entities/Unit';
import { FONTS, PALETTE, makeCodexPanel, factionTincture } from './theme';

const ROW_H = 38;
const ROW_PADDING = 8;

interface UnitRow {
  bg: Phaser.GameObjects.Rectangle;
  caret: Phaser.GameObjects.Text;
  name: Phaser.GameObjects.Text;
  hpBar: Phaser.GameObjects.Rectangle;
  hpBarFill: Phaser.GameObjects.Rectangle;
  stats: Phaser.GameObjects.Text;
  /** Tutti i game objects della riga, per cleanup */
  all: Phaser.GameObjects.GameObject[];
}

export class TeamRosterHUD {
  private scene: Phaser.Scene;
  private container: Phaser.GameObjects.Container;
  private factionA: FactionId = 'A';
  private factionB: FactionId = 'B';
  private rows: Map<UnitId, UnitRow> = new Map();
  private panelRect: { x: number; y: number; w: number; h: number };

  constructor(scene: Phaser.Scene, x: number, y: number, width = 240) {
    this.scene = scene;
    this.panelRect = { x, y, w: width, h: 80 };
    this.container = scene.add.container(x, y);
    this.container.setScrollFactor(0);
  }

  /** Aggiorna il roster mostrato. Distrugge e ricrea le righe (semplice e affidabile). */
  update(state: GameState, activeUnitId: UnitId | null): void {
    this.clearRows();

    // Raggruppa per faction, in ordine A poi B
    const unitsByFac: Record<FactionId, Unit[]> = {
      A: [],
      B: [],
    };
    for (const u of Object.values(state.units)) {
      unitsByFac[u.faction].push(u);
    }
    // Sort: vive prima dei morti, poi per id stabile
    for (const fac of [this.factionA, this.factionB] as FactionId[]) {
      unitsByFac[fac].sort((a, b) => {
        if (a.alive !== b.alive) return a.alive ? -1 : 1;
        return a.id.localeCompare(b.id);
      });
    }

    let yCursor = 8;
    const W = this.panelRect.w;
    // Header faction A
    yCursor = this.addHeader('La mia squadra', this.factionA, yCursor);
    for (const u of unitsByFac[this.factionA]) {
      yCursor = this.addUnitRow(u, yCursor, u.id === activeUnitId, W);
    }
    // Separatore
    yCursor += 8;
    // Header faction B
    yCursor = this.addHeader('Avversari', this.factionB, yCursor);
    for (const u of unitsByFac[this.factionB]) {
      yCursor = this.addUnitRow(u, yCursor, u.id === activeUnitId, W);
    }

    // Resize pannello bg
    const totalH = yCursor + 8;
    this.panelRect.h = totalH;
    this.rebuildPanelBg();
  }

  private clearRows(): void {
    for (const row of this.rows.values()) {
      for (const o of row.all) o.destroy();
    }
    this.rows.clear();
    // Distrugge eventuali header e bg pannello precedenti
    this.container.removeAll(true);
  }

  private rebuildPanelBg(): void {
    // Ricrea il pannello sotto a tutto
    const panel = makeCodexPanel({
      scene: this.scene,
      x: 0,
      y: 0,
      width: this.panelRect.w,
      height: this.panelRect.h,
      tone: 'vellum',
      alpha: 0.94,
    });
    // Spostiamo gli oggetti precedenti SOPRA il bg → distruggo bg, costruisco bg, poi
    // ri-aggiungo gli oggetti (ma sono già nel container). Approccio: makeCodexPanel
    // restituisce un container — aggiungo i suoi children come primo elemento.
    const panelChildren = panel.container.list.slice();
    panel.container.removeAll(false);
    panel.container.destroy();
    // Aggiungi i panel children all'inizio del container (dietro le righe)
    for (let i = 0; i < panelChildren.length; i++) {
      this.container.addAt(panelChildren[i] as Phaser.GameObjects.GameObject, i);
    }
  }

  private addHeader(text: string, fac: FactionId, y: number): number {
    const tincture = factionTincture(fac);
    const t = this.scene.add.text(12, y, text, {
      fontFamily: FONTS.display,
      fontSize: '14px',
      color: tincture.css,
      fontStyle: 'italic',
    });
    this.container.add(t);
    return y + 22;
  }

  private addUnitRow(unit: Unit, y: number, isActive: boolean, width: number): number {
    const padX = 10;
    const tincture = factionTincture(unit.faction);
    // Sfondo riga (più chiaro se attiva)
    // Bg sfondo riga: oro chiaro (~vellumDark misto gold) se attiva, vellumDark normale altrimenti
    const ACTIVE_BG_NUM = 0xf3e4ba;
    const bg = this.scene.add.rectangle(
      padX,
      y,
      width - 2 * padX,
      ROW_H,
      isActive ? ACTIVE_BG_NUM : PALETTE.vellumDark.num,
      isActive ? 0.85 : 0.55,
    );
    bg.setOrigin(0, 0);
    if (isActive) bg.setStrokeStyle(1.5, PALETTE.goldDeep?.num ?? PALETTE.gold.num, 0.9);
    // Caret se attiva
    const caretText = isActive ? '▶' : '  ';
    const caret = this.scene.add.text(padX + 6, y + 4, caretText, {
      fontFamily: FONTS.body,
      fontSize: '14px',
      color: PALETTE.goldDeep?.css ?? PALETTE.gold.css,
    });
    // Nome
    const nameStyle = unit.alive
      ? { color: PALETTE.ink.css, fontStyle: isActive ? 'bold italic' : 'italic' }
      : { color: PALETTE.inkFaded.css, fontStyle: 'italic' };
    const name = this.scene.add.text(padX + 24, y + 4, unit.name + (unit.alive ? '' : ' †'), {
      fontFamily: FONTS.display,
      fontSize: '14px',
      ...nameStyle,
    });
    // HP bar
    const hpBarW = width - 2 * padX - 130;
    const hpBarX = padX + 6;
    const hpBarY = y + ROW_H - 16;
    const hpBar = this.scene.add.rectangle(hpBarX, hpBarY, hpBarW, 8, PALETTE.inkFaded.num, 0.35);
    hpBar.setOrigin(0, 0);
    const hpRatio = unit.alive ? Math.max(0, unit.hp / Math.max(1, unit.hpMax)) : 0;
    const hpBarFill = this.scene.add.rectangle(hpBarX, hpBarY, hpBarW * hpRatio, 8, tincture.num, 0.95);
    hpBarFill.setOrigin(0, 0);
    // Stats: HP/HP_max  sl X  imp Y
    const statsTxt = unit.alive
      ? `${unit.hp}/${unit.hpMax}  sl ${unit.slancio}  imp ${unit.impeto}`
      : 'caduto';
    const stats = this.scene.add.text(width - padX - 4, hpBarY - 4, statsTxt, {
      fontFamily: FONTS.mono,
      fontSize: '11px',
      color: unit.alive ? PALETTE.ink.css : PALETTE.inkFaded.css,
    });
    stats.setOrigin(1, 0);

    const all = [bg, caret, name, hpBar, hpBarFill, stats];
    for (const o of all) this.container.add(o);
    this.rows.set(unit.id, { bg, caret, name, hpBar, hpBarFill, stats, all });
    return y + ROW_H + ROW_PADDING;
  }

  setPosition(x: number, y: number): void {
    this.container.setPosition(x, y);
    this.panelRect.x = x;
    this.panelRect.y = y;
  }

  setVisible(v: boolean): void {
    this.container.setVisible(v);
  }

  destroy(): void {
    this.container.destroy();
  }
}

import Phaser from 'phaser';
import { Unit } from '@entities/Unit';
import { axialToPixel, Pixel, Axial } from '@core/hex/coords';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';
import { FONTS, PALETTE, factionTincture } from '@/ui/theme';

// Tinture araldiche: la fonte di verità è theme.factionTincture() — usata dal redraw().

/**
 * Rendering di una unità: silhouette colorata sulla basetta + simbolo arma
 * (riconoscibile a colpo d'occhio) + label nome/HP.
 *
 * Disegno procedurale (Phaser graphics) — nessun asset esterno.
 *
 * Animazioni:
 *  - `tweenTo(newAxial)`: anima la transizione tra posizioni (no teleport).
 *  - `flashHit / showDamage / showMiss`: feedback visivi su eventi combat.
 */
export class UnitSprite {
  private graphics: Phaser.GameObjects.Graphics;
  private label: Phaser.GameObjects.Text;
  private hpText: Phaser.GameObjects.Text;
  private hexSize: number;
  private origin: Pixel;
  private currentUnit: Unit;
  /** Posizione attualmente disegnata (può differire da unit.position durante un tween) */
  private displayedPosition: Axial;
  /** Cerchio dorato pulsante per highlight unit attiva (turno corrente) */
  private activeHighlight?: Phaser.GameObjects.Graphics;
  private activeTween?: Phaser.Tweens.Tween;
  private isActive = false;

  constructor(scene: Phaser.Scene, unit: Unit, hexSize: number, origin: Pixel) {
    this.hexSize = hexSize;
    this.origin = origin;
    this.currentUnit = unit;
    this.displayedPosition = unit.position;

    this.graphics = scene.add.graphics();
    // Nome unità: ink scuro contornato pesantemente da vellum cream, così
    // si stacca dal fondo qualunque esso sia (vellum della scena O scudo araldico).
    this.label = scene.add.text(0, 0, unit.name, {
      fontFamily: FONTS.display,
      fontSize: '16px',
      color: PALETTE.ink.css,
      fontStyle: 'italic bold',
      stroke: PALETTE.vellum.css,
      strokeThickness: 5,
    });
    this.label.setOrigin(0.5, 1);
    this.hpText = scene.add.text(0, 0, '', {
      fontFamily: FONTS.mono,
      fontSize: '13px',
      color: PALETTE.ink.css,
      fontStyle: 'bold',
      stroke: PALETTE.vellum.css,
      strokeThickness: 4,
    });
    this.hpText.setOrigin(0.5, 0);
    this.update(unit);
  }

  /**
   * Aggiorna il rendering. Se la posizione interna `displayedPosition` differisce da
   * `unit.position`, NON la sovrascrive (il caller userà `tweenTo` per gestire la transizione).
   */
  update(unit: Unit): void {
    this.currentUnit = unit;
    this.redraw();
  }

  /**
   * Re-disegna usando `displayedPosition` come centro.
   *
   * Codex Tacticus: l'unità è uno **scudo araldico (heater shape)** con tintura
   * di fazione (azure/gules), bordo inchiostro caldo, e glifo arma centrale.
   * Sotto lo scudo, una serie di **tacche d'inchiostro** rappresenta gli HP
   * (filled = HP attivi, faded = HP persi).
   */
  private redraw(): void {
    const unit = this.currentUnit;
    this.graphics.clear();
    if (!unit.alive) {
      this.label.setVisible(false);
      this.hpText.setVisible(false);
      return;
    }

    const center = axialToPixel(this.displayedPosition, this.hexSize, this.origin);
    const tincture = factionTincture(unit.faction);

    // ── Wash heraldico sull'esagono di base (sotto lo scudo, leggero alone)
    this.graphics.fillStyle(tincture.wash, 0.18);
    this.graphics.fillCircle(center.x, center.y, this.hexSize * 1.45);

    // ── Scudo araldico (heater shape): polygon procedurale
    this.drawHeaterShield(center.x, center.y, tincture.num);

    // ── Glifo arma al centro dello scudo
    this.drawWeaponSymbol(center.x, center.y);

    // ── Stance difensiva: doppio bordo oro attorno allo scudo
    if (unit.defensiveStance) {
      this.graphics.lineStyle(2, PALETTE.gold.num, 0.95);
      this.drawHeaterShieldOutline(center.x, center.y, this.hexSize * 1.18);
      this.graphics.lineStyle(1, PALETTE.goldLeaf.num, 0.7);
      this.drawHeaterShieldOutline(center.x, center.y, this.hexSize * 1.32);
    }

    // ── Highlight unità attiva (turno corrente)
    if (this.activeHighlight && this.isActive) {
      this.activeHighlight.clear();
      this.activeHighlight.lineStyle(2, PALETTE.gold.num, 0.95);
      const r = this.hexSize * 1.55;
      // Aureola circolare attorno alla basetta (non scudo, per stacco visivo)
      this.activeHighlight.strokeCircle(center.x, center.y, r);
      this.activeHighlight.lineStyle(1, PALETTE.goldLeaf.num, 0.55);
      this.activeHighlight.strokeCircle(center.x, center.y, r + 4);
    }

    // ── Label nome (display serif italic, nero su vellum)
    this.label.setPosition(center.x, center.y - this.hexSize * 1.55);
    const nameSuffix = unit.defensiveStance ? ' ◇' : '';
    this.label.setText(unit.name + nameSuffix);
    this.label.setVisible(true);

    // ── Tacche HP: 10 marker, ciascuno = hpMax/10 HP (con sfondo vellum)
    this.drawHpTallies(center.x, center.y + this.hexSize * 1.0, unit.hp, unit.hpMax);

    // ── Stat compatto sotto: imp / sl in mono ink (più sotto per non collidere con tacche)
    this.hpText.setPosition(center.x, center.y + this.hexSize * 1.55);
    this.hpText.setText(
      `${unit.hp}/${unit.hpMax}  ·  imp ${unit.impeto}  ·  sl ${unit.slancio}`,
    );
    this.hpText.setVisible(true);
  }

  /** Polygon araldico "heater shield". Riempie con `tincture` + bordo ink. */
  private drawHeaterShield(cx: number, cy: number, tincture: number): void {
    const w = this.hexSize * 1.2;
    const h = this.hexSize * 1.5;
    const points = this.heaterShieldPoints(cx, cy, w, h);

    // Riempimento tincture (saturo)
    this.graphics.fillStyle(tincture, 1);
    this.graphics.fillPoints(points, true);

    // Bordo doppio: ink esterno (1.5px) + ink soft interno (per effetto rilievo)
    this.graphics.lineStyle(1.5, PALETTE.ink.num, 0.95);
    this.graphics.strokePoints(points, true);
    // Reflesso luce: highlight chiaro sul bordo superiore-sinistro
    const halfPts = points.slice(0, 5); // top-left → top-right → curva destra parziale
    this.graphics.lineStyle(0.8, PALETTE.vellum.num, 0.35);
    this.graphics.strokePoints(halfPts, false);
  }

  /** Outline-only (per stance halo). */
  private drawHeaterShieldOutline(cx: number, cy: number, scale: number): void {
    const w = this.hexSize * 1.2 * scale;
    const h = this.hexSize * 1.5 * scale;
    const points = this.heaterShieldPoints(cx, cy, w, h);
    this.graphics.strokePoints(points, true);
  }

  /**
   * Genera i vertici dello scudo araldico "heater" (Spagna, XIII-XV sec.):
   * top piatto, lati che curvano leggermente, punto al centro-basso.
   * Bounding box w × h, centro su (cx, cy).
   */
  private heaterShieldPoints(
    cx: number,
    cy: number,
    w: number,
    h: number,
  ): { x: number; y: number }[] {
    const half = w / 2;
    const top = cy - h * 0.4;
    const bot = cy + h * 0.6;
    // 14 vertici: top edge + curva destra (5 pti) + punto + curva sinistra (5 pti)
    const pts: { x: number; y: number }[] = [
      { x: cx - half, y: top },
      { x: cx + half, y: top },
    ];
    // Curva destra: parametrica da (cx+half, top) a (cx, bot)
    for (let i = 1; i <= 5; i++) {
      const t = i / 5;
      // Bezier-like quadratic: (1-t)^2 * P0 + 2(1-t)t * P1 + t^2 * P2
      const p0x = cx + half;
      const p0y = top;
      const p1x = cx + half * 1.05;
      const p1y = cy + h * 0.05;
      const p2x = cx;
      const p2y = bot;
      const x = (1 - t) ** 2 * p0x + 2 * (1 - t) * t * p1x + t ** 2 * p2x;
      const y = (1 - t) ** 2 * p0y + 2 * (1 - t) * t * p1y + t ** 2 * p2y;
      pts.push({ x, y });
    }
    // Curva sinistra (mirror)
    for (let i = 1; i <= 5; i++) {
      const t = i / 5;
      const p0x = cx;
      const p0y = bot;
      const p1x = cx - half * 1.05;
      const p1y = cy + h * 0.05;
      const p2x = cx - half;
      const p2y = top;
      const x = (1 - t) ** 2 * p0x + 2 * (1 - t) * t * p1x + t ** 2 * p2x;
      const y = (1 - t) ** 2 * p0y + 2 * (1 - t) * t * p1y + t ** 2 * p2y;
      pts.push({ x, y });
    }
    return pts;
  }

  /**
   * Disegna 10 tacche d'inchiostro orizzontali rappresentando gli HP.
   * filled = HP attivi (ink pieno), unfilled = HP persi (ink faded outline).
   */
  private drawHpTallies(cx: number, cy: number, hp: number, hpMax: number): void {
    const slots = 10;
    const ratio = Math.max(0, Math.min(1, hp / hpMax));
    const filled = Math.round(slots * ratio);
    const tickW = 3;
    const tickH = 10;
    const gap = 3;
    const totalW = slots * tickW + (slots - 1) * gap;
    const startX = cx - totalW / 2;
    // Sfondo vellum sotto le tacche (per contrasto su scudo o su deploy zone)
    this.graphics.fillStyle(PALETTE.vellum.num, 0.85);
    this.graphics.fillRect(startX - 4, cy - tickH / 2 - 2, totalW + 8, tickH + 4);
    this.graphics.lineStyle(0.8, PALETTE.ink.num, 0.55);
    this.graphics.strokeRect(startX - 4, cy - tickH / 2 - 2, totalW + 8, tickH + 4);
    for (let i = 0; i < slots; i++) {
      const x = startX + i * (tickW + gap);
      if (i < filled) {
        this.graphics.fillStyle(PALETTE.ink.num, 1);
        this.graphics.fillRect(x, cy - tickH / 2, tickW, tickH);
      } else {
        // Persi: outline svanito (effetto "tacca cancellata")
        this.graphics.lineStyle(1, PALETTE.inkFaded.num, 0.7);
        this.graphics.strokeRect(x + 0.5, cy - tickH / 2 + 0.5, tickW - 1, tickH - 1);
      }
    }
  }

  /**
   * Disegna un simbolo procedurale per riconoscere l'arma equipaggiata:
   *  - spada/spada lunga: linea verticale + crocera
   *  - mazza: cerchio grosso in cima a un'asta
   *  - ascia: lama trapezoidale
   *  - lancia: punta triangolare + asta lunga
   *  - arco: arco curvo + freccia
   *  - balestra: cassa rettangolare orizzontale + arco corto
   *  - pugnale: piccola lama corta
   *  - giavellotto: linea diagonale corta
   *  - scudo: esagono / forma di scudo
   */
  private drawWeaponSymbol(cx: number, cy: number): void {
    const unit = this.currentUnit;
    const w = unit.weapon ? getWeapon(unit.weapon) : null;
    const s = unit.offhand ? getShield(unit.offhand) : null;
    const hexSize = this.hexSize;

    // Codex Tacticus: glifo arma in vellum (chiaro) + ink soft per ombre →
    // letto come "araldica chiara su tintura saturata".
    const dark = PALETTE.ink.num;
    const light = PALETTE.vellum.num;

    if (!w) {
      // Nessuna arma: disegna i pugni
      this.graphics.fillStyle(light, 1);
      this.graphics.fillCircle(cx - hexSize * 0.25, cy + hexSize * 0.1, hexSize * 0.12);
      this.graphics.fillCircle(cx + hexSize * 0.25, cy + hexSize * 0.1, hexSize * 0.12);
      return;
    }

    const cat = w.category;
    if (cat === 'spade') {
      // Spada: lama verticale + crocera + pomello
      this.graphics.fillStyle(light, 1);
      this.graphics.fillRect(cx - hexSize * 0.05, cy - hexSize * 0.55, hexSize * 0.1, hexSize * 0.65);
      this.graphics.lineStyle(2, dark, 1);
      this.graphics.strokeRect(cx - hexSize * 0.05, cy - hexSize * 0.55, hexSize * 0.1, hexSize * 0.65);
      // Crocera
      this.graphics.fillStyle(dark, 1);
      this.graphics.fillRect(cx - hexSize * 0.25, cy + hexSize * 0.1, hexSize * 0.5, hexSize * 0.08);
      // Pomello
      this.graphics.fillStyle(dark, 1);
      this.graphics.fillCircle(cx, cy + hexSize * 0.25, hexSize * 0.08);
    } else if (cat === 'mazze') {
      // Mazza: testa rotonda + manico
      this.graphics.fillStyle(dark, 1);
      this.graphics.fillRect(cx - hexSize * 0.04, cy - hexSize * 0.1, hexSize * 0.08, hexSize * 0.45);
      this.graphics.fillStyle(light, 1);
      this.graphics.fillCircle(cx, cy - hexSize * 0.25, hexSize * 0.18);
      this.graphics.lineStyle(2, dark, 1);
      this.graphics.strokeCircle(cx, cy - hexSize * 0.25, hexSize * 0.18);
    } else if (cat === 'asce') {
      // Ascia: testa trapezoidale + manico
      this.graphics.fillStyle(dark, 1);
      this.graphics.fillRect(cx - hexSize * 0.04, cy - hexSize * 0.4, hexSize * 0.08, hexSize * 0.7);
      this.graphics.fillStyle(light, 1);
      const xs = [cx - hexSize * 0.05, cx + hexSize * 0.3, cx + hexSize * 0.35, cx - hexSize * 0.05];
      const ys = [cy - hexSize * 0.4, cy - hexSize * 0.5, cy - hexSize * 0.15, cy - hexSize * 0.05];
      this.graphics.fillPoints(
        xs.map((x, i) => ({ x, y: ys[i] })) as { x: number; y: number }[],
        true,
      );
      this.graphics.lineStyle(2, dark, 1);
      this.graphics.strokePoints(
        xs.map((x, i) => ({ x, y: ys[i] })) as { x: number; y: number }[],
        true,
      );
    } else if (cat === 'lance') {
      // Lancia: punta triangolare + asta lunga
      this.graphics.fillStyle(dark, 1);
      this.graphics.fillRect(cx - hexSize * 0.03, cy - hexSize * 0.4, hexSize * 0.06, hexSize * 0.85);
      this.graphics.fillStyle(light, 1);
      this.graphics.fillTriangle(
        cx - hexSize * 0.13,
        cy - hexSize * 0.4,
        cx + hexSize * 0.13,
        cy - hexSize * 0.4,
        cx,
        cy - hexSize * 0.65,
      );
      this.graphics.lineStyle(2, dark, 1);
      this.graphics.strokeTriangle(
        cx - hexSize * 0.13,
        cy - hexSize * 0.4,
        cx + hexSize * 0.13,
        cy - hexSize * 0.4,
        cx,
        cy - hexSize * 0.65,
      );
    } else if (cat === 'archi') {
      // Arco: curva + freccia orizzontale
      this.graphics.lineStyle(3, light, 1);
      this.graphics.beginPath();
      this.graphics.arc(cx + hexSize * 0.2, cy, hexSize * 0.45, Math.PI * 0.65, Math.PI * 1.35);
      this.graphics.strokePath();
      // Corda
      this.graphics.lineStyle(1, dark, 1);
      this.graphics.lineBetween(
        cx + hexSize * 0.2 + Math.cos(Math.PI * 0.65) * hexSize * 0.45,
        cy + Math.sin(Math.PI * 0.65) * hexSize * 0.45,
        cx + hexSize * 0.2 + Math.cos(Math.PI * 1.35) * hexSize * 0.45,
        cy + Math.sin(Math.PI * 1.35) * hexSize * 0.45,
      );
      // Freccia
      this.graphics.lineStyle(2, dark, 1);
      this.graphics.lineBetween(cx - hexSize * 0.4, cy, cx + hexSize * 0.1, cy);
    } else if (cat === 'balestre') {
      // Balestra: cassa orizzontale + arco corto
      this.graphics.fillStyle(dark, 1);
      this.graphics.fillRect(cx - hexSize * 0.4, cy - hexSize * 0.05, hexSize * 0.7, hexSize * 0.1);
      this.graphics.lineStyle(2, light, 1);
      this.graphics.beginPath();
      this.graphics.arc(cx + hexSize * 0.05, cy, hexSize * 0.3, Math.PI * 0.6, Math.PI * 1.4);
      this.graphics.strokePath();
    } else if (cat === 'pugnali') {
      // Pugnale: piccola lama
      this.graphics.fillStyle(light, 1);
      this.graphics.fillRect(cx - hexSize * 0.04, cy - hexSize * 0.25, hexSize * 0.08, hexSize * 0.4);
      this.graphics.lineStyle(1, dark, 1);
      this.graphics.strokeRect(cx - hexSize * 0.04, cy - hexSize * 0.25, hexSize * 0.08, hexSize * 0.4);
      this.graphics.fillStyle(dark, 1);
      this.graphics.fillRect(cx - hexSize * 0.15, cy + hexSize * 0.1, hexSize * 0.3, hexSize * 0.05);
    } else if (cat === 'giavellotti') {
      // Giavellotto: lancia sottile diagonale
      this.graphics.lineStyle(3, light, 1);
      this.graphics.lineBetween(
        cx - hexSize * 0.4,
        cy + hexSize * 0.3,
        cx + hexSize * 0.4,
        cy - hexSize * 0.4,
      );
      this.graphics.fillStyle(light, 1);
      this.graphics.fillTriangle(
        cx + hexSize * 0.4,
        cy - hexSize * 0.4,
        cx + hexSize * 0.25,
        cy - hexSize * 0.25,
        cx + hexSize * 0.5,
        cy - hexSize * 0.2,
      );
    }

    // Scudo offhand (per chi ha shield in offhand): disco con borchia oro,
    // disegnato in alto-destra dello scudo principale per evitare overlap col glifo.
    if (s) {
      const sx = cx + hexSize * 0.5;
      const sy = cy - hexSize * 0.3;
      const r = hexSize * 0.22;
      this.graphics.fillStyle(PALETTE.inkSoft.num, 1);
      this.graphics.fillCircle(sx, sy, r);
      this.graphics.lineStyle(1, PALETTE.ink.num, 1);
      this.graphics.strokeCircle(sx, sy, r);
      // Borchia centrale gold
      this.graphics.fillStyle(PALETTE.gold.num, 1);
      this.graphics.fillCircle(sx, sy, r * 0.42);
    }
  }

  /**
   * Anima il movimento dell'unità tra `displayedPosition` e una nuova posizione axial.
   * Durata proporzionale alla distanza (più hex = più tempo, ma con cap).
   * Restituisce una Promise che si risolve a fine animazione.
   */
  tweenTo(scene: Phaser.Scene, newPos: Axial, durationPerHex = 180, maxDuration = 600): Promise<void> {
    return new Promise((resolve) => {
      const dq = newPos.q - this.displayedPosition.q;
      const dr = newPos.r - this.displayedPosition.r;
      const dist = Math.max(Math.abs(dq), Math.abs(dr), Math.abs(dq + dr));
      if (dist === 0) {
        this.displayedPosition = newPos;
        this.redraw();
        resolve();
        return;
      }
      const duration = Math.min(maxDuration, dist * durationPerHex);
      const startPos = { ...this.displayedPosition };
      const obj = { t: 0 };
      scene.tweens.add({
        targets: obj,
        t: 1,
        duration,
        ease: 'Sine.easeInOut',
        onUpdate: () => {
          this.displayedPosition = {
            q: startPos.q + (newPos.q - startPos.q) * obj.t,
            r: startPos.r + (newPos.r - startPos.r) * obj.t,
          };
          this.redraw();
        },
        onComplete: () => {
          this.displayedPosition = newPos;
          this.redraw();
          resolve();
        },
      });
    });
  }

  /** Flash visivo quando l'unità è colpita (oro per "colpo registrato"). */
  flashHit(scene: Phaser.Scene): void {
    const center = axialToPixel(this.displayedPosition, this.hexSize, this.origin);
    const flash = scene.add.graphics();
    flash.fillStyle(PALETTE.goldLeaf.num, 0.6);
    flash.fillCircle(center.x, center.y, this.hexSize * 1.6);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 400,
      onComplete: () => flash.destroy(),
    });
  }

  /** Numero danni fluttuante (grosso, scala in poi sale e svanisce) */
  showDamage(scene: Phaser.Scene, dmg: number): void {
    const center = axialToPixel(this.displayedPosition, this.hexSize, this.origin);
    const t = scene.add.text(center.x, center.y - this.hexSize * 0.5, `−${dmg}`, {
      fontFamily: FONTS.display,
      fontSize: '34px',
      color: PALETTE.gules.css,
      stroke: PALETTE.vellum.css,
      strokeThickness: 5,
      fontStyle: 'bold italic',
    });
    t.setOrigin(0.5, 0.5);
    t.setScale(0.3);
    // Fase 1: pop-in con scale dramatic. Fase 2: hold + drift up + fade (più lungo per leggibilità).
    scene.tweens.add({
      targets: t,
      scale: 1.0,
      duration: 200,
      ease: 'Back.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: t,
          y: center.y - this.hexSize * 2.8,
          alpha: 0,
          duration: 1700,
          delay: 250, // hold ben visibile prima di iniziare il drift
          onComplete: () => t.destroy(),
        });
      },
    });
  }

  /** Testo "MISS / PARATO / SCHIVATO" fluttuante (per attacchi falliti). */
  showText(scene: Phaser.Scene, text: string, color: string = PALETTE.gold.css): void {
    const center = axialToPixel(this.displayedPosition, this.hexSize, this.origin);
    const t = scene.add.text(center.x, center.y - this.hexSize * 0.5, text, {
      fontFamily: FONTS.display,
      fontSize: '22px',
      color,
      stroke: PALETTE.vellum.css,
      strokeThickness: 4,
      fontStyle: 'bold italic',
    });
    t.setOrigin(0.5, 0.5);
    t.setScale(0.4);
    scene.tweens.add({
      targets: t,
      scale: 1.0,
      duration: 200,
      ease: 'Back.easeOut',
      onComplete: () => {
        scene.tweens.add({
          targets: t,
          y: center.y - this.hexSize * 2.5,
          alpha: 0,
          duration: 1700,
          delay: 250,
          onComplete: () => t.destroy(),
        });
      },
    });
  }

  /** Popup variazione slancio: "+3 sl" verderame / "−2 sl" gules. */
  showSlancioChange(scene: Phaser.Scene, delta: number): void {
    if (delta === 0) return;
    const center = axialToPixel(this.displayedPosition, this.hexSize, this.origin);
    const sign = delta > 0 ? '+' : '−';
    const color = delta > 0 ? PALETTE.verde.css : PALETTE.gules.css;
    const t = scene.add.text(
      center.x + this.hexSize * 1.4,
      center.y,
      `${sign}${Math.abs(delta)} sl`,
      {
        fontFamily: FONTS.mono,
        fontSize: '17px',
        color,
        stroke: PALETTE.vellum.css,
        strokeThickness: 4,
        fontStyle: 'bold',
      },
    );
    t.setOrigin(0, 0.5);
    t.setAlpha(0);
    scene.tweens.add({
      targets: t,
      alpha: 1,
      x: center.x + this.hexSize * 2.0,
      duration: 250,
      onComplete: () => {
        scene.tweens.add({
          targets: t,
          alpha: 0,
          x: center.x + this.hexSize * 2.6,
          duration: 1300,
          delay: 350, // hold per leggere il valore prima del fade
          onComplete: () => t.destroy(),
        });
      },
    });
  }

  /**
   * Animazione morte: il sprite ruota e svanisce (fade alpha + scale up).
   * Restituisce una Promise che si risolve a fine animazione.
   * Lascia poi il sprite in stato "alive=false" → next redraw lo nasconde.
   */
  playDeathAnimation(scene: Phaser.Scene): Promise<void> {
    return new Promise((resolve) => {
      // Anima graphics + label + hpText insieme
      const targets = [this.graphics, this.label, this.hpText];
      scene.tweens.add({
        targets,
        alpha: 0,
        scale: 1.4,
        angle: 90,
        duration: 700,
        ease: 'Cubic.easeIn',
        onComplete: () => {
          // Reset trasformi (li nascondiamo via redraw quando alive=false)
          for (const t of targets) {
            t.setAlpha(1);
            (t as Phaser.GameObjects.Text).setScale?.(1);
            (t as Phaser.GameObjects.Text).setAngle?.(0);
          }
          resolve();
        },
      });
    });
  }

  /** Centro pixel (per disegnare effetti esterni come linea attacco). */
  getCenter(): Pixel {
    return axialToPixel(this.displayedPosition, this.hexSize, this.origin);
  }

  /**
   * Highlight unità attiva (turno corrente): cerchio dorato pulsante attorno
   * alla basetta. Usato in BattleScene.refreshUI per evidenziare chi gioca.
   */
  setActive(scene: Phaser.Scene, active: boolean): void {
    if (active === this.isActive) return;
    this.isActive = active;
    if (active) {
      if (!this.activeHighlight) {
        this.activeHighlight = scene.add.graphics();
      }
      this.redraw();
      // Tween pulse alpha 0.4 ↔ 0.95 in loop
      this.activeTween = scene.tweens.add({
        targets: this.activeHighlight,
        alpha: { from: 0.4, to: 0.95 },
        duration: 700,
        yoyo: true,
        repeat: -1,
      });
    } else {
      this.activeTween?.stop();
      this.activeTween = undefined;
      this.activeHighlight?.destroy();
      this.activeHighlight = undefined;
      this.redraw();
    }
  }

  destroy(): void {
    this.activeTween?.stop();
    this.activeHighlight?.destroy();
    this.graphics.destroy();
    this.label.destroy();
    this.hpText.destroy();
  }
}

import Phaser from 'phaser';
import { Unit } from '@entities/Unit';
import { axialToPixel, Pixel, Axial } from '@core/hex/coords';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';

const FACTION_COLOR = {
  A: 0x4ab0ff,
  B: 0xff5050,
} as const;

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

  constructor(scene: Phaser.Scene, unit: Unit, hexSize: number, origin: Pixel) {
    this.hexSize = hexSize;
    this.origin = origin;
    this.currentUnit = unit;
    this.displayedPosition = unit.position;

    this.graphics = scene.add.graphics();
    this.label = scene.add.text(0, 0, unit.name, {
      fontFamily: 'monospace',
      fontSize: '13px',
      color: '#fff',
      stroke: '#000',
      strokeThickness: 3,
    });
    this.label.setOrigin(0.5, 1);
    this.hpText = scene.add.text(0, 0, '', {
      fontFamily: 'monospace',
      fontSize: '11px',
      color: '#fff',
      stroke: '#000',
      strokeThickness: 3,
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

  /** Re-disegna usando `displayedPosition` come centro (non `unit.position`). */
  private redraw(): void {
    const unit = this.currentUnit;
    this.graphics.clear();
    if (!unit.alive) {
      this.label.setVisible(false);
      this.hpText.setVisible(false);
      return;
    }

    const center = axialToPixel(this.displayedPosition, this.hexSize, this.origin);
    const factionColor = FACTION_COLOR[unit.faction];

    // Basetta: cerchio grande con bordo
    this.graphics.lineStyle(3, 0x000000, 0.8);
    this.graphics.fillStyle(factionColor, 0.4);
    this.graphics.fillCircle(center.x, center.y, this.hexSize * 1.6);
    this.graphics.strokeCircle(center.x, center.y, this.hexSize * 1.6);

    // Corpo unità (cerchio interno)
    this.graphics.fillStyle(factionColor, 1);
    this.graphics.fillCircle(center.x, center.y, this.hexSize * 0.7);
    this.graphics.lineStyle(2, 0x000000, 1);
    this.graphics.strokeCircle(center.x, center.y, this.hexSize * 0.7);

    // Simbolo arma per riconoscere il tipo a colpo d'occhio
    this.drawWeaponSymbol(center.x, center.y);

    // Anello dorato per posizione difensiva
    if (unit.defensiveStance) {
      this.graphics.lineStyle(4, 0xffcc33, 0.9);
      this.graphics.strokeCircle(center.x, center.y, this.hexSize * 1.85);
    }

    // Label e HP
    this.label.setPosition(center.x, center.y - this.hexSize * 1.7);
    const nameSuffix = unit.defensiveStance ? ' 🛡' : '';
    this.label.setText(unit.name + nameSuffix);
    this.label.setVisible(true);

    this.hpText.setPosition(center.x, center.y + this.hexSize * 1.7);
    this.hpText.setText(`HP ${unit.hp}/${unit.hpMax}  |  imp ${unit.impeto}  sl ${unit.slancio}`);
    this.hpText.setVisible(true);
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

    const dark = 0x222222;
    const light = 0xeeeeee;

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

    // Scudo nella offhand: disegnato a sinistra del corpo
    if (s) {
      const sx = cx - hexSize * 0.55;
      const sy = cy + hexSize * 0.15;
      const r = hexSize * 0.32;
      this.graphics.fillStyle(0x886633, 1);
      this.graphics.fillCircle(sx, sy, r);
      this.graphics.lineStyle(2, dark, 1);
      this.graphics.strokeCircle(sx, sy, r);
      // Borchia centrale
      this.graphics.fillStyle(0xddaa55, 1);
      this.graphics.fillCircle(sx, sy, r * 0.35);
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

  /** Flash visivo quando l'unità è colpita */
  flashHit(scene: Phaser.Scene): void {
    const center = axialToPixel(this.displayedPosition, this.hexSize, this.origin);
    const flash = scene.add.graphics();
    flash.fillStyle(0xffff00, 0.7);
    flash.fillCircle(center.x, center.y, this.hexSize * 1.6);
    scene.tweens.add({
      targets: flash,
      alpha: 0,
      duration: 400,
      onComplete: () => flash.destroy(),
    });
  }

  /** Numero danni fluttuante */
  showDamage(scene: Phaser.Scene, dmg: number): void {
    const center = axialToPixel(this.displayedPosition, this.hexSize, this.origin);
    const t = scene.add.text(center.x, center.y - this.hexSize * 0.5, `-${dmg}`, {
      fontFamily: 'monospace',
      fontSize: '24px',
      color: '#ff5050',
      stroke: '#000',
      strokeThickness: 4,
    });
    t.setOrigin(0.5, 0.5);
    scene.tweens.add({
      targets: t,
      y: center.y - this.hexSize * 2.5,
      alpha: 0,
      duration: 1200,
      onComplete: () => t.destroy(),
    });
  }

  /** Testo "MISS / PARATO / SCHIVATO" fluttuante (per attacchi falliti). */
  showText(scene: Phaser.Scene, text: string, color: string = '#ffd966'): void {
    const center = axialToPixel(this.displayedPosition, this.hexSize, this.origin);
    const t = scene.add.text(center.x, center.y - this.hexSize * 0.5, text, {
      fontFamily: 'monospace',
      fontSize: '18px',
      color,
      stroke: '#000',
      strokeThickness: 3,
    });
    t.setOrigin(0.5, 0.5);
    scene.tweens.add({
      targets: t,
      y: center.y - this.hexSize * 2.5,
      alpha: 0,
      duration: 1200,
      onComplete: () => t.destroy(),
    });
  }

  destroy(): void {
    this.graphics.destroy();
    this.label.destroy();
    this.hpText.destroy();
  }
}

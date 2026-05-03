import Phaser from 'phaser';

/**
 * Animazione lancio dadi: mostra N dadi D6 stilizzati che ruotano e atterrano
 * sui valori finali. Usata dopo RESOLVE_COMBAT per dare evidenza visiva di
 * quanti dadi sono stati tirati e quali valori sono usciti.
 *
 * Stack: Phaser graphics (pip stile D6), tween scale+rotation.
 * Layout: dadi disposti in fila orizzontale sopra l'origine indicata.
 *
 * Esempio uso:
 *   playDiceRoll(scene, {
 *     dice: [3, 5, 2],
 *     centerX: 640, centerY: 200,
 *     label: 'Bravo attacca',
 *     color: 0xffee66,
 *     onComplete: () => { ... },
 *   });
 */

export interface DiceRollOptions {
  /** Valori finali dei dadi (1-6). La lunghezza determina quanti dadi disegnare. */
  dice: number[];
  /** Centro orizzontale del gruppo dadi (px). */
  centerX: number;
  /** Centro verticale del gruppo (px). */
  centerY: number;
  /** Label sopra i dadi (es. "Alpha attacca"). */
  label?: string;
  /** Colore base dadi (default giallo). */
  color?: number;
  /** Durata totale dell'animazione (default 700ms roll + 600ms hold + 400ms fade). */
  durationRollMs?: number;
  durationHoldMs?: number;
  durationFadeMs?: number;
  /** Callback chiamata a fine animazione. */
  onComplete?: () => void;
}

/** Opzioni per playCombatRoll: animazione completa con titolo + breakdown + esito. */
export interface CombatRollOptions {
  /** Titolo box (es. "ATTACCO vs SCHIVATA"). */
  title: string;
  /** Sotto-titolo (es. "Alpha → Bravo, mischia"). */
  subtitle?: string;
  /** Attacker side. */
  attacker: {
    name: string;
    dice: number[];
    variable: number; // sum post-floor (post-imp)
    fixed: number;
    total: number;
  };
  /** Defender side. dice=[] significa nessuna difesa attiva (ranged o no-defense). */
  defender: {
    name: string;
    dice: number[];
    fixed: number;
    total: number;
  };
  /** Esito finale: residuo, hit/miss, danno raw + effettivo. */
  outcome: {
    residual: number; // var_atk-tot_def per dodge, tot_atk-tot_def per parry
    hit: boolean;
    rawDamage: number;
    effectiveDamage: number;
    defenseType: 'parry' | 'dodge' | 'none';
  };
  /** Centro orizzontale (default centro schermo). */
  centerX: number;
  /** Y top del box. */
  topY: number;
  /** Callback fine animazione. */
  onComplete?: () => void;
}

const DICE_SIZE = 38;
const DICE_GAP = 8;

/**
 * Disegna i pip (puntini) di un D6 sulla faccia "value" (1-6).
 * Pattern standard occidentale.
 */
function drawDicePips(g: Phaser.GameObjects.Graphics, value: number, size: number): void {
  const c = size / 2;
  const r = size * 0.08; // raggio pip
  const off = size * 0.27; // offset dal centro
  g.fillStyle(0x111111, 1);
  // Pip pattern per D6 (1-6) — coordinate relative a (cx, cy)
  const patterns: Record<number, [number, number][]> = {
    1: [[0, 0]],
    2: [[-off, -off], [off, off]],
    3: [[-off, -off], [0, 0], [off, off]],
    4: [[-off, -off], [off, -off], [-off, off], [off, off]],
    5: [[-off, -off], [off, -off], [0, 0], [-off, off], [off, off]],
    6: [[-off, -off], [off, -off], [-off, 0], [off, 0], [-off, off], [off, off]],
  };
  const pips = patterns[Math.max(1, Math.min(6, value))] || [];
  for (const [dx, dy] of pips) {
    g.fillCircle(c + dx, c + dy, r);
  }
}

/**
 * Disegna un singolo dado (rettangolo arrotondato + bordo + pip).
 * Restituisce un container che può essere tweenato.
 */
function makeDie(scene: Phaser.Scene, value: number, color: number): Phaser.GameObjects.Container {
  const cont = scene.add.container(0, 0);
  const g = scene.add.graphics();
  // Sfondo dado
  g.fillStyle(color, 1);
  g.fillRoundedRect(0, 0, DICE_SIZE, DICE_SIZE, 6);
  g.lineStyle(2, 0x333333, 1);
  g.strokeRoundedRect(0, 0, DICE_SIZE, DICE_SIZE, 6);
  drawDicePips(g, value, DICE_SIZE);
  // Origine al centro per ruotare
  cont.add(g);
  g.x = -DICE_SIZE / 2;
  g.y = -DICE_SIZE / 2;
  return cont;
}

/**
 * Helper interno: aggiorna il valore visibile di un dado già esistente
 * (cambia faccia durante il roll). Distrugge graphics interno e ricrea.
 */
function updateDieValue(cont: Phaser.GameObjects.Container, value: number, color: number): void {
  // Distrugge il graphics esistente e ne ricrea uno con il nuovo valore
  for (const child of [...cont.list]) {
    child.destroy();
  }
  const g = cont.scene.add.graphics();
  g.fillStyle(color, 1);
  g.fillRoundedRect(0, 0, DICE_SIZE, DICE_SIZE, 6);
  g.lineStyle(2, 0x333333, 1);
  g.strokeRoundedRect(0, 0, DICE_SIZE, DICE_SIZE, 6);
  drawDicePips(g, value, DICE_SIZE);
  g.x = -DICE_SIZE / 2;
  g.y = -DICE_SIZE / 2;
  cont.add(g);
}

/**
 * Funzione principale: anima N dadi che rollano e atterrano sui valori finali.
 * Auto-cleanup. Restituisce una Promise che si risolve a fine animazione.
 */
export function playDiceRoll(
  scene: Phaser.Scene,
  opts: DiceRollOptions,
): Promise<void> {
  return new Promise((resolve) => {
    const n = opts.dice.length;
    if (n === 0) {
      opts.onComplete?.();
      resolve();
      return;
    }
    const color = opts.color ?? 0xffee66;
    const durRoll = opts.durationRollMs ?? 700;
    const durHold = opts.durationHoldMs ?? 600;
    const durFade = opts.durationFadeMs ?? 400;

    // Layout orizzontale: posiziona N dadi attorno a (centerX, centerY)
    const totalW = n * DICE_SIZE + (n - 1) * DICE_GAP;
    const startX = opts.centerX - totalW / 2 + DICE_SIZE / 2;
    const cy = opts.centerY;

    // Container "gruppo" per gestire alpha/destroy collettivo
    const group = scene.add.container(0, 0);
    group.setScrollFactor(0); // UI immune da scroll camera

    // Label sopra (opzionale)
    let labelText: Phaser.GameObjects.Text | null = null;
    if (opts.label) {
      labelText = scene.add.text(opts.centerX, cy - DICE_SIZE * 1.2, opts.label, {
        fontFamily: 'monospace',
        fontSize: '16px',
        color: '#ffffff',
        stroke: '#000000',
        strokeThickness: 3,
        fontStyle: 'bold',
      });
      labelText.setOrigin(0.5, 1);
      labelText.setScrollFactor(0);
      group.add(labelText);
    }

    // Crea N dadi con valore random iniziale (1..6)
    const dies: Phaser.GameObjects.Container[] = [];
    for (let i = 0; i < n; i++) {
      const die = makeDie(scene, 1 + Math.floor(Math.random() * 6), color);
      die.x = startX + i * (DICE_SIZE + DICE_GAP);
      die.y = cy;
      die.setScrollFactor(0);
      // Scale-in dramatic
      die.setScale(0.2);
      group.add(die);
      dies.push(die);
    }

    // Fase 1: pop-in scale 0.2 → 1.0 (200ms)
    scene.tweens.add({
      targets: dies,
      scale: 1.0,
      duration: 200,
      ease: 'Back.easeOut',
    });

    // Fase 2: roll (rotation + face change ogni 80ms) per durRoll
    const faceChangeInterval = 80;
    const faceChanges = Math.floor(durRoll / faceChangeInterval);
    for (let k = 1; k <= faceChanges; k++) {
      scene.time.delayedCall(k * faceChangeInterval, () => {
        for (const die of dies) {
          if (!die.scene) return;
          updateDieValue(die, 1 + Math.floor(Math.random() * 6), color);
        }
      });
    }
    // Rotation tween (gira 720°)
    scene.tweens.add({
      targets: dies,
      angle: 720,
      duration: durRoll,
      ease: 'Cubic.easeOut',
    });

    // Fase 3: atterraggio sui valori reali (subito dopo durRoll)
    scene.time.delayedCall(durRoll + 50, () => {
      for (let i = 0; i < dies.length; i++) {
        const die = dies[i];
        if (!die.scene) continue;
        updateDieValue(die, opts.dice[i], color);
        die.setAngle(0); // raddrizza
        // Piccolo bounce sul valore finale
        scene.tweens.add({
          targets: die,
          scale: { from: 1.0, to: 1.2 },
          duration: 100,
          yoyo: true,
        });
      }
    });

    // Fase 4: hold + fade out
    scene.time.delayedCall(durRoll + durHold + 100, () => {
      scene.tweens.add({
        targets: group,
        alpha: 0,
        duration: durFade,
        onComplete: () => {
          group.destroy();
          opts.onComplete?.();
          resolve();
        },
      });
    });
  });
}

/**
 * Animazione completa di un combat: titolo, dadi attaccante + breakdown numerico,
 * dadi difensore + breakdown, ed esito (HIT/MISS, residuo, danno).
 *
 * Layout (top-down):
 *   ┌─────────────────────────────────────────────┐
 *   │           ATTACCO vs SCHIVATA                │ titolo
 *   │           Alpha → Bravo (mischia)            │ subtitle
 *   │  [d][d][d]  3+5+2 = 10 + 4 fix = 14 (totale)│ atk row
 *   │  [d][d]     2+4 = 6 + 2 fix = 8 (totale)    │ def row
 *   │  ▓▓ HIT  variabile 10 − difesa 8 = +2 → 6 dmg (RD 4) = 2 ▓▓│ esito
 *   └─────────────────────────────────────────────┘
 */
export function playCombatRoll(
  scene: Phaser.Scene,
  opts: CombatRollOptions,
): Promise<void> {
  return new Promise((resolve) => {
    const W = 560;
    const H = 270;
    const bx = opts.centerX - W / 2;
    const by = opts.topY;

    const group = scene.add.container(0, 0);
    group.setScrollFactor(0);
    group.setAlpha(0);

    // Sfondo box
    const bg = scene.add.rectangle(bx, by, W, H, 0x0c1218, 0.92);
    bg.setOrigin(0, 0);
    bg.setStrokeStyle(2, 0x6699bb);
    group.add(bg);

    // Titolo
    const titleColor = opts.outcome.hit ? '#ffaaaa' : '#88ccff';
    const title = scene.add.text(opts.centerX, by + 14, opts.title, {
      fontFamily: 'monospace', fontSize: '20px', color: titleColor,
      fontStyle: 'bold', stroke: '#000', strokeThickness: 3,
    });
    title.setOrigin(0.5, 0);
    group.add(title);

    if (opts.subtitle) {
      const sub = scene.add.text(opts.centerX, by + 42, opts.subtitle, {
        fontFamily: 'monospace', fontSize: '13px', color: '#cdd9e3',
      });
      sub.setOrigin(0.5, 0);
      group.add(sub);
    }

    // Riga attaccante: dadi a sinistra, breakdown a destra
    const yAtk = by + 78;
    const atkDies: Phaser.GameObjects.Container[] = [];
    const atkN = opts.attacker.dice.length;
    const dieRowX = bx + 18;
    for (let i = 0; i < atkN; i++) {
      const die = makeDie(scene, 1 + Math.floor(Math.random() * 6), 0xffee66);
      die.x = dieRowX + DICE_SIZE / 2 + i * (DICE_SIZE + DICE_GAP);
      die.y = yAtk + DICE_SIZE / 2;
      die.setScale(0.2);
      group.add(die);
      atkDies.push(die);
    }
    const atkBreakdownX = dieRowX + Math.max(atkN, 1) * (DICE_SIZE + DICE_GAP) + 12;
    const atkBreakdown = scene.add.text(atkBreakdownX, yAtk + DICE_SIZE / 2, '', {
      fontFamily: 'monospace', fontSize: '14px', color: '#ffee66',
      fontStyle: 'bold',
    });
    atkBreakdown.setOrigin(0, 0.5);
    atkBreakdown.setAlpha(0);
    group.add(atkBreakdown);

    // Riga difensore (se presente)
    const yDef = yAtk + DICE_SIZE + 16;
    const defDies: Phaser.GameObjects.Container[] = [];
    const defN = opts.defender.dice.length;
    let defBreakdown: Phaser.GameObjects.Text | null = null;
    if (defN > 0) {
      for (let i = 0; i < defN; i++) {
        const die = makeDie(scene, 1 + Math.floor(Math.random() * 6), 0x88ccff);
        die.x = dieRowX + DICE_SIZE / 2 + i * (DICE_SIZE + DICE_GAP);
        die.y = yDef + DICE_SIZE / 2;
        die.setScale(0.2);
        group.add(die);
        defDies.push(die);
      }
      defBreakdown = scene.add.text(
        dieRowX + Math.max(defN, 1) * (DICE_SIZE + DICE_GAP) + 12,
        yDef + DICE_SIZE / 2,
        '',
        {
          fontFamily: 'monospace', fontSize: '14px', color: '#88ccff',
          fontStyle: 'bold',
        },
      );
      defBreakdown.setOrigin(0, 0.5);
      defBreakdown.setAlpha(0);
      group.add(defBreakdown);
    }

    // Box esito (in basso, popolato dopo l'atterraggio)
    const yOutcome = by + H - 46;
    const outcomeBg = scene.add.rectangle(opts.centerX, yOutcome, W - 32, 36,
      opts.outcome.hit ? 0x4a2222 : 0x224a4a, 0.95);
    outcomeBg.setStrokeStyle(2, opts.outcome.hit ? 0xff6666 : 0x66ccff);
    outcomeBg.setAlpha(0);
    group.add(outcomeBg);
    const outcomeText = scene.add.text(opts.centerX, yOutcome, '', {
      fontFamily: 'monospace', fontSize: '15px',
      color: opts.outcome.hit ? '#ffdddd' : '#ddffff',
      fontStyle: 'bold', stroke: '#000', strokeThickness: 2,
    });
    outcomeText.setOrigin(0.5, 0.5);
    outcomeText.setAlpha(0);
    group.add(outcomeText);

    // Pop-in del box (200ms)
    scene.tweens.add({ targets: group, alpha: 1, duration: 200 });

    // Roll dadi atk + def insieme: 700ms con face change ogni 80ms
    const allDies = [...atkDies, ...defDies];
    scene.tweens.add({ targets: allDies, scale: 1.0, duration: 200, ease: 'Back.easeOut' });
    const durRoll = 700;
    const faceChangeInterval = 80;
    const faceChanges = Math.floor(durRoll / faceChangeInterval);
    for (let k = 1; k <= faceChanges; k++) {
      scene.time.delayedCall(k * faceChangeInterval, () => {
        for (const die of atkDies) {
          if (!die.scene) return;
          updateDieValue(die, 1 + Math.floor(Math.random() * 6), 0xffee66);
        }
        for (const die of defDies) {
          if (!die.scene) return;
          updateDieValue(die, 1 + Math.floor(Math.random() * 6), 0x88ccff);
        }
      });
    }
    scene.tweens.add({ targets: allDies, angle: 720, duration: durRoll, ease: 'Cubic.easeOut' });

    // Atterraggio sui valori reali (dopo 750ms)
    scene.time.delayedCall(durRoll + 50, () => {
      // Atk dies → valori reali
      for (let i = 0; i < atkDies.length; i++) {
        const die = atkDies[i];
        if (!die.scene) continue;
        updateDieValue(die, opts.attacker.dice[i], 0xffee66);
        die.setAngle(0);
      }
      for (let i = 0; i < defDies.length; i++) {
        const die = defDies[i];
        if (!die.scene) continue;
        updateDieValue(die, opts.defender.dice[i], 0x88ccff);
        die.setAngle(0);
      }
      // Bounce
      scene.tweens.add({
        targets: allDies, scale: { from: 1.0, to: 1.15 }, duration: 100, yoyo: true,
      });
      // Mostra breakdown numerico
      const atkSum = opts.attacker.dice.reduce((a, b) => a + b, 0);
      const atkSumStr = opts.attacker.dice.length > 0
        ? opts.attacker.dice.join('+')
        : '0';
      const fixedStr = opts.attacker.fixed >= 0 ? `+${opts.attacker.fixed}` : `${opts.attacker.fixed}`;
      // Mostra il var EFFETTIVO (post-imp/floor) se diverso dalla raw sum
      const varStr = opts.attacker.variable !== atkSum
        ? `${atkSumStr}=${atkSum}→${opts.attacker.variable}`
        : `${atkSumStr}=${atkSum}`;
      atkBreakdown.setText(`var [${varStr}] ${fixedStr} fix = ${opts.attacker.total}`);
      scene.tweens.add({ targets: atkBreakdown, alpha: 1, duration: 200 });

      if (defBreakdown && defN > 0) {
        const defSum = opts.defender.dice.reduce((a, b) => a + b, 0);
        const defSumStr = opts.defender.dice.length > 0 ? opts.defender.dice.join('+') : '0';
        const dFix = opts.defender.fixed >= 0 ? `+${opts.defender.fixed}` : `${opts.defender.fixed}`;
        defBreakdown.setText(`var [${defSumStr}=${defSum}] ${dFix} fix = ${opts.defender.total}`);
        scene.tweens.add({ targets: defBreakdown, alpha: 1, duration: 200 });
      }
    });

    // Box esito: popolato e mostrato dopo 1100ms
    scene.time.delayedCall(durRoll + 400, () => {
      const o = opts.outcome;
      let outcomeStr = '';
      if (o.defenseType === 'none') {
        if (o.hit) {
          outcomeStr = `HIT — ${o.rawDamage} dmg raw → ${o.effectiveDamage} dmg effettivi`;
        } else {
          outcomeStr = `MISS — totale ${o.residual} ≤ 0`;
        }
      } else if (o.defenseType === 'dodge') {
        if (o.hit) {
          outcomeStr = `HIT — var ${opts.attacker.variable} − schivata ${opts.defender.total} = ${o.residual} > 0; ${o.rawDamage} raw → ${o.effectiveDamage} eff`;
        } else {
          outcomeStr = `SCHIVATO — var ${opts.attacker.variable} − schivata ${opts.defender.total} = ${o.residual} ≤ 0`;
        }
      } else { // parry
        if (o.hit) {
          outcomeStr = `HIT — totale ${opts.attacker.total} − parata ${opts.defender.total} = ${o.residual} > 0; ${o.rawDamage} raw → ${o.effectiveDamage} eff`;
        } else {
          outcomeStr = `PARATO — totale ${opts.attacker.total} − parata ${opts.defender.total} = ${o.residual} ≤ 0`;
        }
      }
      outcomeText.setText(outcomeStr);
      scene.tweens.add({ targets: [outcomeBg, outcomeText], alpha: 1, duration: 250 });
    });

    // Hold + fade out (totale ~3.5s)
    const TOTAL_HOLD = 2500;
    scene.time.delayedCall(durRoll + 400 + TOTAL_HOLD, () => {
      scene.tweens.add({
        targets: group,
        alpha: 0,
        duration: 500,
        onComplete: () => {
          group.destroy();
          opts.onComplete?.();
          resolve();
        },
      });
    });
  });
}

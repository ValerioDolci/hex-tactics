import Phaser from 'phaser';
import { LogEntry } from '@core/state';
import { FONTS, PALETTE, makeCodexPanel } from './theme';

/**
 * Pannello cronaca del duello — Codex Tacticus.
 *
 * Sostituisce il vecchio "stack-trace style" log con una rendering narrativo:
 *  - Header drop-cap (R I, R II, …) come iniziale capitale del round
 *  - Riga round-divisor con filetto inchiostro
 *  - Eventi normali in body italic ink, eventi `[reducer]` rifiutati in ink-faded
 *  - Pattern noti vengono "narrativizzati" (vedi narrativize()) — il pattern
 *    matcher è non distruttivo: se nessun pattern matcha, mostra il messaggio
 *    originale. Niente perdita di info.
 *
 * NB: niente mask geometric — interferiva con coord/input. Soluzione fully-text:
 * calcoliamo il text.height dopo setText e troncamo finché ci sta.
 */
export class CombatLog {
  private container: Phaser.GameObjects.Container;
  private bg: Phaser.GameObjects.Rectangle;
  private text: Phaser.GameObjects.Text;
  private maxLines: number;
  private boxH: number;
  private resizePanel: (w: number, h: number) => void;

  constructor(scene: Phaser.Scene, x: number, y: number, w: number, h: number, maxLines = 30) {
    this.maxLines = maxLines;
    this.boxH = h;
    const panel = makeCodexPanel({ scene, x, y, width: w, height: h, tone: 'vellum', alpha: 0.93 });
    this.container = panel.container;
    this.container.setScrollFactor(0);
    this.bg = panel.bg;
    this.resizePanel = panel.resize;

    this.text = scene.add.text(14, 12, '', {
      fontFamily: FONTS.body,
      fontSize: '14px',
      color: PALETTE.ink.css,
      wordWrap: { width: w - 28 },
      lineSpacing: 4,
    });
    this.container.add(this.text);
  }

  update(entries: LogEntry[]): void {
    let recent = entries.slice(-this.maxLines);
    const availH = this.boxH - 24;

    while (recent.length > 0) {
      const lines = recent.map((e) => formatEntry(e));
      this.text.setText(lines.join('\n'));
      if (this.text.height <= availH || recent.length === 1) break;
      recent = recent.slice(1);
    }
    this.text.y = 12;
  }

  /** Riposiziona e ridimensiona il pannello (per resize del viewport). */
  relayout(x: number, y: number, w: number, h: number): void {
    this.boxH = h;
    this.container.setPosition(x, y);
    this.bg.setSize(w, h);
    this.resizePanel(w, h);
    this.text.setStyle({ wordWrap: { width: w - 28 } });
  }
}

/** Formatta una entry di log in stile cronaca (drop-cap su round-marker). */
function formatEntry(e: LogEntry): string {
  const msg = e.message;
  // Round divider: "── Inizio round N ──" → drop-cap header con filetto
  const roundMatch = msg.match(/^──+\s*Inizio round (\d+)\s*──+$/);
  if (roundMatch) {
    const r = parseInt(roundMatch[1], 10);
    return `\n  ❦  ROUND ${toRoman(r)}  ❦`;
  }
  return `R${e.round}  ·  ${narrativize(msg)}`;
}

/**
 * Trasforma messaggi raw del reducer in italiano narrativo asciutto.
 * Pattern non riconosciuti passano invariati (graceful degradation).
 */
function narrativize(msg: string): string {
  // [reducer] evento 'X' rifiutato: reason (phase=...)
  let m = msg.match(/^\[reducer\] evento '([^']+)' rifiutato: (.+?)(?:\s*\(phase=[^)]+\))?$/);
  if (m) {
    const [, evt, reason] = m;
    return `gesto ${eventLabel(evt)} svanisce — ${stripPhase(reason)}`;
  }
  // "Nome: turno start (dadi N, impeto M, slancio K)"
  m = msg.match(/^(.+?): turno start \(dadi (\d+), impeto (\d+), slancio (\d+)\)$/);
  if (m) {
    const [, name, dadi, impeto, slancio] = m;
    return `${name} prende l'iniziativa  (dadi ${dadi} · imp ${impeto} · sl ${slancio})`;
  }
  // "Nome: scelta AI = X"
  m = msg.match(/^(.+?): scelta AI = (.+)$/);
  if (m) {
    const [, name, choice] = m;
    return `${name} elegge: ${choice}`;
  }
  // "Nome: movimento rifiutato (slancio insufficiente: X < Y)"
  m = msg.match(/^(.+?): movimento rifiutato \(slancio insufficiente: (\d+) < (\d+)\)$/);
  if (m) {
    const [, name, has, need] = m;
    return `${name} non può muovere — slancio ${has} di ${need}`;
  }
  // "Nome: movimento rifiutato (basetta sovrapposta a Other)"
  m = msg.match(/^(.+?): movimento rifiutato \(basetta sovrapposta a (.+?)\)$/);
  if (m) {
    const [, name, other] = m;
    return `${name} trova la via sbarrata da ${other}`;
  }
  // "Nome dichiara attacco a Target con X"
  m = msg.match(/^(.+?) dichiara (attacco|attacco a distanza) a (.+?) con (.+)$/);
  if (m) {
    const [, name, kind, target, weapon] = m;
    const verb = kind === 'attacco a distanza' ? 'scocca contro' : 'avanza su';
    return `${name} ${verb} ${target}  (${weapon})`;
  }
  // "Nome tira attacco: ..."
  m = msg.match(/^(.+?) tira (attacco|attacco ranged): (.+)$/);
  if (m) {
    const [, name, , descr] = m;
    return `${name} tira il colpo: ${descr}`;
  }
  // "Nome tira parry/dodge: ..."
  m = msg.match(/^(.+?) tira (parry|dodge): (.+)$/);
  if (m) {
    const [, name, kind, descr] = m;
    return `${name} ${kind === 'parry' ? 'para' : 'schiva'}: ${descr}`;
  }
  // "Nome è caduto!"
  m = msg.match(/^(.+?) è caduto!$/);
  if (m) {
    return `⚔  ${m[1]} cade.`;
  }
  // "Nome manca Target (...)"
  m = msg.match(/^(.+?) manca (.+?) \(tiro (\d+) <= 0 dopo malus\)$/);
  if (m) {
    const [, name, target, total] = m;
    return `${name} manca ${target}  (tiro ${total} dopo malus)`;
  }
  // "Nome ha parato/schivato senza penalty"
  m = msg.match(/^(.+?) ha (parato|schivato) senza penalty$/);
  if (m) {
    const [, name, kind] = m;
    return `${name} ${kind} netto.`;
  }
  // "Nome: carica +N (delta_dist=X, slancio -K)"
  m = msg.match(/^(.+?): carica \+(\d+) \(delta_dist=(\d+), slancio -(\d+)\)$/);
  if (m) {
    const [, name, bonus, , cost] = m;
    return `${name} carica  (+${bonus} al colpo, −${cost} sl)`;
  }
  // "Nome: prende/lascia posizione difensiva con Y"
  m = msg.match(/^(.+?): (prende|lascia) posizione difensiva con (.+)$/);
  if (m) {
    const [, name, verb, sh] = m;
    const action = verb === 'prende' ? 'si pone in guardia con' : 'abbassa la guardia di';
    return `${name} ${action} ${sh}`;
  }
  // "Game over: vincitore X"
  m = msg.match(/^Game over: vincitore (.+)$/);
  if (m) {
    return m[1] === 'pareggio' ? '— pareggio —' : `— vittoria della fazione ${m[1].replace(/^fazione /, '')} —`;
  }
  return msg;
}

function eventLabel(evt: string): string {
  const map: Record<string, string> = {
    RELOAD: 'di ricarica',
    MOVE: 'di movimento',
    ATTACK: 'd\'attacco',
    DEFENSIVE_STANCE: 'di guardia',
    SLANCIO_ROLL: 'di slancio',
    PASS: 'di passo',
  };
  return map[evt] ?? `(${evt})`;
}

function stripPhase(reason: string): string {
  return reason.replace(/\s*\(phase=[^)]+\)\s*$/, '').trim();
}

function toRoman(n: number): string {
  if (n <= 0) return '0';
  const map: Array<[number, string]> = [
    [1000, 'M'], [900, 'CM'], [500, 'D'], [400, 'CD'],
    [100, 'C'], [90, 'XC'], [50, 'L'], [40, 'XL'],
    [10, 'X'], [9, 'IX'], [5, 'V'], [4, 'IV'], [1, 'I'],
  ];
  let out = '';
  for (const [v, s] of map) while (n >= v) { out += s; n -= v; }
  return out;
}

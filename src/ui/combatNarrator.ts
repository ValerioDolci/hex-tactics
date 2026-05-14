/**
 * Combat Narrator — genera una narrazione asciutta-poetica degli eventi
 * di combattimento, nello stile "marginalia di trattato di scherma del XV sec".
 *
 * Tono: italiano sintetico, una frase per evento (15-30 parole), niente prosa
 * generica AI ("il guerriero brandisce..."), niente avverbi di abbellimento.
 * Esempio: «Calare la mazza dall'alto, la guardia cede; quattro punti di carne.»
 *
 * Architettura:
 *   - Pure function: `narrate(ctx) → string | null`
 *   - Selezione template deterministica (seed da rngSeed corrente) → stesso
 *     replay = stessa narrazione.
 *   - Templates organizzati per famiglia di evento (attack/defense/reload/
 *     movement/initiative); per attacchi differenziati per categoria arma ×
 *     esito × magnitudo danno.
 *   - I template usano placeholders {atk}/{def}/{dmg}; i numeri puri (HP,
 *     dadi) restano nel CombatLog tecnico, non nella narrazione.
 *
 * MOVIMENTO (2026-05-14): per evitare rumore, i singoli evento MOVE NON sono
 * narrati. Si narra UN SOLO movimento riassuntivo per turno, alla chiusura
 * (END_TURN), confrontando `positionAtTurnStart` con la posizione attuale.
 * L'eccezione è il caso "movimento bloccato da zona di controllo" (ZoC),
 * narrato sull'evento MOVE perché è un beat drammatico.
 *
 * Riferimento di tono: `MATCH_NARRATIVES_2026-05-06.md`.
 */

import { GameState } from '@core/state';
import { GameEvent } from '@core/events';
import { Unit } from '@entities/Unit';
import { getWeapon } from '@data/weapons';
import { getShield } from '@data/shields';

// ---------------------------------------------------------------------------
// Tipi
// ---------------------------------------------------------------------------

export interface NarrationCtx {
  prev: GameState;
  curr: GameState;
  event: GameEvent;
}

/** Risultato del narratore: una riga, oppure null se l'evento non merita una linea. */
export type NarrationLine = {
  text: string;
  /** Tono per il rendering (può differenziare colori/stile). */
  tone: 'neutral' | 'hit' | 'miss' | 'defense' | 'initiative' | 'death' | 'tempo';
} | null;

// ---------------------------------------------------------------------------
// Templates — attacchi (per categoria arma × esito × magnitudo)
// ---------------------------------------------------------------------------

type WeaponCat = 'spade' | 'mazze' | 'asce' | 'lance' | 'pugnali' | 'giavellotti' | 'archi' | 'balestre';

interface AttackTemplates {
  openings: string[];
  hit: { scratch: string[]; wound: string[]; heavy: string[]; savage: string[] };
}

const ATTACK_OPEN: Record<WeaponCat, string[]> = {
  spade: [
    '{atk} cala un fendente diagonale',
    '{atk} affonda di punta verso il petto',
    '{atk} taglia di rovescio',
    '{atk} entra di mezzo filo',
    '{atk} avanza in stoccata bassa',
    '{atk} sferra un fendente di traverso',
    '{atk} stringe la guardia e affonda',
    '{atk} apre col falso filo, poi cala',
  ],
  mazze: [
    '{atk} cala la mazza dall\'alto',
    '{atk} carica un fendente d\'incrocio',
    '{atk} fa girare la mazza sopra il capo e abbatte',
    '{atk} prende slancio e schiaccia',
    '{atk} sferra di rovescio col bronzo',
    '{atk} alza l\'arma a due mani e cala',
    '{atk} colpisce sotto, mira al ginocchio',
    '{atk} batte di lato, contro la tempia',
  ],
  asce: [
    '{atk} avventa la lama d\'ascia',
    '{atk} apre con un colpo di taglio largo',
    '{atk} cala l\'ascia a due mani',
    '{atk} fa volteggiare l\'ascia e cala di traverso',
    '{atk} prende slancio col fianco e taglia',
    '{atk} stringe il manico, colpisce di rovescio',
    '{atk} affonda l\'ascia col peso del corpo',
    '{atk} solleva la lama e cala dall\'alto',
  ],
  lance: [
    '{atk} affonda la lancia in linea',
    '{atk} tiene la lancia distesa e spinge',
    '{atk} punta dalla portata, mira al fianco',
    '{atk} affonda l\'asta dietro lo scudo nemico',
    '{atk} tiene la lunga distanza e tocca col ferro',
    '{atk} aggancia col ferro la guardia di {def}',
    '{atk} avanza un piede, allunga la punta',
    '{atk} mira basso, sotto la difesa',
  ],
  pugnali: [
    '{atk} entra a stoccata corta',
    '{atk} cerca il varco sotto la guardia',
    '{atk} taglia di rovescio col pugnale',
    '{atk} affonda la lama corta nel ventre',
    '{atk} si stringe addosso e pugnala',
    '{atk} tiene la presa rovescia e affonda',
    '{atk} cerca la giuntura della corazza',
    '{atk} entra di striscio, fianco a fianco',
  ],
  giavellotti: [
    '{atk} lancia il giavellotto',
    '{atk} brandisce il giavellotto in corsa e lo lascia partire',
    '{atk} arma il braccio e scaglia',
    '{atk} solleva l\'asta sopra la spalla, scocca',
    '{atk} pianta i piedi e lancia',
    '{atk} mira in corsa e libera il giavellotto',
  ],
  archi: [
    '{atk} scocca la freccia',
    '{atk} tende la corda e lascia',
    '{atk} mira al respiro e scocca',
    '{atk} prende la mira tra due battiti, scocca',
    '{atk} tende l\'arco fino all\'orecchio e libera',
    '{atk} incocca, mira al collo, scocca',
    '{atk} libera la corda, la freccia parte',
    '{atk} mira oltre lo scudo, lascia partire',
  ],
  balestre: [
    '{atk} stringe la balestra e fa partire il quadrello',
    '{atk} libera la noce',
    '{atk} appoggia la balestra alla guancia, scocca',
    '{atk} preme il grilletto, il quadrello parte',
    '{atk} mira al pettorale, libera il quadrello',
    '{atk} alza l\'arma e tira',
  ],
};

const ATTACK_HIT: Record<WeaponCat, AttackTemplates['hit']> = {
  spade: {
    scratch: [
      'la lama morde un palmo di carne',
      'incide ma non affonda',
      'graffia la pelle e va via',
      'sfiora il braccio, lascia un segno rosso',
      'la punta sfiora, niente di profondo',
    ],
    wound: [
      'la lama trova il taglio buono',
      'apre una ferita che non chiude da sola',
      'incide profondo',
      'il filo trova carne, il sangue affiora',
      'taglia la spalla, il braccio cede',
    ],
    heavy: [
      'il filo passa di traverso e disegna il danno',
      'la lama affonda e tira',
      'il taglio è lungo e profondo',
      'la spada entra e gira nella ferita',
      'apre il fianco, lascia segno duraturo',
    ],
    savage: [
      'il colpo entra fino al manico',
      'taglia di netto',
      'un colpo da maestro di scherma',
      'la lama esce dall\'altro lato',
      'una stoccata che decide il duello',
    ],
  },
  mazze: {
    scratch: [
      'il colpo glissa, lascia un livido',
      'sfiora ma il legno tiene fermo',
      'morde poco, l\'osso regge',
      'colpisce di striscio, niente di rotto',
    ],
    wound: [
      'lo schianto entra di piatto, costringe a un passo indietro',
      'incrina la guardia, l\'osso geme',
      'il bronzo trova la spalla, il braccio si abbassa',
      'colpisce di pieno, costola incrinata',
    ],
    heavy: [
      'l\'osso cede sotto il peso del bronzo',
      'il colpo abbatte il fiato',
      'la mazza spezza la difesa, il corpo va indietro',
      'il colpo arriva pulito, il respiro si spezza',
    ],
    savage: [
      'un colpo che spezza tutto quello che incontra',
      'la mazza schianta',
      'un colpo che pare frantumare ogni cosa',
      'la testa va all\'indietro, le ginocchia tremano',
    ],
  },
  asce: {
    scratch: [
      'l\'ascia stacca un lembo di stoffa, niente di più',
      'morde poco',
      'gratta la cotta, non trova carne',
      'il filo passa di striscio',
    ],
    wound: [
      'il taglio apre fino allo strato di sotto',
      'la lama spacca e strappa',
      'l\'ascia trova il braccio, lo apre',
      'il filo entra nel fianco, lo lascia segnato',
    ],
    heavy: [
      'l\'ascia incide nel profondo',
      'il colpo manda a terra il fianco',
      'la lama apre la spalla fino all\'osso',
      'taglia di netto, il sangue scorre largo',
    ],
    savage: [
      'un colpo che apre il difensore in due',
      'la lama passa di netto',
      'l\'ascia toglie tutto quello che trova',
      'un colpo di mannaia',
    ],
  },
  lance: {
    scratch: [
      'la punta sfiora la corazza, lascia un segno',
      'graffia il bordo del bracciale',
      'morde lo scudo, non passa',
      'la punta scivola via, scheggia il legno',
    ],
    wound: [
      'la punta trova la giuntura della corazza',
      'entra a un palmo',
      'la lancia pianta nel fianco',
      'la punta passa la cotta, trova carne',
    ],
    heavy: [
      'la lancia passa tra le lamelle e affonda',
      'l\'asta affonda profonda',
      'la punta entra a metà asta, lo solleva',
      'l\'asta passa la difesa, inchioda il braccio',
    ],
    savage: [
      'un colpo che passa parte a parte',
      'la punta esce dall\'altro lato',
      'la lancia entra fino al ferro di base',
      'un colpo che inchioda al terreno',
    ],
  },
  pugnali: {
    scratch: [
      'il pugnale gratta, niente di serio',
      'punge ma scivola via',
      'la lama corta morde poco',
      'sfiora il fianco, una goccia',
    ],
    wound: [
      'la lama corta entra dove serve',
      'apre una ferita rapida e precisa',
      'il pugnale pianta sotto la cintura',
      'morde la giuntura, lascia segno',
    ],
    heavy: [
      'il pugnale trova la giuntura, affonda',
      'la stoccata corta entra fino all\'impugnatura',
      'la lama pianta nel costato',
      'il pugnale cerca il rene, lo trova',
    ],
    savage: [
      'un colpo da assassino nei punti che contano',
      'il pugnale spegne',
      'la lama corta toglie il fiato',
      'una stoccata che chiude la questione',
    ],
  },
  giavellotti: {
    scratch: [
      'il giavellotto scivola, ferisce di striscio',
      'morde poco',
      'la punta lecca il braccio e cade',
      'sfiora la coscia, niente di profondo',
    ],
    wound: [
      'l\'asta entra nel fianco',
      'pianta la punta nel braccio',
      'l\'asta trapassa la cotta leggera',
      'colpisce di pieno il petto',
    ],
    heavy: [
      'il giavellotto trapassa la corazza leggera',
      'inchioda un arto',
      'l\'asta affonda profonda, il braccio non si alza più',
      'la punta esce dietro la spalla',
    ],
    savage: [
      'un tiro che passa parte a parte',
      'l\'asta esce dall\'altro lato',
      'il giavellotto inchioda lì dove cade',
      'un tiro che decide la questione',
    ],
  },
  archi: {
    scratch: [
      'la freccia incide la cotta, niente più',
      'morde di striscio',
      'la cocca sfiora il braccio',
      'la punta gratta il bracciale, cade',
    ],
    wound: [
      'la cocca trova lo spazio tra spalla e gorgiera',
      'la freccia pianta nel fianco',
      'la punta passa la cotta sul petto',
      'la freccia entra a un palmo, il sangue affiora',
    ],
    heavy: [
      'l\'asta della freccia affonda profonda',
      'la punta passa la cotta e trova carne',
      'la freccia entra fino all\'impennatura',
      'la cocca pianta nel costato',
    ],
    savage: [
      'una freccia che spegne tutto',
      'colpo da maestro d\'arco',
      'la freccia trapassa la maglia, esce dietro',
      'un tiro che decide tutto',
    ],
  },
  balestre: {
    scratch: [
      'il quadrello scheggia il bordo del scudo, niente più',
      'devia di poco',
      'morde la lamella esterna, cade',
      'sfiora il pettorale e rimbalza',
    ],
    wound: [
      'il quadrello pianta nel pettorale e ferma il respiro',
      'morde la lamella e affonda',
      'il ferro entra nella spalla',
      'la punta pianta sotto la clavicola',
    ],
    heavy: [
      'il quadrello trapassa il metallo del corpetto',
      'la punta passa l\'armatura',
      'il ferro affonda profondo, lascia ferita larga',
      'il quadrello passa la maglia e trova osso',
    ],
    savage: [
      'un quadrello che passa di netto',
      'colpo che spezza la difesa intera',
      'il quadrello esce dall\'altro lato',
      'un colpo che taglia il duello a metà',
    ],
  },
};

// ---------------------------------------------------------------------------
// Templates — difese
// ---------------------------------------------------------------------------

const DODGE_SUCCESS = [
  '{def} schiva di mezzo passo',
  '{def} si scansa, lascia che il colpo passi nel vuoto',
  '{def} fa un mezzo giro e il colpo gli scivola alle spalle',
  '{def} arretra di un piede, la lama passa davanti',
  '{def} si piega indietro, la punta lecca aria',
  '{def} cambia guardia in fretta, il colpo si perde',
  '{def} sposta il busto di un palmo, il colpo non trova nulla',
  '{def} ruota sulle anche, l\'attacco passa di lato',
];
const DODGE_PARTIAL = [
  '{def} si sposta ma non basta',
  '{def} prova a scansarsi, il colpo gli morde comunque',
  '{def} fa per girarsi, il colpo lo trova lo stesso',
  '{def} cerca di piegarsi, la punta entra a metà',
];

const PARRY_WEAPON_SUCCESS = [
  '{def} para di filo, il colpo va a vuoto',
  '{def} incrocia la lama, ribatte',
  '{def} prende il colpo sul forte della lama',
  '{def} devia con la guardia, il ferro tintinna',
  '{def} respinge col falso filo',
  '{def} ferma il colpo con la coccia',
  '{def} oppone la lama, ferma tutto',
];
const PARRY_WEAPON_PARTIAL = [
  '{def} prova a parare, ma la guardia cede in parte',
  '{def} blocca metà del colpo, il resto passa',
  '{def} oppone la lama tardi, una parte arriva',
  '{def} ferma il filo ma non la spinta, qualcosa passa',
];

const PARRY_SHIELD_SUCCESS = [
  '{def} alza lo scudo, il colpo rimbalza',
  'lo scudo di {def} prende tutto, niente passa',
  '{def} pianta lo scudo, il colpo si spegne sul bordo',
  '{def} riceve sul boccolo dello scudo, fermo',
  '{def} oppone lo scudo, la lama scivola via',
  'lo scudo di {def} regge bene, il colpo si esaurisce',
];
const PARRY_SHIELD_PARTIAL = [
  'lo scudo di {def} regge, ma la spinta passa comunque',
  '{def} para con lo scudo, una parte trova carne',
  '{def} alza lo scudo tardi, una scheggia di colpo arriva',
  'lo scudo di {def} devia il grosso, il resto morde',
];

const ARMOR_ABSORB = [
  'la corazza di {def} assorbe il peggio',
  'l\'armatura di {def} ferma la punta',
  'la maglia di {def} trattiene il colpo, resta solo il livido',
  'la corazza prende il grosso, ma il corpo soffre',
  'l\'armatura morde ma non lascia passare tutto',
  'la maglia di {def} smorza il colpo, ne resta poco',
];

const NO_DEFENSE_HIT = [
  '{def} non fa in tempo a coprirsi',
  '{def} riceve a corpo scoperto',
  '{def} lascia che il colpo arrivi',
  '{def} è preso fuori guardia',
  '{def} non ha tempo di alzare la difesa',
];

const RANGED_MISS = [
  'la {weap} di {atk} non trova il bersaglio',
  '{atk} tira, ma il colpo si perde di lato',
  '{atk} mira male: il colpo svanisce',
  '{atk} libera, ma il tiro va corto',
  'il tiro di {atk} passa di un palmo, nulla',
];
const MELEE_MISS = [
  'il colpo di {atk} va a vuoto',
  '{atk} attacca, ma la guardia di {def} regge',
  '{atk} sferra, ma trova solo aria',
  'l\'arma di {atk} taglia il vuoto',
  '{atk} arriva tardi, il colpo non passa',
];

// ---------------------------------------------------------------------------
// Templates — reload / iniziativa / death
// ---------------------------------------------------------------------------

const RELOAD_BOW = [
  '{atk} rimette mano alla faretra, incocca',
  '{atk} tende di nuovo l\'arco',
  '{atk} riprende fiato, tende la corda',
  '{atk} incocca una nuova freccia',
  '{atk} prende un\'altra freccia, la innesta',
  '{atk} si fa un attimo per ricoccare',
];
const RELOAD_CROSSBOW = [
  '{atk} ricarica la balestra, leva su il piè di porco',
  '{atk} tende la corda della balestra a forza di braccia',
  '{atk} aggancia la corda alla noce',
  '{atk} incocca il quadrello con cura',
  '{atk} ricarica con tutto il peso del corpo',
];

const INIT_FIRST_GAIN = [
  '{unit} prende l\'iniziativa',
  'è {unit} a muovere per primo',
  'tocca a {unit} aprire il duello',
  '{unit} apre il duello',
];
const INIT_SWAP_GAIN = [
  '{unit} passa al contrattacco',
  '{unit} riprende l\'iniziativa',
  'il ritmo cambia: ora muove {unit}',
  'il tempo si capovolge, ora avanza {unit}',
  '{unit} ribalta il tempo del duello',
];

const DEATH = [
  '{def} cade',
  '{def} non si rialza',
  '{def} cede, le ginocchia toccano terra',
  '{def} crolla a terra senza più alzarsi',
  'il duello finisce qui per {def}',
  '{def} si abbatte, l\'arma cade prima del corpo',
];

// ---------------------------------------------------------------------------
// Templates — movimento riassuntivo (a fine turno) + carica + ZoC + contraccolpo
// ---------------------------------------------------------------------------

// APPROACH per N esagoni guadagnati verso il nemico
const MOVE_APPROACH_1 = [
  '{atk} guadagna un passo verso {def}',
  '{atk} stringe un poco la distanza',
  '{atk} si fa avanti di un passo',
  '{atk} muove un piede in avanti',
  '{atk} si avvicina di un passo',
];
const MOVE_APPROACH_SHORT = [
  '{atk} stringe la distanza',
  '{atk} riduce il terreno tra sé e {def}',
  '{atk} avanza verso {def}',
  '{atk} chiude di qualche passo',
  '{atk} guadagna terreno verso {def}',
  '{atk} si fa sotto, cerca il contatto',
  '{atk} stringe la guardia, avanza',
];
const MOVE_APPROACH_LONG = [
  '{atk} attraversa il campo verso {def}',
  '{atk} colma di slancio la distanza',
  '{atk} si lancia in avanti, vuole arrivare',
  '{atk} divora il terreno verso {def}',
  '{atk} carica a tutto andare',
  '{atk} muove tutto il corpo in avanti, cerca il duello',
];

// RETREAT per N esagoni guadagnati allontanandosi
const MOVE_RETREAT_1 = [
  '{atk} arretra di un passo',
  '{atk} fa un passo indietro',
  '{atk} cede un poco di terreno',
  '{atk} si stacca di un piede',
  '{atk} indietreggia appena',
];
const MOVE_RETREAT_SHORT = [
  '{atk} arretra, cerca aria',
  '{atk} si allarga, prende campo',
  '{atk} apre la distanza',
  '{atk} si toglie dal contatto',
  '{atk} cede terreno per riprendere fiato',
  '{atk} arretra di qualche passo, riapre la guardia',
  '{atk} si dà respiro, indietreggia',
];
const MOVE_RETREAT_LONG = [
  '{atk} si ritira, tiene il duello aperto',
  '{atk} si dà spazio, fa terreno',
  '{atk} apre il campo a tutto andare',
  '{atk} arretra di corsa, cerca la giusta distanza',
  '{atk} si stacca a lungo, riapre il combattimento',
  '{atk} si toglie dal corto, prende campo',
];

// Movimento "laterale" (si muove ma distanza nemico invariata)
const MOVE_LATERAL = [
  '{atk} cerca l\'angolo, gira intorno',
  '{atk} si sposta, cambia linea',
  '{atk} prova un altro lato',
  '{atk} aggira di fianco',
  '{atk} muove di lato, cerca l\'apertura',
  '{atk} cambia angolo d\'attacco',
  '{atk} si sposta sul fianco di {def}',
];

const MOVE_BLOCKED_BY_ZOC = [
  '{atk} prova a passare, ma la zona di {def} non lo lascia',
  '{atk} tenta il varco, {def} controlla il terreno',
  '{atk} cerca di passare, ma {def} tiene la linea',
];

const CARICA_BIG = [
  '{atk} si lancia in carica, l\'arma carica di slancio',
  '{atk} arriva di corsa, il colpo prende peso',
  '{atk} parte di slancio, l\'attacco si arma',
];
const CARICA_SMALL = [
  '{atk} avanza spedito, l\'arma trova un po\' di slancio',
  '{atk} arriva col passo deciso',
];

// Contraccolpo: colpo che destabilizza ma non ferisce (es. armatura assorbe tutto)
const CONTRACCOLPO_SLANCIO = [
  '{def} regge, ma lo scossone gli porta via il tempo',
  '{def} non sanguina, ma il colpo lo destabilizza',
  '{def} tiene, ma perde lo slancio',
];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** PRNG deterministico (Mulberry32) — usa il rngSeed corrente come stato iniziale. */
function pick<T>(arr: T[], seed: number): T {
  if (arr.length === 0) throw new Error('pick: array vuoto');
  let t = (seed + 0x6d2b79f5) | 0;
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  const r = ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  return arr[Math.floor(r * arr.length)];
}

function fmt(tpl: string, vars: Record<string, string>): string {
  return tpl.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? `{${k}}`);
}

function magnitudeOf(dmg: number): 'scratch' | 'wound' | 'heavy' | 'savage' {
  if (dmg <= 3) return 'scratch';
  if (dmg <= 7) return 'wound';
  if (dmg <= 12) return 'heavy';
  return 'savage';
}

function weaponCategory(weaponId: string | undefined): WeaponCat | null {
  if (!weaponId) return null;
  const w = getWeapon(weaponId);
  if (!w) return null;
  const cat = w.category as WeaponCat;
  if (cat in ATTACK_OPEN) return cat;
  return null;
}

function findEnemy(state: GameState, faction: Unit['faction']): Unit | undefined {
  return Object.values(state.units).find((u) => u.faction !== faction && u.alive);
}

/** Distanza esagonale axial. */
function hexDist(a: { q: number; r: number }, b: { q: number; r: number }): number {
  return (Math.abs(a.q - b.q) + Math.abs(a.q + a.r - b.q - b.r) + Math.abs(a.r - b.r)) / 2;
}

// ---------------------------------------------------------------------------
// Narratore principale
// ---------------------------------------------------------------------------

export function narrate(ctx: NarrationCtx): NarrationLine {
  const { prev, curr, event } = ctx;
  const seed = curr.rngSeed | 0;

  switch (event.type) {
    case 'RESOLVE_COMBAT':
      return narrateResolve(prev, curr, seed);
    case 'RELOAD':
      return narrateReload(prev, curr, event.unitId, seed);
    case 'MOVE':
      // 2026-05-14: il movimento singolo NON è narrato. Si narra il riassunto su
      // END_TURN. Eccezione: se il MOVE è stato fermato da una ZoC nemica, è
      // un beat drammatico che merita la sua riga.
      return narrateMoveBlock(prev, curr, event.unitId, seed);
    case 'END_TURN':
      return narrateEndTurnMovement(prev, curr, seed);
    case 'START_ROUND':
      return narrateStartRound(prev, curr, seed);
    case 'CHOOSE_CARICA':
      return narrateCarica(prev, curr, event.amount, seed);
    default:
      return null;
  }
}

function narrateResolve(prev: GameState, curr: GameState, seed: number): NarrationLine {
  const lr = curr.lastResolution;
  if (!lr) return null;

  const pa = prev.pendingAction;
  const weaponId = pa?.weaponId ?? undefined;
  const cat = weaponCategory(weaponId);
  const isRanged = lr.isRanged;
  const parryWith = pa?.defense?.parryWith;
  const defenseType = lr.defenseType;

  const vars = {
    atk: lr.attackerName,
    def: lr.defenderName,
    dmg: String(lr.effectiveDamage),
    weap: weaponId ? (getWeapon(weaponId)?.name ?? '').toLowerCase() : 'arma',
  };

  // Miss
  if (!lr.hit) {
    if (isRanged) {
      return { text: fmt(pick(RANGED_MISS, seed), vars), tone: 'miss' };
    }
    if (defenseType === 'dodge') {
      return { text: fmt(pick(DODGE_SUCCESS, seed), vars), tone: 'defense' };
    }
    if (defenseType === 'parry') {
      const targetUnit = pa?.targetId ? curr.units[pa.targetId] : undefined;
      const offIsShield = !!getShield(targetUnit?.offhand ?? '');
      const isShield = parryWith === 'offhand' && offIsShield;
      const pool = isShield ? PARRY_SHIELD_SUCCESS : PARRY_WEAPON_SUCCESS;
      return { text: fmt(pick(pool, seed), vars), tone: 'defense' };
    }
    return { text: fmt(pick(MELEE_MISS, seed), vars), tone: 'miss' };
  }

  // Hit
  const armorAbsorbedSome = lr.rawDamage > lr.effectiveDamage && lr.effectiveDamage > 0;
  const armorAbsorbedAll = lr.rawDamage > 0 && lr.effectiveDamage === 0;
  const partialDodge = !isRanged && defenseType === 'dodge';
  const partialParry = !isRanged && defenseType === 'parry';

  const opening = cat ? fmt(pick(ATTACK_OPEN[cat], seed), vars) : `${vars.atk} colpisce`;

  let closing: string;
  if (partialDodge) {
    closing = fmt(pick(DODGE_PARTIAL, seed + 1), vars);
  } else if (partialParry) {
    const targetUnit = pa?.targetId ? curr.units[pa.targetId] : undefined;
    const offIsShield = !!getShield(targetUnit?.offhand ?? '');
    const isShield = parryWith === 'offhand' && offIsShield;
    closing = fmt(pick(isShield ? PARRY_SHIELD_PARTIAL : PARRY_WEAPON_PARTIAL, seed + 1), vars);
  } else if (defenseType === 'none' && !isRanged) {
    closing = fmt(pick(NO_DEFENSE_HIT, seed + 1), vars);
  } else if (cat) {
    const mag = magnitudeOf(lr.effectiveDamage);
    closing = pick(ATTACK_HIT[cat][mag], seed + 1);
  } else {
    closing = `${lr.effectiveDamage} punti di danno`;
  }

  const defAfter = pa?.targetId ? curr.units[pa.targetId] : undefined;
  const fatal = !!(defAfter && defAfter.hp === 0 && defAfter.alive === false);

  let text = `${opening}: ${closing}`;
  // SKIP armor-absorb in caso di colpo fatale: contraddice la morte ("armatura assorbe"
  // + "X cade" stride). Per i colpi non fatali, l'armatura aggiunge dettaglio utile.
  if (!fatal) {
    if (armorAbsorbedAll) {
      // Armatura assorbe tutto → contraccolpo allo slancio (D-048 in regole)
      text += `. ${fmt(pick(CONTRACCOLPO_SLANCIO, seed + 2), vars)}`;
    } else if (armorAbsorbedSome) {
      text += `. ${fmt(pick(ARMOR_ABSORB, seed + 2), vars)}`;
    }
  }

  if (fatal) {
    return { text: `${text}. ${fmt(pick(DEATH, seed + 3), vars)}.`, tone: 'death' };
  }

  return { text: `${text}.`, tone: 'hit' };
}

function narrateReload(prev: GameState, curr: GameState, unitId: string, seed: number): NarrationLine {
  const u = prev.units[unitId] ?? curr.units[unitId];
  if (!u || !u.weapon) return null;
  const w = getWeapon(u.weapon);
  if (!w) return null;
  const vars = { atk: u.name };
  const pool = w.category === 'balestre' ? RELOAD_CROSSBOW : RELOAD_BOW;
  return { text: fmt(pick(pool, seed), vars), tone: 'tempo' };
}

function narrateMoveBlock(prev: GameState, curr: GameState, unitId: string, seed: number): NarrationLine {
  // Solo caso ZoC: movimento fermato da zona di controllo nemica (asta in arrivo).
  const before = prev.units[unitId];
  if (!before) return null;
  if (curr.phase !== 'awaiting-attacker-bid' || !curr.moveInProgress) return null;
  // Verifica che l'unità NON si sia mossa (ZoC ha fermato sull'hex contestato)
  const after = curr.units[unitId];
  if (!after) return null;
  if (after.position.q !== before.position.q || after.position.r !== before.position.r) return null;
  const defId = curr.moveInProgress.defenderId;
  const def = defId ? curr.units[defId] : undefined;
  if (!def) return null;
  return {
    text: fmt(pick(MOVE_BLOCKED_BY_ZOC, seed), { atk: before.name, def: def.name }),
    tone: 'initiative',
  };
}

function narrateEndTurnMovement(prev: GameState, _curr: GameState, seed: number): NarrationLine {
  void _curr;
  // Riassunto del movimento del turno appena concluso. Prendi unit dal turn order
  // PRECEDENTE (l'END_TURN potrebbe aver bumped currentTurnIdx o triggerato un round).
  const finishedUnitId = prev.turnOrder[prev.currentTurnIdx];
  if (!finishedUnitId) return null;
  const u = prev.units[finishedUnitId];
  if (!u || !u.positionAtTurnStart) return null;
  const start = u.positionAtTurnStart;
  const end = u.position; // posizione attuale (in prev — non cambia in END_TURN)
  const moved = hexDist(start, end);
  if (moved < 1) return null; // statico → niente narrazione

  const enemy = findEnemy(prev, u.faction);
  if (!enemy) return null;
  const distBefore = hexDist(start, enemy.position);
  const distAfter = hexDist(end, enemy.position);
  const closer = distAfter < distBefore;
  const farther = distAfter > distBefore;

  const vars = { atk: u.name, def: enemy.name };

  let pool: string[];
  if (!closer && !farther) {
    pool = MOVE_LATERAL;
  } else if (closer) {
    if (moved === 1) pool = MOVE_APPROACH_1;
    else if (moved <= 3) pool = MOVE_APPROACH_SHORT;
    else pool = MOVE_APPROACH_LONG;
  } else {
    if (moved === 1) pool = MOVE_RETREAT_1;
    else if (moved <= 3) pool = MOVE_RETREAT_SHORT;
    else pool = MOVE_RETREAT_LONG;
  }

  return { text: fmt(pick(pool, seed), vars), tone: 'neutral' };
}

function narrateStartRound(prev: GameState, curr: GameState, seed: number): NarrationLine {
  const firstNow = curr.turnOrder[0];
  if (!firstNow) return null;
  const unitNow = curr.units[firstNow];
  if (!unitNow) return null;

  if (prev.round === 0) {
    return { text: fmt(pick(INIT_FIRST_GAIN, seed), { unit: unitNow.name }), tone: 'initiative' };
  }

  const firstPrev = prev.turnOrder[0];
  if (!firstPrev || firstPrev === firstNow) return null;
  return { text: fmt(pick(INIT_SWAP_GAIN, seed), { unit: unitNow.name }), tone: 'initiative' };
}

function narrateCarica(prev: GameState, _curr: GameState | undefined, amount: number, seed: number): NarrationLine {
  void _curr;
  if (amount <= 0) return null;
  const pa = prev.pendingAction;
  if (!pa) return null;
  const attacker = prev.units[pa.attackerId];
  if (!attacker) return null;
  const pool = amount >= 3 ? CARICA_BIG : CARICA_SMALL;
  return { text: fmt(pick(pool, seed), { atk: attacker.name }), tone: 'initiative' };
}

/**
 * Contenuto del manuale interattivo di hex-tactics.
 *
 * Il testo è strutturato in capitoli, ognuno con paragrafi semplici.
 * Renderizzato dalla `ManualScene` come testo scrollabile con sidebar di indice.
 *
 * Sintassi minima supportata:
 *  - paragrafi normali (testo)
 *  - liste (riga inizia con "- ")
 *  - tabelle: type 'table' con headers + rows
 *  - example box: type 'example' (rendered con bordo distinto)
 *  - heading di sotto-sezione: type 'subheading'
 */

export type ManualBlock =
  | { type: 'p'; text: string }
  | { type: 'list'; items: string[] }
  | { type: 'subheading'; text: string }
  | { type: 'example'; title?: string; lines: string[] }
  | { type: 'table'; headers: string[]; rows: string[][] };

export interface ManualChapter {
  id: string;
  title: string;
  blocks: ManualBlock[];
}

export const MANUAL: ManualChapter[] = [
  {
    id: 'intro',
    title: '1. Cos\'è hex-tactics',
    blocks: [
      {
        type: 'p',
        text: 'Un duello tattico a turni 1 contro 1 su una griglia di esagoni. Due eroi, due fazioni, una sola mappa: chi resta in piedi vince.',
      },
      {
        type: 'p',
        text: 'Non è un gioco di forza bruta. È un gioco di economia (i dadi sono limitati), mind game (le scelte chiave si fanno in segreto e si rivelano insieme) e posizionamento (ogni esagono vale).',
      },
      { type: 'subheading', text: 'Tre cose da tenere a mente' },
      {
        type: 'list',
        items: [
          'Ogni dado che spendi adesso è un dado che non avrai dopo. Tirare in più aumenta le chance ora ma riduce la capacità di reagire al turno avversario.',
          'Le scelte chiave sono simultanee e private. Tu decidi quanto attaccare mentre l\'altro decide come difendersi: nessuno vede le carte dell\'altro fino alla rivelazione.',
          'Le difese si pagano coi tuoi dadi azione. Schivare e parare costano: troppi attacchi nel turno avversario ti svuotano il pool anche senza farti danni diretti.',
        ],
      },
    ],
  },

  {
    id: 'unit',
    title: '2. Anatomia di un\'unità',
    blocks: [
      {
        type: 'p',
        text: 'Ogni eroe ha le seguenti statistiche di partenza (baseline):',
      },
      {
        type: 'table',
        headers: ['Stat', 'Valore', 'Cosa fa'],
        rows: [
          ['HP', '20', 'Vita. A 0 sei fuori.'],
          ['Forza / Agilità / Volontà', '2 / 2 / 2', 'Determinano la "dimensione" del pool dadi azione e quali skill puoi attivare.'],
          ['Impeto', '14*', 'Determina chi gioca prima nel round. Più alto → giochi prima. *Baseline 14, ma all\'inizio della battaglia parti col MAX teorico del tuo tiro slancio. CAP DINAMICO: impeto_max = HP_attuali + impeto_iniziale (chi è ferito perde anche iniziativa).'],
          ['Slancio', '0', 'Energia cinetica. Si spende per muoversi e biddare. Diventa impeto a inizio del tuo turno successivo.'],
          ['Dadi azione', '6', 'Risorsa primaria per attaccare, parare, schivare, ricaricare. Si recupera in parte ogni turno.'],
        ],
      },
      {
        type: 'p',
        text: 'Equipaggiamento: arma principale (mano), offhand (seconda arma o scudo o mano vuota), armatura.',
      },
      {
        type: 'p',
        text: 'Niente classi: la differenza tra un personaggio e l\'altro è come spendi i 2000 punti esperienza in equipaggiamento e skill (vedi cap. 11).',
      },
    ],
  },

  {
    id: 'round-turn',
    title: '3. Il round e il turno',
    blocks: [
      {
        type: 'p',
        text: 'Una battaglia è una sequenza di round. Un round è una sequenza di turni — uno per ogni unità ancora viva.',
      },
      { type: 'subheading', text: 'Ordine di iniziativa' },
      {
        type: 'p',
        text: 'A inizio round i giocatori vengono ordinati per impeto decrescente (chi ha impeto più alto gioca prima). In caso di parità si guarda lo slancio, e se anche quello è uguale si tira a sorte.',
      },
      {
        type: 'p',
        text: 'L\'impeto è il timing: chi lo gestisce meglio prende l\'iniziativa nei momenti decisivi.',
      },
      { type: 'subheading', text: 'Le fasi del turno' },
      {
        type: 'list',
        items: [
          'Recovery dadi azione: recuperi ⌊(F+A+V)/2⌋ dadi (baseline = 3). Cap totale 9.',
          'Slancio → impeto: il tuo slancio attuale si somma all\'impeto.',
          'Tiro slancio: scegli quanti dadi tirare (0, 1 o 2). Il risultato sostituisce il tuo slancio.',
          'Movimento e azione (in qualunque ordine): muoviti spendendo slancio, e/o esegui un\'azione.',
          'Fine turno: passa al successivo.',
        ],
      },
      {
        type: 'example',
        title: 'Esempio',
        lines: [
          'Spadaccino ha impeto 14, slancio 5.',
          'Inizio turno: impeto diventa 14+5 = 19.',
          'Tira 2 dadi slancio → 4+3+2 = 9. Slancio nuovo = 9.',
          'Può muoversi 9 esagoni (più 1 gratis) e/o attaccare.',
        ],
      },
    ],
  },

  {
    id: 'resources',
    title: '4. Le tre risorse',
    blocks: [
      {
        type: 'p',
        text: 'Sono i tre indicatori che dovresti tenere d\'occhio in continuazione: dadi azione, slancio, impeto.',
      },
      { type: 'subheading', text: 'Dadi azione (immediato)' },
      {
        type: 'p',
        text: 'Ti servono per fare cose: attaccare, schivare, parare, ricaricare. Recovery: ⌊(F+A+V)/2⌋ = 3 al turno (baseline). Cap totale 9.',
      },
      {
        type: 'p',
        text: 'Trade-off chiave: più ne spendi nel tuo turno per attaccare, meno te ne restano per difenderti nel turno avversario.',
      },
      { type: 'subheading', text: 'Slancio (mobilità + iniziativa)' },
      {
        type: 'p',
        text: 'Energia cinetica. Si spende per movimento (1 esagono gratis, +1 sl per esagono successivo) e per biddare nelle aste. A inizio del prossimo turno si somma all\'impeto.',
      },
      {
        type: 'p',
        text: 'Trade-off: tirare 2 dadi slancio costa 2 dadi azione, ma garantisce mobilità + impeto futuro. Tirare 0 non costa niente, ma resti immobile e giochi tardi nel round seguente.',
      },
      { type: 'subheading', text: 'Impeto (timing)' },
      {
        type: 'p',
        text: 'Determina quando giochi nel round. Si modifica con: lo slancio del round precedente (si somma); danni ricevuti (lo slancio scende sotto 0 → l\'eccesso si sottrae a impeto).',
      },
      {
        type: 'p',
        text: 'Quando l\'impeto va a 0, il recovery dadi è cappato a 1/turno: sei in disperazione operativa.',
      },
      { type: 'subheading', text: 'Cap dinamico impeto (2026-05-05)' },
      {
        type: 'p',
        text: 'L\'impeto non cresce all\'infinito. Cap massimo dinamico = HP_attuali + impeto_iniziale. Esempio: arciere baseline (impeto iniziale 21, HP max 20) ha cap 41 quando pieno HP, scende a 26 quando perde 15 HP.',
      },
      {
        type: 'p',
        text: 'Effetti di design: chi sta subendo danni perde anche potenziale di iniziativa (snowball). Inoltre rende sub-ottimale "fuggire e accumulare impeto" — oltre il cap il transfer è inutile, conviene attaccare.',
      },
      { type: 'subheading', text: 'Transfer impeto → slancio (a inizio turno)' },
      {
        type: 'p',
        text: 'Subito dopo aver tirato lo slancio, puoi spostare punti dall\'impeto allo slancio (1:1, gratis). È una scelta tattica: più impeto = giochi prima nei round successivi, più slancio = più mobilità + scudo passivo contro ranged.',
      },
      {
        type: 'list',
        items: [
          'Cap massimo trasferibile: min(impeto attuale, max tiro slancio possibile).',
          'Lo slider in-game mostra solo il cap GARANTITO (anche col tiro più fortunato, il transfer rientra completamente).',
          'Il reducer fa clamp finale automatico: se metti più del fattibile post-tiro, viene tagliato silenziosamente.',
        ],
      },
      {
        type: 'example',
        title: 'Esempio',
        lines: [
          'Spadaccino con impeto 14, slancio 0. Sceglie 1 dado slancio → tira al massimo 8.',
          'Cap garantito = min(14, 14−8) = 6. Lo slider mostra max 6.',
          'Sceglie transfer 6: impeto 14→8, slancio passa al post-tiro+6.',
        ],
      },
    ],
  },

  {
    id: 'movement',
    title: '5. Movimento',
    blocks: [
      { type: 'p', text: 'Si misura in esagoni.' },
      {
        type: 'list',
        items: [
          'Il primo esagono ogni turno è gratis (0 slancio).',
          'Ogni esagono successivo costa 1 punto slancio.',
          'Il movimento è in linea retta — il path tra due punti viene calcolato dal motore.',
          'Non puoi finire su un esagono occupato dalla basetta avversaria.',
        ],
      },
      {
        type: 'example',
        title: 'Esempio',
        lines: [
          'Hai slancio 4. Puoi muoverti fino a 5 esagoni (1 gratis + 4 pagati).',
          'Se ne fai solo 3, finisci con slancio 4 - 2 = 2.',
        ],
      },
      { type: 'p', text: 'Conversione: 1 esagono = 0.5 m. Una "portata 2 m" significa 4 esagoni.' },
    ],
  },

  {
    id: 'roll-architecture',
    title: '6. Architettura del tiro',
    blocks: [
      {
        type: 'p',
        text: 'Questa sezione è la più importante del manuale. Capisci questa, capisci tutti i combattimenti.',
      },
      { type: 'subheading', text: 'Variabile vs Fissa' },
      {
        type: 'list',
        items: [
          'VARIABILE: la somma dei d6 tirati − impedimento del PG che tira. Casuale ma con malus garantito. Floor a 0: se l\'imp eccede i dadi, il valore diventa 0 e |negativo| si sottrae allo SLANCIO del PG.',
          'FISSA: la somma dei bonus statici NON dipendenti dal tiro stocastico (es. il +2 base PG, il bonus arma, le skill +1 al tiro, bonus carica, scudo passivo). Può essere negativa.',
        ],
      },
      { type: 'p', text: 'Total tiro = variabile (post-imp, floor 0) + fissa.' },
      { type: 'subheading', text: 'Le difese non sono uguali' },
      {
        type: 'list',
        items: [
          'Schivata: confronta la VARIABILE attaccante (post-imp). Se la schivata è MAGGIORE della variabile, l\'attacco è completamente NEGATO (tutto, anche la fissa).',
          'Schivata: se è MINORE, la differenza (variabile − schivata) si somma alla fissa attaccante e produce il danno residuo.',
          'Parata: morde il TOTALE attaccante (variabile + fissa). Se la parata batte il totale, l\'attacco è bloccato.',
        ],
      },
      { type: 'subheading', text: 'Slancio loss da schivata/parata fallita' },
      {
        type: 'p',
        text: 'Se l\'attaccante "perde" (residuo ≤ 0), |residuo| viene sottratto al SUO slancio. Inoltre, se l\'imp del PG ha portato la variabile sotto 0, il negativo si converte ANCHE in slancio loss aggiuntivo.',
      },
      {
        type: 'example',
        title: 'Esempio',
        lines: [
          'Spadaccino attacca con spada lunga 2h (1d6+6, imp 6), 2 dadi PG.',
          'Tira 2d6 PG + 1d6 spada = 12 dadi totali; +2 PG +6 spada = 8 fissa.',
          'Variabile = 12 − 6 (imp) = 6 (floor non scatta, dadi alti). Fissa = 8. Totale 14.',
          'Difensore schiva 2 dadi: 2d6+2 = 9 totale.',
          '9 < 6? NO, 9 > 6 → SCHIVATA RIESCE! 0 danni. Attaccante perde 9−6=3 slancio.',
          'Se invece avesse tirato 1d6 PG + 1d6 spada = 5 dadi totali, var=5−6=−1 → floor 0, slancio−=1.',
        ],
      },
      { type: 'subheading', text: 'Armi a 2 mani: +1 dado dalla riserva' },
      {
        type: 'p',
        text: 'Con un\'arma impugnata a 2 mani (spada lunga 2h, ascia 2h, lancia 3m, arco lungo) il PG può attingere fino a 1 dado in più dalla sua riserva: il cap dei dadi PG passa da 1-2 a 1-3 (sia in attacco che in parata). NON modifica i bonus fissi né i dadi propri dell\'arma — solo il cap della tua scelta di dadi PG.',
      },
      { type: 'subheading', text: 'Implicazione di design' },
      {
        type: 'list',
        items: [
          'Armi a fisso puro (mazza, balestra) sono devastanti se passano, ma molto schivabili: la schivata blocca tutto se vince.',
          'L\'impedimento ora morde la variabile → un PG ingombro è ancora più vulnerabile alle schivate (variabile più bassa → schivata vince più spesso).',
          'Ridurre impedimento è doppiamente prezioso: aumenta il danno passante E rende l\'attacco più affidabile contro la schivata.',
          'Le armi 2h pagano in impedimento (più alto) ma offrono il bonus "+1 dado riserva" → variabile più alta in attacco e parata.',
        ],
      },
    ],
  },

  {
    id: 'melee',
    title: '7. Combattimento mischia',
    blocks: [
      { type: 'subheading', text: 'Sequenza' },
      {
        type: 'list',
        items: [
          'Dichiarazione: l\'attaccante dichiara su chi attacca, con quale arma, in quale modo.',
          'Scelte simultanee private: l\'attaccante sceglie quanti dadi tirare, il difensore sceglie tipo di difesa + dadi. Nessuno vede l\'altro.',
          'Risoluzione: si applicano le formule (vedi cap. 6 e 9).',
          'Conseguenze: se passa → danno (riduzione armatura). Se bloccato → l\'attaccante perde slancio pari al residuo della difesa.',
        ],
      },
      { type: 'subheading', text: 'Range della mischia' },
      {
        type: 'list',
        items: [
          'Default: adiacenza. L\'arma colpisce solo nemici a 1 hex.',
          'Armi con portata (spada lunga 1m=2 hex, lancia 2m=4 hex, lancia 3m=6 hex): puoi colpire più lontano.',
        ],
      },
    ],
  },

  {
    id: 'ranged',
    title: '8. Combattimento a distanza',
    blocks: [
      {
        type: 'p',
        text: 'Le armi a distanza non si possono parare né schivare attivamente: il difensore non può spendere dadi per evitarle. La sopravvivenza si gioca sul tuo slancio, scudo, e armatura.',
      },
      { type: 'subheading', text: 'Linea di vista (LoS)' },
      {
        type: 'p',
        text: 'Ogni unità occupa una basetta da 7 esagoni (1 centrale + 6 corona). Quando spari:',
      },
      {
        type: 'list',
        items: [
          'Si tracciano linee di vista da ognuno dei 7 esagoni della tua basetta verso ognuno dei 7 del bersaglio (49 linee).',
          'Le altre unità vive bloccano la LoS se si trovano sul percorso.',
          'Si conta la visibilità: numero di centri target visti (0–7).',
          'Se visibilità = 0 → non puoi sparare.',
          'L\'esagono di partenza usato è quello con la migliore LoS (max visibilità).',
        ],
      },
      { type: 'subheading', text: 'Formula del tiro' },
      {
        type: 'p',
        text: 'Risultato = 1-2 d6 + 2 + bonus_arma + visibilità − ⌊distanza / N⌋ − slancio_target − impedimento − hex_mossi',
      },
      {
        type: 'p',
        text: 'Note: lo scudo del difensore sottrae passivamente il suo bonus parry. L\'armatura sottrae la sua riduzione danno. Nessuna gittata massima — il malus distanza decresce gradualmente con N (es. arco_lungo N=2: −1 ogni 2 hex).',
      },
      { type: 'subheading', text: 'Malus movimento (kite-and-shoot)' },
      {
        type: 'p',
        text: 'Se ti muovi prima di sparare nello stesso turno, ricevi −1 al tiro per ogni hex mosso. Aggressivo: anche 1 hex costa 1. L\'arciere deve scegliere tra muoversi (per posizionamento) e tirare bene (stando fermo).',
      },
      { type: 'subheading', text: 'Armi da lancio: SINGLE USE' },
      {
        type: 'p',
        text: 'Pugnale, ascia 1h, lancia 2m, giavellotto sono armi da MISCHIA che si possono LANCIARE come ranged (throw). Una volta lanciate, l\'arma è PERSA — il PG resta disarmato (può ancora attaccare con offhand se ce l\'ha). Diverso da archi/balestra che hanno reload.',
      },
      { type: 'subheading', text: 'Setup: archi e balestra partono SCARICHI' },
      {
        type: 'p',
        text: 'All\'inizio della battaglia gli archi e le balestre arrivano scarichi. Devi spendere un\'azione di RICARICA prima di poter sparare.',
      },
      { type: 'subheading', text: 'Ricarica via slancio' },
      {
        type: 'p',
        text: 'Ricaricare un arco/balestra costa SLANCIO (non un dado azione, e non consuma l\'azione del turno). Quindi puoi reload+spara nello stesso turno se hai abbastanza slancio.',
      },
      {
        type: 'table',
        headers: ['Arma', 'Costo slancio'],
        rows: [
          ['Arco corto', '6'],
          ['Arco lungo', '9'],
          ['Balestra', '12'],
        ],
      },
      {
        type: 'example',
        title: 'Esempio',
        lines: [
          'Arciere round 1: parte con arco lungo scarico, slancio iniziale 16.',
          'RELOAD: paga 9 slancio → slancio = 7, arco caricato.',
          'MOVE 4 hex (1 gratis + 3 sla): slancio = 4. Hex_mossi = 4.',
          'DECLARE_RANGED 2d (arco_lungo è 2h → cap PG 1-3): variabile = 2d PG + 2d arma + bonus visibilità + bonus arma 6, malus distanza ⌊d/2⌋, malus mov ⌊4/2⌋=2.',
        ],
      },
      { type: 'p', text: 'Trade-off del bersaglio: tenere slancio alto ti protegge dal ranged ma costa dadi azione.' },
      { type: 'subheading', text: 'D-049: Niente ranged sotto minaccia melee' },
      {
        type: 'p',
        text: 'Se hai un nemico in mischia (basetta adiacente) con slancio > 0, NON puoi sparare con armi ranged in quel turno. La regola riflette il fatto che il nemico ti molesta e non ti permette di prendere la mira.',
      },
      {
        type: 'list',
        items: [
          'Eccezione: se il nemico melee ha slancio = 0 (esaurito), puoi sparare normalmente.',
          'Soluzione: muoviti per uscire dalla zona melee (anche solo 2 hex bastano), poi spara — tutto nello stesso turno.',
          'Le armi tipo giavellotto/lancia 2m (che hanno sia melee che ranged) sono libere per lo stile melee.',
        ],
      },
    ],
  },

  {
    id: 'defenses',
    title: '9. Schivata vs parata',
    blocks: [
      { type: 'subheading', text: 'Il "+2" base nei tiri' },
      {
        type: 'p',
        text: 'Tutti i tiri del PG hanno un +2 fisso di base, applicato direttamente alla parte FISSA. Rappresenta competenza minima. Vale per attacco, schivata, parata, slancio, ricarica.',
      },
      { type: 'subheading', text: 'Schivata' },
      {
        type: 'list',
        items: [
          'Costo: 1-2 dadi azione.',
          'Tiro: 1-2 d6 + 2 (base) + skill "+1 al tiro [schivare]" (ognuna +1 per livello) − impedimento del difensore (sulla variabile).',
          'Effetto: confronto sulla parte VARIABILE attaccante. Se schivata > variabile → tutto negato (anche la fissa). Se ≤ → la differenza si somma alla fissa attaccante, produce il danno.',
          'Quando: contro armi a fisso puro (mazza, balestra) → devastante. Contro PG ingombri → ancora più efficace (imp morde la variabile attaccante).',
          'Schivi anche con le mani vuote.',
        ],
      },
      { type: 'subheading', text: 'Parata' },
      {
        type: 'list',
        items: [
          'Costo: 1-2 dadi azione + arma o scudo idoneo (parry !== null).',
          'Tiro: 1-2 d6 + 2 (base) + bonus parry dell\'arma/scudo + skill "+1 al tiro [parare]" (ognuna +1 per livello) − impedimento del difensore (sulla variabile).',
          'Effetto: sottrae al TOTALE attaccante (variabile + fissa).',
          'Quando: contro armi a dadi propri (spada, arco) o se HP basso (riduce variance).',
        ],
      },
      { type: 'subheading', text: 'Skill rilevanti per la difesa' },
      {
        type: 'list',
        items: [
          '+1 al tiro [schivare]: ogni livello aggiunge +N al tiro di schivata. Es. lv 2 = +2.',
          '+1 al tiro [parare] [scudi]: ogni livello aggiunge +N solo se pari con uno scudo.',
          '+1 dado [schivare]: tiri sempre 1 dado in più. Costoso ma forte.',
          '+1 dado massimo [schivare]: alza il tetto a 3 dadi. Paghi solo se decidi di usarlo.',
        ],
      },
      { type: 'subheading', text: 'Niente difesa' },
      {
        type: 'p',
        text: 'Costo: 0 dadi. Effetto: tutto il tiro attaccante passa (poi attenuato dall\'armatura). Da scegliere se sei a 0 dadi o stai investendo nel tuo prossimo attacco.',
      },
    ],
  },

  {
    id: 'equipment',
    title: '10. Equipaggiamento',
    blocks: [
      { type: 'subheading', text: 'Armi' },
      {
        type: 'table',
        headers: ['Arma', 'ATK', 'DIF', 'Imp', 'Note'],
        rows: [
          ['Pugnale', '1d6+2', '1d6', '0', 'lancio 0.5m'],
          ['Spada', '1d6+2/+2', '1d6+2', '3', 'F/A condizionato'],
          ['Spada lunga 1h', '1d6+2', '1d6+6', '6', 'reach 1m'],
          ['Spada lunga 2h', '1d6+6', '1d6+6', '6', 'reach 1m, +1d riserva (2h)'],
          ['Mazza', '+9', '+3', '3', 'solo fissa'],
          ['Ascia 1h', '1d6+6', '+3', '3', 'lancio 0.5m'],
          ['Ascia 2h', '1d6+15', '+3', '6', '+1d riserva (2h)'],
          ['Lancia 2m', '2d6', '+3', '3', 'lancio 1m, reach 2m'],
          ['Lancia 3m', '2d6+4', '+1', '6', 'reach 3m, +1d riserva (2h)'],
          ['Giavellotto', '+6', '+1', '3', 'lancio 1.5m'],
          ['Arco corto', '1d6+6', '–', '3', 'N=4, reload 6 sla'],
          ['Arco lungo', '2d6+6', '–', '6', 'N=5, reload 9 sla, +1d riserva (2h)'],
          ['Balestra', '+15', '–', '3', 'N=3, reload 12 sla'],
        ],
      },
      {
        type: 'p',
        text: 'Note: gli archi e la balestra partono SCARICHI all\'inizio della battaglia. Il "reload N sla" è il costo in slancio per ricaricarli (paga solo lo slancio, non l\'azione del turno → reload+spara nello stesso turno è possibile).',
      },
      { type: 'subheading', text: 'Scudi' },
      {
        type: 'table',
        headers: ['Scudo', 'ATK', 'DIF', 'Imp'],
        rows: [
          ['Piccolo', '+4', '1d6+4', '3'],
          ['Medio', '+8', '1d6+8', '6'],
          ['Pesante', '+8', '1d6+12', '9'],
        ],
      },
      { type: 'subheading', text: 'Armature' },
      {
        type: 'table',
        headers: ['Armatura', 'RD', 'Imp'],
        rows: [
          ['Leggera', '3', '3'],
          ['Media', '6', '6'],
          ['Pesante', '12', '9'],
        ],
      },
      { type: 'subheading', text: 'Impedimento (V2)' },
      {
        type: 'p',
        text: 'L\'impedimento di tutti i pezzi indossati si somma e viene sottratto alla parte VARIABILE di OGNI tiro del PG (attacchi, schivate, parate, slancio). È il prezzo del peso.',
      },
      {
        type: 'list',
        items: [
          'La variabile post-impedimento ha floor a 0: non può essere negativa nel risultato del tiro.',
          'Se l\'impedimento eccede la somma dei dadi, il |negativo| viene sottratto allo SLANCIO del PG che ha tirato (penalty cumulativa).',
          'Lo slancio sotto 0 propaga: l\'eccesso si sottrae all\'impeto (regola standard).',
        ],
      },
      {
        type: 'p',
        text: 'Conseguenza pratica: PG molto ingombri sono doppiamente vulnerabili — variabile ridotta = schivate riescono più spesso, e ogni tiro sfortunato erode lo slancio. Ridurre impedimento è la skill più "efficiente" per ogni build seria.',
      },
      {
        type: 'p',
        text: 'La skill "−1 impedimento" si applica per pezzo (con floor 0 per pezzo). Senza specializzazioni vale per tutti i pezzi. Specializzata per [classe oggetto] (es. armature) o [oggetto specifico] (es. scudo medio) limita l\'effetto. Cumulabile via livelli (lv N = riduce N).',
      },
    ],
  },

  {
    id: 'skills',
    title: '11. Skill system',
    blocks: [
      { type: 'p', text: 'Hai 2000 punti esperienza da spendere prima della battaglia. Le skill sono il vero levellamento del PG.' },
      { type: 'subheading', text: 'I 4 modificatori (costo BASE lv1, no specializzazioni)' },
      {
        type: 'table',
        headers: ['Skill', 'Costo base', 'Effetto base (lv 1)'],
        rows: [
          ['−1 impedimento', '100 exp', 'Riduce di 1 l\'impedimento di OGNI pezzo dell\'equip (floor 0 per pezzo).'],
          ['+1 al tiro', '600 exp', 'Aggiunge +1 alla parte FISSA dei tiri che matchano le specializzazioni.'],
          ['+1 dado', '3600 exp', 'Tiri SEMPRE 1 dado in più nei tiri matchanti (forzato).'],
          ['+1 dado massimo', '1200 exp', 'Il tetto dei dadi scelti dal PG sale di 1 (es. da 2 a 3). Paghi solo se decidi di usarlo.'],
        ],
      },
      { type: 'subheading', text: 'Effetto del livello (lv up)' },
      {
        type: 'p',
        text: 'Una skill di livello N produce effetto N volte. Es. "−1 imp" lv 3 → riduce 3 imp per pezzo. "+1 al tiro" lv 2 → +2 fissa.',
      },
      {
        type: 'p',
        text: 'Costo del lv up: ogni livello RADDOPPIA il costo del livello precedente. Cumulativo per arrivare a lv N: cost_lv1 + cost_lv2 + ... + cost_lvN = base × (2^N − 1).',
      },
      {
        type: 'table',
        headers: ['Modifier', 'lv1', 'lv2', 'lv3', 'lv4', 'lv5'],
        rows: [
          ['−1 imp (no spec)', '100', '+200=300', '+400=700', '+800=1500', '+1600=3100'],
          ['+1 tiro (no spec)', '600', '+1200=1800', '+2400=4200', '–', '–'],
          ['+1 dado (no spec)', '3600', '+7200=10800', '–', '–', '–'],
          ['+1 d max (no spec)', '1200', '+2400=3600', '+4800=8400', '–', '–'],
        ],
      },
      { type: 'subheading', text: 'Specializzazioni — DIMEZZANO il costo' },
      { type: 'p', text: 'Ogni skill può essere combinato con fino a 1 parola per lista (max 4 parole):' },
      {
        type: 'list',
        items: [
          'Abilità: forza, agilità, volontà',
          'Azioni: attaccare, parare, schivare, slancio, ricaricare',
          'Classe oggetto: spade, scudi, armature, lance, asce, archi, balestre, …',
          'Oggetto specifico: spada lunga, scudo medio, arco corto, ecc.',
        ],
      },
      {
        type: 'p',
        text: 'Ogni specializzazione DIMEZZA il costo (cumulativo): 1 spec → /2, 2 spec → /4, 3 spec → /8, 4 spec → /16. La specializzazione restringe l\'applicabilità: la skill produce effetto SOLO nei tiri che matchano TUTTE le sue parole.',
      },
      {
        type: 'example',
        title: 'Esempio costo specializzato',
        lines: [
          '+1 al tiro = 600 (base lv1)',
          '+1 al tiro [attaccare] = 600/2 = 300',
          '+1 al tiro [attaccare] [spade] = 600/4 = 150',
          '+1 al tiro [forza] [attaccare] [spade] = 600/8 = 75',
          'Spinto a lv 3: 75 + 150 + 300 = 525 exp totali per +3 al tiro su attacchi spada in forza.',
        ],
      },
      { type: 'subheading', text: 'Vincolo unicità' },
      {
        type: 'p',
        text: 'Non puoi acquistare due skill IDENTICHE (stesso modifier + stesse 4 parole di specializzazione). Per cumulare devi salire di livello (skill diventa lv N+1) o cambiare almeno una specializzazione.',
      },
      {
        type: 'p',
        text: 'Strategia: build da torneo investono ~600-900 exp in "−1 imp [armature]" lv 2-3 + ~1100 exp in 1-2 skill da combat specializzate. Build creative possono mixare.',
      },
    ],
  },

  {
    id: 'advanced',
    title: '12. Meccaniche avanzate',
    blocks: [
      { type: 'subheading', text: '12.1 Carica' },
      {
        type: 'p',
        text: 'L\'idea: avvicinarsi al nemico in carica deve dare un vantaggio.',
      },
      {
        type: 'list',
        items: [
          'Ogni esagono di avvicinamento al target durante il turno = un punto carica disponibile.',
          'Quando dichiari l\'attacco mischia (o lancio), scegli quanti punti carica usare: 0..min(delta, slancio attuale).',
          'Ogni punto carica = +1 alla parte fissa dell\'attacco, ma costa 1 punto slancio.',
        ],
      },
      { type: 'p', text: 'Non si applica a armi puramente ranged (archi, balestra).' },
      { type: 'subheading', text: '12.2 Posizione difensiva' },
      {
        type: 'p',
        text: 'L\'idea: lo scudo non è solo per parare attivamente — è anche un muro fisico.',
      },
      {
        type: 'list',
        items: [
          'Se hai uno scudo in offhand, durante choosing-action puoi attivare la posizione difensiva (azione gratuita, max 1 toggle/turno).',
          'In stance: lo scudo aggiunge 2× il suo bonus parry alla riduzione danno passiva (CaC e ranged). L\'impedimento dello scudo raddoppia.',
          'Disattivi la stance con un altro toggle.',
        ],
      },
      { type: 'p', text: 'Trade-off: l\'imp dello scudo raddoppiato erode tutti i tuoi tiri. La stance è una scelta strategica per turno, non un default.' },
      { type: 'subheading', text: '12.3 Asta movimento (zona di controllo) — V2 universale' },
      {
        type: 'p',
        text: 'L\'idea: chi impugna un\'arma da mischia minaccia un\'area attorno a sé. Per attraversare quella zona devi "battere il bid".',
      },
      {
        type: 'list',
        items: [
          'Trigger: ogni esagono che il mover vuole occupare, se è entro reach di un nemico vivo con slancio > 0 e un\'arma melee equipaggiata, scatta un\'asta separata.',
          'Tu (mover) e il difensore scegliete simultaneamente in privato una puntata in slancio (0..slancio attuale).',
          'bid_atk ≥ bid_def → tu passi l\'esagono (parità → atk vince). Altrimenti il movimento si ferma all\'esagono precedente.',
          'Entrambi pagano la propria puntata in slancio, indipendentemente da chi vince.',
        ],
      },
      { type: 'subheading', text: 'Reach delle armi (V2: TUTTE le melee triggerano)' },
      {
        type: 'table',
        headers: ['Arma', 'Reach hex', 'Note'],
        rows: [
          ['Disarmato (mani vuote)', '0', 'NIENTE asta — solo contatto basetta'],
          ['Pugnale, spada, mazza, ascia 1h, ascia 2h', '1', '0.5m — asta sì, area = 6 esagoni'],
          ['Spada lunga (1h e 2h), giavellotto', '2', '1.0m — area più ampia'],
          ['Lancia 2m', '4', '2.0m — area dominante'],
          ['Lancia 3m', '6', '3.0m — area enorme'],
          ['Arco / balestra (senza secondaria melee)', '–', 'NIENTE asta — chi ha solo ranged è "disarmato in mischia"'],
        ],
      },
      {
        type: 'p',
        text: 'Mind game puro: nessun dado tirato. Più reach = più esagoni minacciati = più aste possibili = più slancio bruciato dall\'attaccante per chiudere la distanza.',
      },
      {
        type: 'p',
        text: 'Implicazione: una spada lunga (reach 2) tiene a bada un pugnale (reach 1) — entrambi attivano l\'asta, ma il pugnale deve attraversare la zona della spada lunga senza poter colpire prima. Le aste si applicano indipendentemente dal confronto reach.',
      },
    ],
  },

  {
    id: 'strategy',
    title: '13. Strategie e build',
    blocks: [
      { type: 'subheading', text: 'Spadaccino offensivo' },
      {
        type: 'p',
        text: 'Spada lunga 2h + armatura media. Forza: alta variabile + bonus condizionato. Funziona contro arciere (in mischia). Debolezza: niente scudo → vulnerabile al ranged.',
      },
      { type: 'subheading', text: 'Tank' },
      {
        type: 'p',
        text: 'Mazza + scudo medio + armatura media. Forza: parate quasi imbattibili. Sopravvive a tutto. Debolezza: senza skill mobilità è una statua. Skill chiave: −1 imp × N + +1 tiro [parare] + +1 dado max [slancio].',
      },
      { type: 'subheading', text: 'Arciere' },
      {
        type: 'p',
        text: 'Arco lungo + pugnale offhand + armatura leggera. Forza: ranged dominante a distanza. Debolezza: in mischia perde quasi sempre. Skill chiave: +1 tiro [attaccare][archi] + +1 dado max [slancio].',
      },
      { type: 'subheading', text: 'Decisioni runtime' },
      {
        type: 'list',
        items: [
          'Atk dice 1 vs 2: 1=risparmio, 2=affidabile ma esponi il turno dopo.',
          'Schivata vs parata: avversario fisso-puro (mazza, balestra) → schivata. Avversario con dadi propri (spada, arco) → parata. HP basso → parata.',
          'Spendere slancio o tenerlo: mobilità ora se devi chiudere/fuggire. Tenerlo se l\'avversario è arciere.',
        ],
      },
      { type: 'subheading', text: 'Counter-ranged: come battere l\'arciere' },
      {
        type: 'p',
        text: 'L\'arco è devastante a distanza, ma c\'è una contro-strategia precisa che lo neutralizza.',
      },
      {
        type: 'list',
        items: [
          '1) A inizio turno tira SLANCIO MAX (2 dadi). Lo slancio_target sottrae direttamente al tiro ranged: arciere.tiro − tuo_slancio.',
          '2) USA IL TRANSFER IMPETO→SLANCIO: dopo aver tirato slancio, sposta punti dall\'impeto allo slancio. Così hai slancio sempre al massimo (es. 14) anche dopo aver mosso.',
          '3) Chiudi distanza con CARICA: ogni esagono di avvicinamento ti dà +1 fissa al prossimo attacco (consuma slancio ma ne hai accumulato).',
          '4) Quando arrivi in mischia, l\'arco è bloccato da D-049 (vedi cap 8). L\'arciere è obbligato a fuggire o passare turno.',
        ],
      },
      {
        type: 'p',
        text: 'Equipaggiamento ottimale anti-ranged: armatura pesante (RD 12 assorbe il colpo) + scudo medio in stance difensiva (raddoppia parry passive contro ranged).',
      },
    ],
  },
];

export function getChapter(id: string): ManualChapter | undefined {
  return MANUAL.find((c) => c.id === id);
}

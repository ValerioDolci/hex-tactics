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
          ['Impeto', '14', 'Determina chi gioca prima nel round. Più alto → giochi prima.'],
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
          'VARIABILE: la somma dei d6 tirati. Casuale.',
          'FISSA: la somma di tutti i bonus statici (es. il +2 base, il bonus dell\'arma, le skill +1, meno l\'impedimento).',
        ],
      },
      { type: 'p', text: 'Total tiro = variabile + fissa.' },
      { type: 'subheading', text: 'Le difese non sono uguali' },
      {
        type: 'list',
        items: [
          'Schivata: morde solo la VARIABILE. Se schivi, blocchi i dadi tirati ma il fisso passa lo stesso (se positivo).',
          'Parata: morde il TOTALE. Se pari abbastanza, blocchi tutto.',
        ],
      },
      {
        type: 'example',
        title: 'Esempio',
        lines: [
          'Spadaccino attacca con spada lunga, 2 dadi PG.',
          'Variabile = 3d6 (2 PG + 1 spada) = 12. Fissa = 2 + 2 spada − 6 imp = −2. Totale 10.',
          'Difensore schiva con 2 dadi: tira 2d6+2 = 9. Sottrae al variabile: 12−9=3 > 0 → l\'attacco passa con 3 + (−2) = 1 danno.',
          'Se invece avesse parato con scudo medio (+8 fisso): tira 1d6+2+8 = 13. Sottrae al totale: 10−13 = −3 → parato! L\'attaccante perde 3 di slancio.',
        ],
      },
      { type: 'subheading', text: 'Implicazione di design' },
      {
        type: 'list',
        items: [
          'Armi a fisso puro (mazza, balestra) sono devastanti se passano, ma molto schivabili: la schivata blocca tutto se vince.',
          'Armi a molti dadi (spada lunga, arco lungo) sono più affidabili (i dadi propri portano il tiro sopra), ma se parate possono andare a zero.',
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
        text: 'Risultato = 1-2 d6 + 2 + bonus_arma + visibilità − ⌊distanza / N⌋ − slancio_target − impedimento',
      },
      {
        type: 'p',
        text: 'Lo scudo del difensore (se ha) sottrae passivamente il suo bonus parry. L\'armatura del difensore sottrae la sua riduzione danno.',
      },
      {
        type: 'example',
        title: 'Esempio',
        lines: [
          'Arciere con arco lungo (1d6+6, N=5) tira a tank a 8 hex con slancio 0, scudo medio (+8), armatura media (RD 6).',
          'Tiro: 3d6 + 2 + 6 + 4 (vis) − 1 (dist) − 0 − 8 (scudo) − 6 (RD) − 3 (imp) = ~4.5 di danno medio.',
          'Lo stesso tank con slancio 8: 4.5 − 8 = −3.5 → l\'attacco fallisce in media.',
        ],
      },
      { type: 'p', text: 'Trade-off del bersaglio: tenere slancio alto ti protegge dal ranged ma costa dadi azione.' },
    ],
  },

  {
    id: 'defenses',
    title: '9. Schivata vs parata',
    blocks: [
      { type: 'subheading', text: 'Schivata' },
      {
        type: 'list',
        items: [
          'Costo: 1-2 dadi azione.',
          'Tiro: 1-2 d6 + 2 + skill +1 al tiro [schivare].',
          'Effetto: sottrae alla parte VARIABILE.',
          'Quando: contro armi a fisso puro (mazza, balestra) → devastante. Contro armi a dadi propri → meno efficace.',
          'Schivi anche con le mani vuote.',
        ],
      },
      { type: 'subheading', text: 'Parata' },
      {
        type: 'list',
        items: [
          'Costo: 1-2 dadi azione + arma o scudo idoneo (parry !== null).',
          'Tiro: 1-2 d6 + 2 + bonus parry dell\'arma/scudo + skill.',
          'Effetto: sottrae al TOTALE.',
          'Quando: contro armi a dadi propri (spada, arco) o se HP basso (riduce variance).',
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
          ['Spada lunga 2h', '1d6+6', '1d6+6', '6', 'reach 1m'],
          ['Mazza', '+9', '+3', '3', 'solo fissa'],
          ['Ascia 1h', '1d6+6', '+3', '3', 'lancio 0.5m'],
          ['Ascia 2h', '1d6+15', '+3', '6', '–'],
          ['Lancia 2m', '2d6', '+3', '3', 'lancio 1m, reach 2m'],
          ['Lancia 3m', '2d6+4', '+1', '6', 'reach 3m'],
          ['Giavellotto', '+6', '+1', '3', 'lancio 1.5m'],
          ['Arco corto', '1d6+6', '–', '3', 'distanza 1.5m, N=3'],
          ['Arco lungo', '2d6+6', '–', '6', 'distanza 2.0m, N=5'],
          ['Balestra', '+15', '–', '3', 'distanza 1.0m, N=3, ricarica 7'],
        ],
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
      { type: 'subheading', text: 'Impedimento' },
      {
        type: 'p',
        text: 'L\'impedimento di tutti i pezzi indossati si somma e viene sottratto a ogni tiro (parte fissa). È il prezzo del peso. La skill −1 impedimento riduce di 1 l\'imp di ogni pezzo, con floor a 0. Si compra a poco (100 exp). Senza queste skill un tank è inchiodato.',
      },
    ],
  },

  {
    id: 'skills',
    title: '11. Skill system',
    blocks: [
      { type: 'p', text: 'Hai 2000 punti esperienza da spendere prima della battaglia.' },
      { type: 'subheading', text: 'I 4 modificatori' },
      {
        type: 'table',
        headers: ['Skill', 'Costo', 'Effetto'],
        rows: [
          ['−1 impedimento', '100 exp', 'Riduce di 1 l\'impedimento di un pezzo (floor 0). Cumulabile.'],
          ['+1 al tiro', '600 exp', 'Aggiunge +1 fissa al tiro che matcha le specializzazioni.'],
          ['+1 dado', '3600 exp', 'Tiri sempre 1 dado in più. Costoso.'],
          ['+1 dado massimo', '1200 exp', 'Il tetto dei dadi tirabili sale di 1. Paghi solo se decidi di usarlo.'],
        ],
      },
      { type: 'subheading', text: 'Specializzazioni' },
      { type: 'p', text: 'Ogni skill può essere combinato con fino a 1 parola per lista (max 4 parole):' },
      {
        type: 'list',
        items: [
          'Abilità: forza, agilità, volontà',
          'Azioni: attaccare, parare, schivare, slancio',
          'Classe oggetto: spade, scudi, armature, lance, asce, archi, balestre',
          'Oggetto specifico: spada lunga, scudo medio, arco corto, ecc.',
        ],
      },
      { type: 'p', text: 'Più stretta la specializzazione → più mirato il bonus, ma stesso costo. Conviene specializzare se hai una build chiara.' },
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
      { type: 'subheading', text: '12.3 Asta movimento (zona di controllo)' },
      {
        type: 'p',
        text: 'L\'idea: chi impugna una lancia (reach >= 4) minaccia un\'area attorno a sé. Per attraversare quella zona devi "battere il bid".',
      },
      {
        type: 'list',
        items: [
          'Tu (mover) e il difensore scegliete simultaneamente in privato una puntata in slancio (0..slancio).',
          'bid_atk >= bid_def → tu passi l\'esagono (parità → atk vince). Altrimenti il movimento si ferma.',
          'Entrambi pagano la propria puntata indipendentemente da chi vince.',
        ],
      },
      { type: 'p', text: 'Solo le lance attivano (lancia 2m reach 4, lancia 3m reach 6). Mind game puro: nessun dado tirato.' },
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
    ],
  },
];

export function getChapter(id: string): ManualChapter | undefined {
  return MANUAL.find((c) => c.id === id);
}

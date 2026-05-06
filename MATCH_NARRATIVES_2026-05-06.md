# Match Narratives — flow modale 2026-05-06

> Narrazioni in italiano scorrevole del flow turn-by-turn di 6 matchup chiave del database Deep CFR.
> Generate da subagent partendo dai dati `--by-round` di `match_replay.py` (50 sim/match).
> Stile: prosa descrittiva, niente tabelle/percentuali/elenchi.
>
> Convenzione: A = primo player nel label, B = secondo. Es. `lanc_inv_vs_spa` → A=lanciere, B=spadaccino.

**ERRATA (2026-05-06)**: alcuni passaggi delle narrative menzionano che il `BID_MOVEMENT` (asta zona controllo) si attiva "solo per armi reach ≥ 4 (lance)". Questa interpretazione era basata sulla vecchia formulazione di `CLAUDE.md` M-1. La regola corretta, **confermata da Valerio** e implementata in `reducer.py:266`, è: **TUTTE le armi da mischia con reach ≥ 1 triggerano l'asta** (regola universale). Le sezioni dove questo conta sono `ascia1h_vs_lanc` (round 3) e `lanc_vs_giav` (round 1, 3): il BID si attiva sempre quando uno dei due è in reach dell'altro, indipendentemente dall'arma. Le dinamiche e i dati restano corretti — è solo il commento sul trigger ad essere stato impreciso. CLAUDE.md M-1 è stato aggiornato.

---

## Indice

- [lanc_inv_vs_spa](#1-lanc_inv_vs_spa-stomp-lanciere-vs-spadaccino-no-scudo) — stomp +0.675
- [lanc_inv_vs_tank](#2-lanc_inv_vs_tank-stallo-lanciere-vs-tank-scudo-medio) — bilanciato/stallo +0.225
- [ascia1h_vs_lanc](#3-ascia1h_vs_lanc-gerarchia-thrower) — stomp inverso -0.43
- [lanc_vs_giav](#4-lanc_vs_giav-mind-game-thrower-vs-thrower) — bilanciato +0.035
- [giav_vs_balestra](#5-giav_vs_balestra-record-stomp-sessione) — stomp record +0.75
- [balestra_vs_tank](#6-balestra_vs_tank-stallo-da-scudo-medio) — stallo -0.025 (80% draw)

---

## 1. lanc_inv_vs_spa (stomp lanciere vs spadaccino no-scudo)

## Flow modale del matchup lanc_inv_vs_spa

**Round 1.** Entrambi partono con impeto 14, ma A vince l'iniziativa quasi sempre grazie al tiro di slancio iniziale e al fatto che gioca per primo dopo il pareggio. La sequenza tipica del lanciere è chiara: alza lo scudo (TOGGLE_DEF nel 60% dei casi, raddoppiando la parry passiva contro il ranged), poi scaglia immediatamente la prima delle due lance da getto a circa 10 hex di distanza, dichiarando ATK con 1 o 2 dadi. Lo spadaccino, che a 10 hex non può fare nulla di utile, si limita a coprire terreno camminando in avanti per chiudere la distanza. A fine round A è ancora a HP pieni, B ha già preso la prima ferita scendendo a 16.8.

**Round 2.** A mantiene l'iniziativa. Il pattern si ripete con maggiore intensità: TOGGLE_DEF (73%), seconda lancia tirata (78% DECL_ATK) e movimento per restare alla distanza giusta, intorno agli 11 hex. Il dettaglio non ovvio è che A consuma quasi tutto lo slancio (scende a 0.8 medio): la policy CFR sceglie di bruciarlo per spostarsi e mantenere il kiting piuttosto che tenerlo per la difesa, perché lo scudo passivo basta. B prosegue ad avvicinarsi a piedi, ma incassa: HP B crollano a 11.5. Il ritmo dei danni è già chiaramente a senso unico.

**Round 3.** Il round decisivo del matchup, qui finisce un terzo delle partite. A ha ormai esaurito le lance da getto in inventario, ma il modello marca ancora `RANGED lancia_2m` perché il bid di movimento e la geometria gli permettono di tenere B fuori dal reach. Lo spadaccino fatica a chiudere (solo 1.4 azioni/round, 44% MOVE) perché lo slancio non gli basta a coprire terreno e attaccare nello stesso turno. HP B scivolano a 7.5, e in 17 partite su 50 il combattente cade qui senza aver mai colpito. Quando sopravvive, è perché ha vinto un BID_MOVEMENT contro la reach 4 della lancia.

**Round 4.** Nelle partite arrivate fin qui (56%), la distanza si è stabilizzata ma B è in critica. A comincia a mostrare un repertorio misto: oltre al ranged ricompare `DECL_ATK[MELEE lancia_2m]` (×7), perché a questo punto il rischio di farsi raggiungere richiede di sfruttare la reach 4 della lancia in mischia. Il lanciere alterna ancora TOGGLE_DEF e attacchi ma comincia anche a difendere attivamente (DEF al 32%): segno che B è arrivato in ingaggio e A è costretto a parare con la lancia o schivare. B finalmente attacca (5 ATK_DICE), ma con HP a 8.3 è già un disperato.

**Round 5.** Le partite residue (42%) sono quelle in cui B ha resistito al kiting. A continua il pattern difensivo-offensivo, scudo su (67%), un altro tiro ranged opportunistico, ma la distanza scende a 9.2 hex: la pressione di B comincia a farsi sentire. La scelta non banale del lanciere è di non passare al melee a tutto tondo — la lancia 2D6 in mischia è meno efficace del ranged a distanza, quindi insiste a tenere il gap. B accumula slancio (7.0) per il prossimo round: sta caricando il colpo della disperazione.

**Round 6.** Si arriva al contatto reale. La distanza scende a 7.8 hex, A perde impeto (sceso a 11.5) e l'ordine dei turni si inverte: B ora ha più impeto e gioca per primo. Lo spadaccino sferra finalmente un attacco serio in `MELEE spada_lunga mode=1` (×7) con 3 dadi, e usa anche `parry d1` con la spada lunga per difendersi quando A risponde. Questo è il momento in cui le 2 vittorie totali di B si materializzano: se la parata di A fallisce e B porta a casa un 6.2 medio per hit con un eccezionale fino a 20, l'inerzia gira. Ma nella stragrande maggioranza A ha ancora HP 15.3 contro 8.1, troppo margine.

### Sintesi

Il matchup è una dimostrazione da manuale del kiting con armi da getto: A vince il 72% e pareggia il 24% restando fuori reach per due o tre round, con scudo alzato che neutralizza le passive del ranged contrario (inesistente, ma il TOGGLE è gratis) e bruciando lance throw a distanza 10-11 hex. B chiude il gap troppo lentamente (1.4-2.7 azioni utili/round, niente difese attive contro il ranged) e arriva al contatto già a un terzo degli HP. Le 2 vittorie residue di B sono partite-coda in cui un BID_MOVEMENT vinto e parate riuscite con la spada lunga gli permettono di portare a casa un round 6 con damage burst.

---

## 2. lanc_inv_vs_tank (stallo lanciere vs tank scudo medio)

# Lanciere vs Tank — narrazione modale (50 sim)

**Build A**: lancia 2m + scudo piccolo + armatura media + 2 lance throw
**Build B**: mazza + scudo medio + armatura media

**Round 1**. Tutti partono con impeto 14, quindi nessuno ha vantaggio iniziale ma di fatto la situazione è simmetrica: il tank avanza per chiudere la distanza, mentre il lanciere si tiene a debita distanza per giocare i suoi vantaggi. Entrambi muovono molto e nessuno dei due infligge danno: a fine round gli HP sono sostanzialmente intatti, attorno ai venti per parte. Curiosamente il tank arriva a fine turno con uno slancio molto più alto del lanciere (intorno a tre contro zero) e con un impeto sopra la trentina, quindi nel round successivo aprirà lui le danze. Il lanciere, dal canto suo, passa metà delle volte in stance difensiva e prova qualche lancio ranged, sentendosi protetto dalla distanza di una mezza dozzina di esagoni. È un round di posizionamento puro: nessuno si compromette, ma il tank si carica per la corsa.

**Round 2**. L'iniziativa adesso è del tank, che ha chiuso il primo round con più impeto. Lui prova ad accorciare ancora — l'azione tipica resta MOVE con qualche volta una dichiarazione di melee con la mazza — ma il lanciere risponde nel modo opposto: invece di ingaggiare, indietreggia (la distanza media a fine round sale a otto esagoni) e alterna tra lancio ranged e qualche colpo melee opportunistico se il tank si avvicina troppo. È qui che si vede il primo TOGGLE_DEF significativo del tank, oltre la metà delle volte: sente arrivare i tiri di lancia e raddoppia la parry passiva con lo scudo medio. Il primo HP cala in media di un paio di punti per parte, ma chi prende più legnate è il tank. Un dieci percento delle partite finisce già qui, quasi sempre per knockout rapido del tank colpito da un colpo critico.

**Round 3**. Il tank conserva ancora l'iniziativa, ma il quadro è quello di un inseguimento frustrante. Avanza, prova a entrare a distanza tre per piazzare la mazza, e il lanciere alterna: a volte attiva def stance preventiva, a volte gioca due dadi su un attacco MELEE di lancia se il tank è entrato in reach 4, altre volte ricade su un lancio ranged. La policy CFR del lanciere qui mostra una scelta sottile: TOGGLE_DEF quasi metà delle volte non per paura del melee, ma per garantirsi parry passiva contro un eventuale ranged-trade quando lo slancio è basso (1.8) e non potrebbe permettersi un parry attivo. Il tank perde altri tre HP medi e scende a sedici, mentre il lanciere resta sopra i diciannove. La distanza si stabilizza intorno a otto esagoni, troppo per la mazza, comodo per la lancia.

**Round 4**. La forbice di impeto si stringe (lanciere 10.8 vs tank 19.6 a fine round) ma è ancora il tank a iniziare. La novità tattica è che adesso il lanciere bidda alto sul movimento — spesso BID 2 — perché il tank con la sua mazza non ha reach: l'asta nascosta scatta solo per la lancia da quattro. Il lanciere quindi gestisce i pochi slanci che ha per restare a sei-sette esagoni, abbastanza per lanciare e per non farsi raggiungere in un solo turno. Il tank perde altri quattro HP e scivola sotto i quindici, ed entra in def stance ben oltre la metà dei round (62 percento per A): è il momento in cui il lanciere capisce che chiudere a melee ravvicinato lo espone alla mazza, e si protegge mentre conta i colpi di lancio.

**Round 5**. La situazione si stabilizza in un loop logorante. Il tank ha ancora un filo di iniziativa per impeto, ma fa pochissimo: muove, qualche TOGGLE_DEF, raramente attacca. Il lanciere rallenta gli attacchi (DECL_ATK scende sotto la metà delle volte) e usa il round per ricaricare slancio — finisce con quasi quattro punti il tank, due per il lanciere — e per riposizionarsi a otto esagoni. Una scelta non scontata della policy è che nessuno dei due RELOAD-a esplicitamente le lance già tirate: il lanciere preferisce alternare ranged e melee mentre lo slancio cresce naturalmente. Il tank scende sotto i quattordici HP medi, il lanciere è ancora a diciotto e mezzo. Si capisce che la partita, se non chiude per botta secca, va al tempo.

**Round 6**. Il lanciere ora è quasi alla pari come iniziativa ma resta dietro di poco. Riprende ad attaccare a piena potenza (DECL_ATK al 72 percento, due dadi quasi sempre), alternando tre lance melee ogni due ranged: la distanza media a fine round, sette esagoni, suggerisce che spinge per chiudere quando il tank è ormai logoro. Il tank a sua volta passa metà del round in DEF reattiva, e qui appare il tic della policy CFR più interessante: il tank sceglie spesso DEF[none], cioè incassa volontariamente, perché con slancio basso e già in stance difensiva passiva preferisce non bruciare dadi azione su un dodge che statisticamente gli farebbe perdere ancora più impeto. Il tank arriva a dodici HP, il lanciere è ancora sopra diciotto.

**Sintesi**. L'incontro è una guerra di nervi che il lanciere conduce ma raramente chiude: vince nettamente nelle uccisioni effettive (trenta percento contro due percento del tank) e finisce con HP molto più alti (diciassette contro otto), però oltre due partite su tre vanno a tempo e si chiudono in pareggio per esaurimento dei round. Le partite durano in media otto-nove round e arrivano spesso fino al dodicesimo. Il tank, senza reach e senza ranged, può sperare solo nel turno fortunato in cui il lanciere si fa pizzicare a distanza tre con poco slancio per parare — succede, ma una volta ogni cinquanta.

---

## 3. ascia1h_vs_lanc (gerarchia thrower)

## Flow modale del matchup ascia1h_vs_lanc

**Round 1.** Entrambi partono a impeto 14, ma è il lanciere a prendere in mano la scena: scivola in avanti e già nelle prime azioni dichiara un lancio di lancia in volo, sfruttando il suo raggio di due esagoni. L'ascia, consapevole che a otto-nove esagoni di distanza non ha nulla da dire in offesa, accende il TOGGLE_DEF per portare la parry passiva a -8 contro il ranged e prova a sua volta a tirare una delle sue ascie, ma il proiettile parte controvento perché il throw dell'ascia morde solo a un esagono. Il round si chiude con A già un po' sotto e B più sopra, distanza ancora otto-nove esagoni, e B che ha bruciato meno impeto pur agendo molto di più.

**Round 2.** Lo schema si ripete in forma ancor più nitida: B continua a tirare lance da fuori, A toggle in difesa quasi sette volte su dieci, prova qualche lancio di disturbo ma la matematica del tiro è dalla parte del lanciere, che entra il 66% delle volte mentre l'ascia non passa il 38%. La distanza addirittura cresce a poco più di nove esagoni, segnale che B sta kitando con metodo: si allontana quel tanto che basta per restare in throw range della lancia ma fuori dal throw range dell'ascia. A esce con HP visibilmente più basso, B quasi intatto.

**Round 3.** Qui la policy di A tradisce la sua disperazione: dodici-tredici azioni nel turno, un dispendio enorme di slancio per cercare di chiudere. Ma la trappola è tattica: il BID_MOVEMENT scatta solo se A entra nella reach 4 della lancia, quindi ogni tentativo di avvicinamento può essere "biddato" da B, che spende impeto per costringere A a fermarsi o deviare. Risultato paradossale: la distanza media a fine round sale a undici esagoni, più lontana di prima. B continua a lanciare con calma, accende parry passiva quando vede arrivare un'ascia in volo, e gestisce l'impeto.

**Round 4.** Primo round in cui si vede un MELEE lancia_2m: in qualche simulazione A è riuscito a chiudere e B sceglie di colpire di reach senza farsi raggiungere oltre i quattro esagoni. La distanza si comprime a otto-nove, ma A è ormai sotto i dieci HP medi mentre B sta sopra i quattordici. La policy di A continua a oscillare tra TOGGLE_DEF e tentativi di lancio, segno che il modello ha capito che chiudere costa troppo impeto e troppi colpi presi durante l'avvicinamento.

**Round 5.** Ritorno alla forma "stallo a distanza": A sale di nuovo a tredici azioni nel round, segnale di un altro tentativo di rush, ma B riapre a dieci esagoni e accende difesa sei volte su dieci. La sproporzione di HP è ormai cristallizzata, A intorno a nove-dieci e B sopra tredici, e l'ascia non ha più slancio per investimenti aggressivi prolungati. Ogni volta che riprova ad avvicinarsi, paga in colpi presi durante il tragitto perché non può schivare né parare attivamente i lanci.

**Round 6.** La partita è di fatto già scritta. A è a meno di nove HP medi, B sopra tredici, distanza stabile a dieci esagoni, B che continua a tirare con la sua ATK 2D6 e tassi di hit doppi rispetto ad A. L'ascia toggla difesa nei tre quarti dei round in cui sopravvive, ma è una difesa che mitiga, non vince: la parry passiva a -8 raddoppiata morde tutto, però quando B colpisce e passa, fa danno medio 5.7, sufficiente a chiudere il conto in pochi round ulteriori.

### Sintesi
L'ascia perde sistematicamente perché il matchup è asimmetrico nel range di lancio (1 vs 2 esagoni) e nella reach mischia (1 vs 4), mentre lo scudo piccolo simmetrico non compensa nulla. B può kitare a distanza utile per sé e proibitiva per A, e la zona di reach 4 della lancia trasforma ogni tentativo di chiusura in un BID payato dall'ascia. La policy di A oscilla tra rush costosi e difesa passiva, ma entrambe le strade convergono sullo stesso esito: hit rate dimezzato, HP che si erodono linearmente, vittoria del lanciere nel 54% dei casi e l'ascia ferma al 6%.

---

## 4. lanc_vs_giav (mind game thrower-vs-thrower)

## Flow modale del matchup lanc_vs_giav

**Round 1.** L'arena si apre a otto hex di distanza con entrambi i contendenti a impeto pari, e nei fatti la priorità si gioca sul filo: il lanciere A apre per primo nella maggior parte delle simulazioni, ma il giavellottiere B risponde quasi a specchio. A scivola in posizione, alza lo scudo piccolo nella stance difensiva e scaglia la prima lancia da poco oltre il limite del proprio range; B si muove in avanti ma con cautela, alza anch'egli lo scudo e tira il primo giavellotto sfruttando il mezzo hex di range in più. È un round di studio armato: nessuno chiude davvero la distanza, entrambi spendono un'azione di TOGGLE_DEF per portare la parry passiva a -8, e A bidda tre volte sfruttando il fatto che B, per quanto thrower, sa che le sue lance hanno reach 4. Si chiude con HP quasi pieni — 19.2 contro 18.9 — e impeto eroso solo lievemente.

**Round 2.** L'iniziativa passa di mano spesso ora che gli impeti si stanno disallineando: B si ritrova con impeto 14 contro 17.9 di A, ed è A a giocare quasi sempre per primo. Il lanciere replica il copione — un altro tiro a distanza con la seconda lancia o un riposizionamento in attesa, sempre con stance difensiva attiva nella metà dei casi — mentre B accelera, sapendo di avere ancora due giavellotti in pugno e potendo permettersi un altro tiro a 8 hex. La distanza resta inchiodata sugli 8.3 hex: nessuno dei due vuole davvero entrare in mischia, perché chi rompe per primo la distanza si espone al tiro residuo dell'altro. Gli HP scendono a 18.2 e 16.0 — il giavellottiere ha incassato qualcosa, segno che A sta sfruttando bene il fatto di avere due tiri pieni.

**Round 3.** Il round della prima cesura: il 12% delle simulazioni si chiude proprio qui, quasi sempre per un colpo netto andato a segno tra l'una e l'altra parte. A continua a tirare di lancia ma è già a corto di munizioni — gli restano una, forse zero lance da scaglio — e inizia a pensare se conservare l'ultima per la chiusura o sparare adesso. B è ancora ricco, ha un giavellotto in mano e uno in faretra, e lo si vede dal numero di DECL_ATK[RANGED]: venti dichiarazioni contro le diciotto di A. Ma il giavellottiere paga lo svantaggio strutturale di non avere reach: se A decidesse di chiudere, B non può tenerlo a distanza con la zona di controllo. HP a 16.6 contro 13.4 — A è in vantaggio di tre punti, lo scudo piccolo sta facendo il suo lavoro su entrambi.

**Round 4.** Qui la dinamica si polarizza. A torna a una stance difensiva piena nel 67% dei casi, perché senza più lance da scagliare deve decidere se chiudere in mischia per usare la reach 4 o se aspettare che B si spinga troppo avanti. Cominciano ad apparire le prime DECL_ATK[MELEE lancia_2m]: nove su cinquanta, A sta valutando seriamente l'ingaggio in mischia. B invece resta sulla terza ondata di giavellotti, ma il suo impeto crolla a 8.7 — sta spendendo molto in movimento e bid difensivi. La distanza è ancora 8.4 hex, sospesa, ma è una distanza che non regge: uno dei due deve cedere. HP 15.7 contro 12.6, lo scarto si allarga.

**Round 5.** Il 72% delle simulazioni arriva fin qui e B comincia ad accusare il logoramento: impeto 6.4 contro i 13.4 di A, una forbice che cambia tutto perché significa che A gioca per primo e B subisce. Il lanciere, ormai senza tiri o con l'ultimo in canna, alza lo scudo nel 58% dei casi e tira solo se ha davvero il colpo — dodici DECL_ATK[RANGED] in totale, contro i quindici di B che ha ancora razzi nel sacco. La distanza si è stranamente allargata a 8.9 hex: B sta retrocedendo per guadagnare un altro tiro pulito, A lo lascia fare perché sa che senza giavellotti il giavellottiere è obbligato a passare alla spada backup. HP 14.1 contro 11.5.

**Round 6.** Sei round dentro, e il 60% delle simulazioni regge ancora. Il quadro si è invertito: A ha solo 3.2 azioni medie a round, mentre B ne ha 13.4 — segno che B sta facendo molti micro-aggiustamenti, bid e toggle, perché ha esaurito o sta esaurendo i giavellotti e deve riorganizzarsi. Lo si legge anche dal TOGGLE_DEF di B che sale a diciannove, il valore più alto della partita: scudo su, parry passiva a -8, in attesa che A entri nei due hex per la spada. La distanza si stringe a 7.8 hex per la prima volta, e l'impeto di B è ridotto a 6.1 — è in difficoltà di tempi. HP 13.0 contro 12.5, quasi pari: il matchup è davvero in equilibrio, con A leggermente avanti ma non abbastanza per chiudere.

### Sintesi
Il bilanciamento (V_a +0.035) nasce dal fatto che le tre asimmetrie — range maggiore di B, reach maggiore di A, munizioni più abbondanti di B — si compensano in modo quasi chirurgico. B colpisce per primo grazie al mezzo hex extra di range e tira tre volte invece che due, ma A ha reach 4 che blocca virtualmente la fuga (è l'unico a poter biddare il movimento avversario) e quando si arriva alla mischia il 2D6 della lancia resta migliore del +6 fisso del giavellotto e della spada backup. Il risultato è una danza in cui entrambi giocano "throw + retreat" sugli stessi 8 hex per quattro round buoni, con HP che scendono in parallelo e impeto che eroso quasi simmetricamente. A vince leggermente più spesso (34% contro 24%) ma i pareggi al 42% raccontano la verità del matchup: nessuno dei due ha un piano dominante, ed è proprio questa indeterminatezza il marchio del mind game thrower-vs-thrower.

---

## 5. giav_vs_balestra (record stomp sessione)

## Flow modale del matchup giav_vs_balestra

**Round 1.** L'iniziativa è perfettamente equivalente: entrambi partono a impeto 14, ma il giavellottiere A apre con la sequenza che lo definisce — TOGGLE_DEF per piazzare la stance con scudo piccolo (parry fisso 4, che diventa un −8 micidiale sui tiri ranged in arrivo) e poi un BID da 1 per guadagnare slancio mentre dichiara il primo lancio. Il giavellotto parte da circa 9-10 hex, modalità 0, dadi 2: nessuna ricarica, nessun setup, è tutto immediato. La balestra B invece deve risolvere il dilemma fondamentale: ha un solo colpo carico e una mole di setup da gestire, quindi spesso muove per chiudere la distanza o spende un BID a 0 mentre tenta il primo tiro. Già a fine round 1 A è a HP 19.2 contro 10.5 di B — quasi nove punti vita persi al primo scambio, e il giavellottiere è ancora pieno perché lo scudo passive ha già fatto il lavoro sui pochi tentativi di risposta.

**Round 2.** A mantiene l'iniziativa concettuale: la stance difensiva resta attiva nel 50% dei casi e parte il secondo lancio del giavellotto, ancora ranged a circa 9.4 hex. B ha un problema enorme: ha sparato il bolt al round 1 e ora è in piena ricarica (RELOAD d1 compare 7 volte), quindi le sue azioni si dimezzano a 2.5 per round. Il pugnale come backup melee non serve a nulla a 9 hex di distanza, e infatti qualche tentativo in MELEE pugnale mode 0 è puramente disperato. A finisce a 16.9 HP contro 7.7 di B — il 40% delle simulazioni si chiude proprio qui, perché il secondo giavellotto trova quasi sempre il bersaglio (hit rate 81.8% complessivo) e B non ha né scudo né stance attiva per ammortizzare.

**Round 3.** Solo il 40% dei match arriva qui: in tutti gli altri B è già morto. La distanza si è chiusa a 6.7 hex, A toglie il terzo giavellotto dalla cintura e per la prima volta inizia a usare DEF[dodge d1] difensivo perché esaurito l'arsenale ranged sa che dovrà passare alla spada. B prova ancora la disperata sortita in melee con il pugnale, ma A è ancora a 15.8 HP mentre B striscia a 7.7, slancio degli attaccanti completamente squilibrato.

**Round 4.** Il 26% delle simulazioni resiste fino a qui — sono i match in cui i tiri di A hanno toppato qualcosa al round 1. La distanza torna paradossalmente a 9.6 hex perché B ha provato a riguadagnare campo per finire la ricarica, e in effetti compaiono finalmente DECL_ATK[RANGED balestra mode=0] (3 occorrenze): il primo vero colpo di balestra arriva al quarto round, quando A è già a 15.9 HP e B a 6.5. È troppo tardi, e A è in stance difensiva nel 62% dei casi: il parry fisso 4 mangia gran parte del danno residuo.

**Round 5.** Solo il 18% dei match: qui siamo nei casi-coda dove B è riuscito a sopravvivere ai tre giavellotti e A ha dovuto estrarre la spada di backup. La distanza è 6.9 hex, l'impeto di A è crollato a 6.6 mentre quello di B resta alto a 24.8 perché ha agito molto meno. Anche così, A è a 12 HP contro 5.7 di B: il vantaggio accumulato nei primi due round è stato troppo grosso per essere recuperato.

### Sintesi
Questo è il matchup più sbilanciato della sessione (V_a_train +0.750, +37.5 wr%) per una ragione strutturale, non statistica: il giavellottiere ha tre colpi ranged immediati senza alcun setup, mentre la balestra spara una volta sola e poi paga sette turni di ricarica. La meccanica responsabile è il combinato disposto di RELOAD asimmetrico (7 turni vs 0) e TOGGLE_DEF abilitato solo per A grazie allo scudo piccolo (parry fisso 4 che si traduce in −8 ranged in stance): il primo round risolve già il 20% dei match e il secondo il 40%, perché B perde metà degli HP prima di poter sparare il secondo bolt e l'armatura leggera senza scudo non offre alcuna mitigazione passiva alla raffica di giavellotti.

---

## 6. balestra_vs_tank (stallo da scudo medio)

## Flow modale del matchup balestra_vs_tank

**Round 1.** La balestra parte con impeto pari al tank ma in molte sim spara per prima grazie al tiro di slancio iniziale: A si piazza già a buona distanza (~7 hex) e usa i dadi per posizionarsi ai margini del raggio utile. Non c'è ancora colpo: il primo tiro dalla balestra arriva mediamente solo dal round successivo, qui A muove e prepara una DEF passiva (parry/dodge) consapevole che B chiuderà. B intanto fa il suo classico: TOGGLE_DEF nello scudo medio (46% delle sim già in def stance a fine round) e avanza in linea retta. Distanza 7.2 hex, HP entrambi sopra 19, slancio B oltre 12 perché si tiene riserve per coprire e attaccare. Decisione non ovvia: A non spara subito anche quando potrebbe — la policy preferisce aprire il fuoco da fuori la portata utile della mazza solo dopo che il tank ha consumato slancio.

**Round 2.** A guadagna la finestra che cercava: questo è il round del primo colpo di balestra, infatti compaiono RELOAD[d1]×11 e DECL_ATK[MELEE pugnale]×10 — vuol dire che in molti rami A ha sparato e poi è già passato alla fase di ricarica turno 1/7. La policy alterna due rami: o la balestra parte e poi A apre la sequenza di RELOAD, oppure A si lascia raggiungere e tira di pugnale (debole ma utile per non sprecare lo slancio residuo). B continua a TOGGLE_DEF (43%) e a chiudere: distanza media 9.8 hex, segno che A ha indietreggiato attivamente per riguadagnare campo. HP 18.6 vs 19.3 — il colpo di balestra contro parry.fixed=8 raddoppiato spesso scivola.

**Round 3.** Round di transizione e di reset distanze. A non spara (la balestra è in ricarica), fa solo 2.8 azioni e si concentra sul kiting: distanza sale a 11.1 hex. B perde tempo: solo 4.9 azioni e mezzo round in def stance — qui il CFR sceglie il TOGGLE_DEF anche senza minaccia immediata, perché il costo opportunità è basso e il tank vuole comunque chiudere coperto. HP 17.8 vs 19.0, gap minimo. Decisione non ovvia: B accetta di non attaccare pur avendo slancio per due ATK, perché in stance riduce il rischio del prossimo bolt.

**Round 4.** A continua il kiting, sempre fuori reach (11.8 hex). Niente RELOAD qui in media: il colpo del round 2 è ancora lontano dall'essere pronto. B esplode in azioni (14.9): è il round in cui il tank corre, mantenendo TOGGLE_DEF (45%) tra un MOVE e l'altro per non lasciare scoperture. HP 17.2 vs 18.1: A subisce un secondo bolt incassato male oppure ha mangiato un colpo di mazza in un ramo dove la distanza si era chiusa. Lo slancio di A scende a 3.4 — comincia a scarseggiare per fuggire ulteriormente.

**Round 5.** Round corto per entrambi (2.0 / 2.7 azioni): è uno di quelli in cui poco accade, si stabilizza la distanza a 9.6 hex. A non spara (siamo a metà ricarica del bolt 2) e si limita a riposizionarsi. B mantiene 59% in def stance ma rinuncia ad ATK_DICE: significa che spesso sceglie di non sprecare slancio attaccando da troppo lontano. HP 16.4 vs 17.8. La policy CFR di A qui privilegia DODGE invece che PARRY — coerente coi numeri globali (33 dodge / 37 parry su tutto il match), perché il dodge contro mazza+1D6 è preferibile quando la distanza è ancora >1 hex.

**Round 6.** Secondo colpo di balestra in molte run: ricompaiono RELOAD[d1]×8, segno che A ha sparato di nuovo e ricomincia il ciclo di 7 turni. Distanza 11.4 hex, B mantiene il 55% in def stance e accumula TOGGLE_DEF×28, il valore più alto del match. HP 16.0 vs 17.8: il bolt 2 ha fatto pochissimo danno, perché contro parry.fixed=16 effettivi (8 raddoppiato dallo scudo) il +15 della balestra produce hit raramente, e quando hit il damage è spesso assorbito. Decisione non ovvia: A spara comunque, perché non ha alternative offensive valide — il pugnale a 11 hex non è un'opzione.

**Round 7.** Round di pochissime azioni per entrambi (1.7 / 3.3): l'incontro è in regime stagnante, A è a 12.4 hex completamente fuori dalla minaccia di mazza, B continua a tenere lo scudo alzato (50% def). HP 16.3 vs 17.3 — è il round con la minore variazione di HP del match. La policy di A qui passa a MOVE (64%, in calo) e in alcuni rami si limita ad aspettare la fine della ricarica senza nemmeno avanzare: lo slancio sale a 7.6, accumulato per il round successivo.

**Round 8.** A torna ad attaccare ma stavolta in mischia: DECL_ATK[MELEE pugnale]×7, ATK_DICE[1]×7. Significa che in alcuni rami il tank ha finalmente chiuso (distanza 11.1 hex in media, ma con varianza alta) e A è costretto al pugnale 1D6 — un'arma che contro armatura media + scudo medio fa danno trascurabile. B resta col 63% in def stance, più alto del solito, per chiudere senza rischi. HP 16.4 vs 16.9, gap quasi nullo. L'impeto di B scende sotto 17 — il tank sta finendo le risorse anche lui, ma con HP intatti.

### Sintesi
Il matchup è uno stallo strutturale: lo scudo medio porta parry.fixed effettivo a 16 quando attivo, e il +15 della balestra a quel punto trova il tank solo con un tiro alto, con malus distanza ⌊d/3⌋ che peggiora le cose nei round di kiting. La balestra ha un solo colpo ogni 8 turni (sparo + ricarica 7) e nel mezzo è inerme: il pugnale offhand a 1D6 non scalfisce armatura media. Il tank dal canto suo non ha minacce ranged, quindi se A mantiene 11+ hex non viene mai toccato dalla mazza — e infatti il BID non si attiva mai, perché nessuna delle due armi avversarie è reach ≥4. Risultato: 80% draw a tempo, 4% wins A, 16% wins B (B ha leggero edge solo quando riesce a chiudere prima del secondo bolt).

# Manuale di hex-tactics

> Bozza per review didattica. Verrà poi splittato in sezioni della `ManualScene`.
> Lo stile è **conciso e operativo** — chi lo legge sta imparando a giocare, non a fare un esame.
> I box `> esempio` sono pensati per essere rendered in box visivi distinti.

---

## 1. Cos'è hex-tactics

Un duello tattico a turni 1 contro 1 su una griglia di esagoni. Due eroi, due fazioni, una sola mappa: chi resta in piedi vince.

Non è un gioco di forza bruta. È un gioco di **economia** (i dadi sono limitati, ogni scelta costa), **mind game** (le scelte chiave si fanno in segreto e si rivelano insieme) e **posizionamento** (ogni esagono vale).

**Tre cose da tenere a mente fin dall'inizio**:

1. **Ogni dado che spendi adesso è un dado che non avrai dopo.** Tirare un dado in più aumenta le tue chance ora ma riduce la tua capacità di reagire al prossimo attacco.
2. **Le scelte chiave sono simultanee e private.** Tu decidi quanto attaccare mentre l'altro decide come difendersi: nessuno vede le carte dell'altro fino alla rivelazione.
3. **Le difese si pagano coi tuoi dadi azione.** Schivare e parare costano. Significa che troppi attacchi nel turno avversario ti svuotano il pool — anche senza farti danni diretti.

---

## 2. Anatomia di un'unità

Ogni eroe ha le seguenti statistiche di partenza (baseline):

| Stat | Valore | Cosa fa |
|------|--------|---------|
| **HP** | 20 | Vita. A 0 sei fuori. |
| **Forza / Agilità / Volontà** | 2 / 2 / 2 | Determinano la "dimensione" del pool di dadi azione e quali skill puoi attivare. |
| **Impeto** | 14 | Determina chi gioca prima nel round. Più alto → giochi prima. |
| **Slancio** | 0 (a inizio battaglia tira un dado) | Energia cinetica. Si spende per muoversi e biddare. Si trasforma in impeto a inizio del tuo turno successivo. |
| **Dadi azione (pool)** | 6 | Risorsa primaria per attaccare, parare, schivare, ricaricare. Si recupera in parte ogni turno. |

Equipaggiamento: **arma principale** (mano), **offhand** (seconda arma o scudo o mano vuota), **armatura**.

Niente classi: la differenza tra un personaggio e l'altro è **come spendi i 2000 punti esperienza** in equipaggiamento e skill (vedi cap. 11).

---

## 3. Il round e il turno

Una battaglia è una sequenza di **round**. Un round è una sequenza di **turni** — uno per ogni unità ancora viva.

### Ordine di iniziativa

A inizio round, i giocatori vengono ordinati per **impeto decrescente** (chi ha impeto più alto gioca prima). In caso di parità si guarda lo **slancio**, e se anche quello è uguale si tira a sorte.

Questo significa che **l'impeto è il timing**: chi lo gestisce meglio prende l'iniziativa nei momenti decisivi.

### Le fasi del turno (per ogni unità)

1. **Recovery dadi azione**: recuperi `⌊(F + A + V) / 2⌋` dadi (per la baseline = 3). Cap totale a 9 (impossibile averne di più del pool).
2. **Slancio → impeto**: il tuo slancio attuale si somma all'impeto. Per questo lo slancio è "il tuo impeto del prossimo round".
3. **Tiro slancio**: scegli quanti dadi tirare (0, 1 o 2). Tirando, sostituisci il tuo slancio con il risultato del tiro.
4. **Movimento e azione** (in qualunque ordine): muoviti spendendo slancio, e/o esegui un'azione (attacco, ricarica, ecc.).
5. **Fine turno**, passa al successivo.

> **Esempio**: Spadaccino ha impeto 14, slancio 5. Inizio turno: impeto diventa 14+5 = 19. Tira 2 dadi slancio → fa 4+3+2 = 9. Slancio nuovo = 9. A questo punto può muoversi 9 esagoni (più 1 gratis) e/o attaccare.

---

## 4. Le tre risorse: dadi azione, slancio, impeto

Sono i tre indicatori che dovresti tenere d'occhio in continuazione.

### Dadi azione (immediato)

Ti servono per **fare cose**: attaccare, schivare, parare, ricaricare. Ogni azione costa da 1 a 2+ dadi.
- **Recovery**: `⌊(F+A+V)/2⌋ = 3` per turno (sulla baseline).
- **Cap**: 9 totali (puoi accumulare).
- **Trade-off chiave**: più ne spendi nel tuo turno per attaccare, meno te ne restano per difenderti nel turno avversario.

### Slancio (mobilità + iniziativa)

È la tua **energia cinetica**. Si spende per:
- Movimento (1 esagono gratis, +1 slancio per ogni esagono successivo).
- Asta movimento (cap. 12).

A **inizio del prossimo turno** lo slancio si somma all'impeto. Significa che lo slancio è anche "anticipo di iniziativa per il round dopo".

**Trade-off chiave**: tirare 2 dadi slancio costa 2 dadi azione, ma garantisce mobilità + impeto futuro. Tirare 0 dadi non costa niente, ma resti immobile e giochi tardi nel round seguente.

### Impeto (timing)

Determina **quando giochi nel round**. Si modifica con:
- Lo slancio del round precedente (si somma).
- Danni ricevuti (lo slancio scende sotto 0 → l'eccesso negativo si sottrae a impeto).

Quando l'impeto va a 0, il recovery dadi è cappato a **1/turno**: significa che sei in disperazione operativa.

---

## 5. Movimento

Si misura in **esagoni**.

- Il primo esagono ogni turno è **gratis** (0 slancio).
- Ogni esagono successivo costa **1 punto slancio**.
- Il movimento è in linea retta — il path tra due punti viene calcolato dal motore.
- Non puoi finire su un esagono occupato dalla basetta avversaria.

> **Esempio**: hai slancio 4. Puoi muoverti fino a **5 esagoni** (1 gratis + 4 pagati). Se ne fai solo 3, finisce con slancio 4 - 2 = 2.

**Conversione**: 1 esagono = 0.5 m. Una "portata 2 m" significa 4 esagoni.

---

## 6. Architettura del tiro: variabile vs fissa

Questa sezione è la più importante del manuale. Capisci questa, capisci tutti i combattimenti.

Ogni tiro ha **due componenti**:

- **VARIABILE**: la somma dei d6 tirati. Casuale, dipende dalla fortuna.
- **FISSA**: la somma di tutti i bonus statici (es. il +2 base, il bonus dell'arma, le skill `+1 al tiro`, meno l'impedimento).

**Total tiro** = variabile + fissa.

Le difese non agiscono allo stesso modo:

- **Schivata**: morde **solo la variabile**. Se schivi, blocchi i dadi tirati ma il fisso passa lo stesso (se positivo).
- **Parata**: morde **il totale**. Se pari abbastanza, blocchi tutto.

> **Esempio**:
> Spadaccino attacca con spada lunga, 2 dadi PG: variabile = 3d6 (2 PG + 1 spada) = 12, fissa = 2 + 2 spada − 6 imp = −2. Totale 10.
>
> Difensore schiva con 2 dadi: tira 2d6 +2 = 9. Sottrae al variabile attaccante: 12 − 9 = 3 > 0 → l'attacco passa, ma solo con la variabile residua + fissa = 3 + (−2) = 1 danno.
>
> Se invece avesse parato con uno scudo medio (+8 fisso): tira 1d6+2+8 = 13. Sottrae al totale attaccante: 10 − 13 = −3 → parato! L'attaccante perde 3 di slancio.

**Implicazione di design**:
- Armi a **fisso puro** (mazza, balestra) sono devastanti se passano, ma molto schivabili (la schivata ne blocca 100% se vince).
- Armi a **molti dadi** (spada lunga, arco lungo) sono più affidabili (i dadi propri li portano sopra), ma se parate puoi ridurle a zero.

---

## 7. Combattimento corpo a corpo (mischia)

### Sequenza di una mischia

1. **Dichiarazione**: l'attaccante dichiara su chi attacca, con quale arma, in quale modo (es. spada con forza vs spada con agilità).
2. **Scelte simultanee private**:
   - L'attaccante sceglie quanti dadi tirare (1 o 2 standard).
   - Il difensore sceglie il tipo di difesa (parata / schivata / niente) e quanti dadi tirare.
   - **Nessuno vede la scelta dell'altro fino alla rivelazione.**
3. **Risoluzione**: si applicano le formule (vedi cap. 6 e 9).
4. **Conseguenze**:
   - Se l'attacco passa: danno applicato (riduzione armatura, vedi cap. 10).
   - Se l'attacco è bloccato: l'attaccante perde slancio pari al residuo della difesa.

### Range della mischia

- Default: **adiacenza**. L'arma colpisce solo nemici a 1 hex.
- Armi con **portata** (es. spada lunga 1m = 2 hex, lancia 2m = 4 hex, lancia 3m = 6 hex): puoi colpire più lontano. Sono dette anche "armi reach".

---

## 8. Combattimento a distanza (ranged)

Le armi a distanza non si possono parare né schivare attivamente: il difensore non può spendere dadi per evitarle. La sopravvivenza si gioca sul **tuo slancio**, sul **tuo scudo**, sulla **tua armatura**.

### Linea di vista (LoS)

Ogni unità occupa una **basetta da 7 esagoni** (1 centrale + 6 corona). Quando spari:

1. Si tracciano le linee di vista da ognuno dei 7 esagoni della tua basetta verso ognuno dei 7 del bersaglio (49 linee).
2. Le altre unità vive **bloccano** la LoS se si trovano sul percorso.
3. Si conta la **visibilità**: numero di centri target visti (0–7).
4. Se visibilità = 0 → non puoi sparare.
5. L'esagono di partenza usato per il calcolo è quello con la migliore LoS (max visibilità, parità → scelta giocatore).

### Formula del tiro

```
Risultato = 1-2 d6 + 2 + bonus_arma + visibilità − ⌊distanza / N⌋ − slancio_target − impedimento
```

- `N` è il **divisore distanza** dell'arma (vedi tabella cap. 10). Più alto = arma decade meno con la distanza.
- `slancio_target` è una penalità: più il bersaglio è "in movimento" (ha slancio alto), più è difficile da colpire.
- Lo scudo del difensore (se ha) sottrae passivamente il suo bonus parry alla fissa attaccante.
- L'armatura del difensore sottrae la sua riduzione danno alla fissa attaccante.

> **Esempio**:
> Arciere con arco lungo (1d6+6, N=5) tira a un tank a 8 hex con slancio 0, scudo medio (parry +8), armatura media (RD 6).
> Tiro: 2d6 (PG) + 1d6 (arco) + 2 (PG) + 6 (arco) + 4 (visibilità) − ⌊8/5⌋ − 0 − 8 (scudo) − 6 (RD) − 3 (imp) = ~3d6 medio 10.5 + 12 − 1 − 8 − 6 − 3 = 4.5 di danno medio.
> Lo stesso tank con slancio 8: 4.5 − 8 = −3.5 → l'attacco fallisce in media.

**Trade-off del bersaglio**: tenere slancio alto ti protegge dal ranged ma costa dadi azione.

---

## 9. Difese: schivata vs parata

### Schivata

- **Costo**: 1-2 dadi azione.
- **Tiro**: 1-2 d6 + 2 + skill `+1 al tiro [schivare]`.
- **Effetto**: sottrae alla parte **variabile** dell'attaccante.
- **Quando usarla**:
  - Contro armi a **dadi propri** è meno efficace (più variabile da battere).
  - Contro armi a **fisso puro** (mazza, ascia 2h, balestra, giavellotto) è devastante: se vinci, blocchi anche tutto il fisso. Schivare una mazza riuscita = 0 danni totali.
- **Costa solo dadi azione**, non richiede equipaggiamento specifico. Schivi anche con le mani vuote.

### Parata

- **Costo**: 1-2 dadi azione **+ un'arma o scudo idoneo**.
- **Tiro**: 1-2 d6 + 2 + bonus parry dell'arma/scudo + skill.
- **Effetto**: sottrae al **totale** dell'attaccante.
- **Quando usarla**:
  - Contro armi a **dadi propri** è meglio (mordi anche il fisso).
  - **HP basso**: la parata è più "sicura" della schivata (meno variance).
  - Serve uno scudo/arma con `parry !== null` per parare.

### Niente difesa

- **Costo**: 0 dadi.
- **Effetto**: tutto il tiro attaccante passa (poi viene attenuato dall'armatura).
- **Quando**: se sei a 0 dadi, oppure stai investendo dadi nel tuo prossimo attacco e accetti il colpo.

---

## 10. Equipaggiamento

### Tabella sintetica armi

| Arma | ATK addizionale | DIF (parry) | Imp | Note |
|---|---|---|---|---|
| Pugnale | 1d6+2 | 1d6 | 0 | lancio 0.5m |
| Spada | 1d6+2/+2 | 1d6+2 | 3 | bonus condizionato F/A |
| Spada lunga 1h | 1d6+2 | 1d6+6 | 6 | reach 1m |
| Spada lunga 2h | 1d6+6 | 1d6+6 | 6 | reach 1m |
| Mazza | +9 | +3 | 3 | solo fissa |
| Ascia 1h | 1d6+6 | +3 | 3 | lancio 0.5m |
| Ascia 2h | 1d6+15 | +3 | 6 | – |
| Lancia 2m | 2d6 | +3 | 3 | lancio 1m, reach 2m |
| Lancia 3m | 2d6+4 | +1 | 6 | reach 3m |
| Giavellotto | +6 | +1 | 3 | lancio 1.5m |
| Arco corto | 1d6+6 | – | 3 | distanza 1.5m, N=3 |
| Arco lungo | 2d6+6 | – | 6 | distanza 2.0m, N=5 |
| Balestra | +15 | – | 3 | distanza 1.0m, N=3, ricarica 7 turni |

### Scudi

| Scudo | ATK | DIF (parry) | Imp |
|---|---|---|---|
| Piccolo | +4 | 1d6+4 | 3 |
| Medio | +8 | 1d6+8 | 6 |
| Pesante | +8 | 1d6+12 | 9 |

### Armature

| Armatura | RD | Imp |
|---|---|---|
| Leggera | 3 | 3 |
| Media | 6 | 6 |
| Pesante | 12 | 9 |

### Impedimento

L'**impedimento** di tutti i pezzi indossati si somma e viene sottratto a **ogni tiro** del personaggio (parte fissa). È il prezzo del peso.

La skill `−1 impedimento` riduce di 1 l'imp di **ogni pezzo**, con floor a 0. Si compra a poco prezzo (100 exp). Senza queste skill un tank è inchiodato.

---

## 11. Skill system

Hai **2000 punti esperienza** da spendere prima della battaglia.

### I 4 modificatori

| Modificatore | Costo | Effetto |
|---|---|---|
| **−1 impedimento** | 100 exp | Riduci di 1 l'impedimento di un pezzo (floor 0). Cumulabile. |
| **+1 al tiro** | 600 exp | Aggiunge +1 fissa al tiro che matcha le specializzazioni. |
| **+1 dado** | 3600 exp | Tiri **sempre** 1 dado in più. Costoso. |
| **+1 dado massimo** | 1200 exp | Il **tetto** dei dadi tirabili sale di 1. Paghi solo se decidi di usarlo. |

### Specializzazioni

Ogni skill può essere combinato con fino a 1 parola per lista (max 4 parole):

- **Abilità**: forza, agilità, volontà
- **Azioni**: attaccare, parare, schivare, slancio
- **Classe oggetto**: spade, scudi, armature, lance, asce, archi, balestre, ecc.
- **Oggetto specifico**: spada lunga, scudo medio, arco corto, ecc.

Più stretta la specializzazione → più mirato il bonus, ma stesso costo. Conviene specializzare se hai una build chiara.

> **Esempio build "Spadaccino offensivo"**:
> - 600 exp: spada lunga (no scudo per fluidità) + armatura media
> - −3 imp generico (300 exp) + −3 imp armature (300 exp) → spada 3, armatura 3
> - +2 al tiro [attaccare][spade] (1200 exp)
> - +1 dado massimo [attaccare][forza] (200 exp scarsi avanzano per altri tweak)

---

## 12. Meccaniche avanzate

Queste tre meccaniche aggiungono profondità tattica oltre l'attacco/difesa standard.

### 12.1 Carica

**L'idea**: avvicinarsi al nemico in carica deve dare un vantaggio.

**Come funziona**:
- Ogni esagono di **avvicinamento** al target durante il tuo turno (calcolato come delta tra distanza a inizio turno e distanza al momento dell'attacco) è un punto **carica disponibile**.
- Quando dichiari l'attacco mischia (o lancio), scegli quanti punti carica usare: da 0 a `min(delta, slancio attuale)`.
- Ogni punto carica = +1 alla parte fissa dell'attacco, ma **costa 1 punto slancio**.

**Quando conviene**:
- Hai mosso 3 hex verso il nemico → puoi caricare con +3 fissa.
- Decidi tu se spendere lo slancio per il bonus, o conservarlo.

**Non si applica a**: armi puramente ranged (archi, balestra). Sì invece a lance, asce 1h, pugnali (anche per i lanci) e ovviamente alle armi mischia pure.

### 12.2 Posizione difensiva

**L'idea**: lo scudo non è solo per parare attivamente — è anche un muro fisico.

**Come funziona**:
- Se hai uno scudo in offhand, durante `choosing-action` puoi attivare la **posizione difensiva** (azione gratuita, max 1 toggle/turno).
- In stance:
  - Lo scudo aggiunge **2× il suo bonus parry alla riduzione danno passiva** sia in CaC sia contro ranged.
  - L'impedimento dello scudo **raddoppia**.
- Disattivi la stance con un altro toggle.

**Quando conviene**:
- Sei sotto pressione (HP basso, dadi finiti).
- Aspetti che il nemico bruci slancio in attacchi che fa rimbalzare passivamente.

**Trade-off**: l'imp dello scudo raddoppiato erode tutti i tuoi tiri. La stance è una scelta strategica per turno, non un default.

### 12.3 Asta movimento (zona di controllo)

**L'idea**: chi impugna una lancia minaccia un'area attorno a sé. Per attraversare quella zona devi "battere il bid".

**Quando si attiva**:
- Tu vuoi muoverti su un esagono che è entro **reach >= 4** di un nemico vivo, con slancio > 0, che impugna una lancia.
- Solo le **lance** (lancia 2m reach 4, lancia 3m reach 6) attivano. Le altre armi reach (spada lunga reach 2) non sono abbastanza lunghe.

**Procedura**:
1. Tu (attaccante del movimento) e il difensore scegliete simultaneamente in privato una **puntata in slancio** in `[0, slancio attuale]`.
2. Si rivelano:
   - `bid_atk >= bid_def` → tu passi l'esagono (parità vince attaccante).
   - Altrimenti il movimento si ferma all'esagono precedente.
3. **Entrambi pagano** la propria puntata in slancio, indipendentemente da chi vince.

**Implicazione**:
- Le lance creano "muri di slancio" che il nemico deve superare.
- Sprecare slancio in bid persi peggio per te a doppio: hai pagato e non sei avanzato.
- È mind game puro: nessun dado tirato, solo lettura dell'avversario.

---

## 13. Strategie e build

Le 3 build base che il gioco supporta:

### Spadaccino offensivo (spada lunga 2h + armatura media)
- **Forza**: alta variabile + bonus condizionato. Funziona bene contro arciere (mischia).
- **Debolezza**: niente scudo → vulnerabile al ranged se non ha slancio alto.
- **Skill chiave**: `−1 imp [armature]` + `+1 tiro [attaccare][spade]`.

### Tank (mazza + scudo medio + armatura media)
- **Forza**: parate quasi imbattibili con scudo + armatura assorbente. Sopravvive a tutto.
- **Debolezza**: senza skill di mobilità è una statua. Perde nel timing dell'iniziativa.
- **Skill chiave**: `−1 imp` × N pezzi (azzera tutto) + `+1 tiro [parare]` + `+1 dado max [slancio]`.

### Arciere (arco lungo + pugnale offhand + armatura leggera)
- **Forza**: ranged dominante a distanza, pugnale come fall-back se chiuso.
- **Debolezza**: in mischia perde quasi sempre.
- **Skill chiave**: `+1 tiro [attaccare][archi]` + `+1 dado max [slancio]` per fuga.

### Decisioni chiave runtime

**Atk dice 1 vs 2**:
- 1 dado = risparmio per difese future, ma più variance.
- 2 dadi = più affidabile, ma esponi al turn dopo.

**Schivata vs parata**:
- Avversario con arma fisso-puro (mazza, balestra) → schivata.
- Avversario con dadi propri (spada, arco) → parata.
- HP basso → parata (riduce variance).

**Spendere slancio in mobilità o tenerlo**:
- Mobilità ora se devi chiudere/fuggire.
- Tenerlo se l'avversario è arciere (slancio_target è la tua difesa primaria).

---

## Glossario rapido

- **Hex**: un esagono della griglia.
- **Basetta**: i 7 esagoni occupati da un'unità (1 centrale + 6 corona).
- **Reach**: distanza massima a cui un'arma colpisce in mischia.
- **Distanza**: range massimo di un'arma a tiro.
- **N**: divisore del malus distanza per le armi ranged. Più alto = arma decade meno.
- **Variabile / Fissa**: le due parti di ogni tiro (vedi cap. 6).
- **Carica**: bonus per essersi avvicinati al target (cap. 12.1).
- **Stance**: posizione difensiva (cap. 12.2).
- **Asta**: bid privato simultaneo per attraversare zona di controllo (cap. 12.3).

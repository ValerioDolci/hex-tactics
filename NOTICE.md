# Copyright Notice

**hex-tactics** — Tactical 1v1 RPG su griglia esagonale.

© 2026 Valerio Dolci. Tutti i diritti riservati.

---

## Cosa significa "tutti i diritti riservati"

Il codice in questo repository **non ha una licenza open source**. Pur essendo
visibile pubblicamente:

- ✅ Puoi **leggere** il codice e il design del gioco.
- ✅ Puoi **giocare** la build pubblica all'indirizzo
  <https://valeriodolci.github.io/hex-tactics-play/>.
- ✅ Puoi **discuterne** apertamente, citarlo come riferimento.
- ❌ **Non puoi copiare, modificare, ridistribuire** il codice senza un mio
  permesso scritto esplicito.
- ❌ **Non puoi pubblicare un fork**, una build derivata, o un gioco basato sul
  codice di questo repo.
- ❌ **Non puoi usare il codice in progetti commerciali o open-source**.

L'autore (ValerioDolci) si riserva di concedere licenze d'uso caso per caso
tramite contatto diretto.

## Idee, regole e meccaniche del gioco

Le **regole di gioco** (architettura tiri variabile/fissa, asta zona di
controllo, sistema slancio/impeto, skill system, ecc.) sono parte del design
e non ricadono direttamente sotto copyright del codice (negli USA e UE le
"regole di gioco" come concept non sono brevettabili né tutelate da
copyright). Tuttavia ogni **espressione specifica** delle regole nel codice
è coperta da copyright.

In altre parole: puoi leggere come funziona il gioco e progettare un tuo
sistema diverso ispirato a questo, ma non puoi riusare le linee di codice
in `src/`, `python/`, o gli artifact di training (modelli, dataset).

## Modelli AI

I modelli distillati Deep CFR (`public/student_multi.onnx`,
`src/ai/studentMlpWeights.ts`) sono parte di questo lavoro e seguono la
stessa policy: leggibili sì, riutilizzabili no.

## Contatti

Per richieste di licenza, collaborazioni, o segnalazioni:
- GitHub Issues: <https://github.com/ValerioDolci/hex-tactics/issues>

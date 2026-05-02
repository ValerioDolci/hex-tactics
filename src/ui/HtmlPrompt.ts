/**
 * Prompt HTML overlay — un sostituto bello di `window.prompt()`.
 *
 * Phaser non ha widget di input testuale nativi affidabili. Per evitare
 * il `window.prompt()` di sistema (che è brutto e disabilita il rendering del gioco),
 * inseriamo un overlay HTML direttamente nel DOM, sopra il canvas Phaser.
 *
 * Usage:
 *   const value = await htmlPrompt({ title: 'Nome build', default: 'Custom' });
 *   if (value !== null) { ... }
 *
 * Stili inline per non dipendere da CSS esterno.
 */

export interface HtmlPromptOptions {
  /** Titolo mostrato in alto al box */
  title: string;
  /** Valore iniziale dell'input */
  default?: string;
  /** Placeholder se input vuoto */
  placeholder?: string;
  /** Lunghezza massima */
  maxLength?: number;
  /** Etichetta del bottone OK (default "OK") */
  okLabel?: string;
  /** Etichetta del bottone Cancel (default "Annulla") */
  cancelLabel?: string;
}

/**
 * Mostra un prompt HTML modale e ritorna una Promise.
 * Risolve con la stringa inserita oppure `null` se l'utente ha annullato.
 */
export function htmlPrompt(opts: HtmlPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'background: rgba(0,0,0,0.75)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'z-index: 99999',
      'font-family: monospace',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background: #1a2530',
      'border: 3px solid #6699bb',
      'border-radius: 6px',
      'padding: 24px',
      'min-width: 380px',
      'max-width: 90vw',
      'box-shadow: 0 8px 32px rgba(0,0,0,0.6)',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = opts.title;
    title.style.cssText = [
      'color: #fff',
      'font-size: 16px',
      'font-weight: bold',
      'margin-bottom: 14px',
    ].join(';');

    const input = document.createElement('input');
    input.type = 'text';
    input.value = opts.default ?? '';
    if (opts.placeholder) input.placeholder = opts.placeholder;
    if (opts.maxLength) input.maxLength = opts.maxLength;
    input.style.cssText = [
      'width: 100%',
      'padding: 10px 12px',
      'background: #222a35',
      'color: #fff',
      'border: 2px solid #556677',
      'border-radius: 4px',
      'font-family: monospace',
      'font-size: 14px',
      'outline: none',
      'box-sizing: border-box',
    ].join(';');
    input.addEventListener('focus', () => {
      input.style.borderColor = '#6699bb';
    });
    input.addEventListener('blur', () => {
      input.style.borderColor = '#556677';
    });

    const buttons = document.createElement('div');
    buttons.style.cssText = [
      'display: flex',
      'justify-content: flex-end',
      'gap: 12px',
      'margin-top: 16px',
    ].join(';');

    const cancelBtn = document.createElement('button');
    cancelBtn.textContent = opts.cancelLabel ?? 'Annulla';
    cancelBtn.style.cssText = [
      'padding: 10px 20px',
      'background: #554433',
      'color: #fff',
      'border: 2px solid #886633',
      'border-radius: 4px',
      'font-family: monospace',
      'font-size: 13px',
      'cursor: pointer',
    ].join(';');
    cancelBtn.addEventListener('click', () => cleanup(null));

    const okBtn = document.createElement('button');
    okBtn.textContent = opts.okLabel ?? 'OK';
    okBtn.style.cssText = [
      'padding: 10px 20px',
      'background: #336633',
      'color: #fff',
      'border: 2px solid #66aa66',
      'border-radius: 4px',
      'font-family: monospace',
      'font-size: 13px',
      'font-weight: bold',
      'cursor: pointer',
    ].join(';');
    okBtn.addEventListener('click', () => cleanup(input.value));

    // Tasti rapidi: Enter = OK, Escape = Cancel
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter') {
        e.preventDefault();
        cleanup(input.value);
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cleanup(null);
      }
    };
    input.addEventListener('keydown', onKeydown);

    let cleanedUp = false;
    const cleanup = (result: string | null): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      input.removeEventListener('keydown', onKeydown);
      try {
        document.body.removeChild(overlay);
      } catch {
        /* ignora */
      }
      resolve(result);
    };

    buttons.append(cancelBtn, okBtn);
    box.append(title, input, buttons);
    overlay.append(box);
    document.body.append(overlay);

    // Focus + select per editing rapido
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  });
}

/**
 * Versione "alert" — nessun input, solo OK.
 * Risolve quando l'utente clicca OK o preme Enter/Escape.
 */
export function htmlAlert(opts: { title: string; message: string; okLabel?: string }): Promise<void> {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = [
      'position: fixed',
      'inset: 0',
      'background: rgba(0,0,0,0.75)',
      'display: flex',
      'align-items: center',
      'justify-content: center',
      'z-index: 99999',
      'font-family: monospace',
    ].join(';');

    const box = document.createElement('div');
    box.style.cssText = [
      'background: #1a2530',
      'border: 3px solid #6699bb',
      'border-radius: 6px',
      'padding: 24px',
      'min-width: 380px',
      'max-width: 90vw',
      'box-shadow: 0 8px 32px rgba(0,0,0,0.6)',
    ].join(';');

    const title = document.createElement('div');
    title.textContent = opts.title;
    title.style.cssText = [
      'color: #fff',
      'font-size: 16px',
      'font-weight: bold',
      'margin-bottom: 12px',
    ].join(';');

    const message = document.createElement('div');
    message.textContent = opts.message;
    message.style.cssText = [
      'color: #cdd',
      'font-size: 14px',
      'white-space: pre-wrap',
      'line-height: 1.5',
    ].join(';');

    const buttons = document.createElement('div');
    buttons.style.cssText = [
      'display: flex',
      'justify-content: flex-end',
      'margin-top: 16px',
    ].join(';');

    const okBtn = document.createElement('button');
    okBtn.textContent = opts.okLabel ?? 'OK';
    okBtn.style.cssText = [
      'padding: 10px 24px',
      'background: #336633',
      'color: #fff',
      'border: 2px solid #66aa66',
      'border-radius: 4px',
      'font-family: monospace',
      'font-size: 13px',
      'font-weight: bold',
      'cursor: pointer',
    ].join(';');

    let cleanedUp = false;
    const cleanup = (): void => {
      if (cleanedUp) return;
      cleanedUp = true;
      document.removeEventListener('keydown', onKeydown);
      try {
        document.body.removeChild(overlay);
      } catch {
        /* ignora */
      }
      resolve();
    };
    okBtn.addEventListener('click', cleanup);
    const onKeydown = (e: KeyboardEvent): void => {
      if (e.key === 'Enter' || e.key === 'Escape') {
        e.preventDefault();
        cleanup();
      }
    };
    document.addEventListener('keydown', onKeydown);

    buttons.append(okBtn);
    box.append(title, message, buttons);
    overlay.append(box);
    document.body.append(overlay);
    requestAnimationFrame(() => okBtn.focus());
  });
}

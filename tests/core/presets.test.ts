import { describe, it, expect } from 'vitest';
import { PRESETS, getPreset, unitFromPreset } from '@data/presets';
import { Axial } from '@core/hex/coords';

describe('presets — distillati Deep CFR overnight 2026-05-06', () => {
  it('contiene 7 preset (3 baseline + 4 nuovi)', () => {
    const ids = PRESETS.map((p) => p.id).sort();
    expect(ids).toEqual([
      'arciere',
      'ascia1h_lanciatore',
      'balestriere',
      'giavellottiere',
      'lanciere',
      'spadaccino',
      'tank',
    ]);
  });

  it('lanciere: lancia_2m + scudo_piccolo + 2 lance throw + spada backup', () => {
    const lancer = getPreset('lanciere')!;
    expect(lancer.weapon).toBe('lancia_2m');
    expect(lancer.offhand).toBe('scudo_piccolo');
    expect(lancer.armor).toBe('armatura_media');
    expect(lancer.thrownInventory).toEqual(['lancia_2m', 'lancia_2m']);
    expect(lancer.backupWeapon).toBe('spada');
  });

  it('giavellottiere: 3 giavellotti throw + spada backup', () => {
    const g = getPreset('giavellottiere')!;
    expect(g.weapon).toBe('giavellotto');
    expect(g.thrownInventory).toEqual(['giavellotto', 'giavellotto', 'giavellotto']);
    expect(g.backupWeapon).toBe('spada');
  });

  it('ascia1h_lanciatore: 2 ascie throw + spada backup', () => {
    const a = getPreset('ascia1h_lanciatore')!;
    expect(a.weapon).toBe('ascia_1h');
    expect(a.thrownInventory).toEqual(['ascia_1h', 'ascia_1h']);
    expect(a.backupWeapon).toBe('spada');
  });

  it('balestriere: balestra + pugnale + armor leggera, no inventario', () => {
    const b = getPreset('balestriere')!;
    expect(b.weapon).toBe('balestra');
    expect(b.offhand).toBe('pugnale');
    expect(b.armor).toBe('armatura_leggera');
    expect(b.thrownInventory).toBeUndefined();
    expect(b.backupWeapon).toBeUndefined();
  });

  it('unitFromPreset(lanciere) trasferisce thrownInventory + backupWeapon su Unit', () => {
    const u = unitFromPreset(getPreset('lanciere')!, 'A', { q: 0, r: 0 } as Axial);
    expect(u.weapon).toBe('lancia_2m');
    expect(u.offhand).toBe('scudo_piccolo');
    expect(u.thrownInventory).toEqual(['lancia_2m', 'lancia_2m']);
    expect(u.backupWeapon).toBe('spada');
    expect(u.presetId).toBe('lanciere');
    expect(u.skills.length).toBe(5);
  });

  it('unitFromPreset(spadaccino) NON setta thrownInventory né backupWeapon', () => {
    const u = unitFromPreset(getPreset('spadaccino')!, 'A', { q: 0, r: 0 } as Axial);
    expect(u.thrownInventory).toBeUndefined();
    expect(u.backupWeapon).toBeUndefined();
  });

  it('tutti i preset hanno description non vuota', () => {
    for (const p of PRESETS) {
      expect(p.description.length).toBeGreaterThan(20);
    }
  });

  it('skill costs ragionevoli (nessun preset oltre 2050 exp)', () => {
    for (const p of PRESETS) {
      const total = p.skills.reduce((acc, s) => acc + (s.cost ?? 0), 0);
      expect(total).toBeLessThanOrEqual(2050);
    }
  });
});

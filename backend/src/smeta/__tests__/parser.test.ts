// ─── Smeta parser testlari (Vitest) ──────────────────────────────────────────
// Ishga tushirish:  npm i -D vitest  &&  npx vitest run
// Namuna PDF: backend/uploads/smetas/1782282596580.pdf (haqiqiy fayl).
import { describe, it, expect, beforeAll } from 'vitest';
import * as path from 'path';
import { parseSmeta, ParseResult } from '../index';
import { tokenizeNumbers, parseNum } from '../normalize';

const FIXTURE = path.join(__dirname, '../../../uploads/smetas/1782282596580.pdf');
let R: ParseResult;

beforeAll(async () => { R = await parseSmeta(FIXTURE, '1782282596580.pdf'); }, 60000);

describe('4-bo\'lim: resurslar (deterministik, aniq)', () => {
  it('308 ta resurs qatori', () => {
    expect(R.resources.length).toBe(308);
  });

  it('har guruh summasi deklaratsiya (СУМ) bilan mos (±1.5)', () => {
    for (const t of R.totals) {
      if (t.declared) expect(Math.abs(t.diff)).toBeLessThanOrEqual(1.5);
    }
  });

  it('№ ketma-ketligi uzluksiz 1..308', () => {
    const idx = R.resources.map(r => r.index);
    expect(idx[0]).toBe(1);
    expect(idx[idx.length - 1]).toBe(308);
    for (let i = 1; i < idx.length; i++) expect(idx[i]).toBe(idx[i - 1] + 1);
  });

  it('DUBLIKAT saqlanadi: ВОДА kamida 2 marta (birlashtirilmagan)', () => {
    const voda = R.resources.filter(r => /^ВОДА/i.test(r.rawName));
    expect(voda.length).toBeGreaterThanOrEqual(2);
  });

  it('DUBLIKAT saqlanadi: ПЕНА МОНТАЖНАЯ kamida 2 marta', () => {
    const pena = R.resources.filter(r => /ПЕНА\s*МОНТАЖ/i.test(r.rawName));
    expect(pena.length).toBeGreaterThanOrEqual(2);
  });

  it('narxsiz qator: ВОДА price = null', () => {
    const voda = R.resources.find(r => /^ВОДА/i.test(r.rawName));
    expect(voda?.price).toBeNull();
  });

  it('qty×price = total (barcha narxli qatorlarда, ±1.5)', () => {
    for (const r of R.resources) {
      if (r.price != null && r.total != null) {
        expect(Math.abs(r.qty * r.price - r.total)).toBeLessThanOrEqual(1.5);
      }
    }
  });

  it('ko\'p qatorli nom to\'g\'ri birlashtirilgan (ЩЕБЕНЬ ... ФРАКЦИИ)', () => {
    const shcheben = R.resources.find(r => /ЩЕБЕНЬ.*ФРАКЦИИ/i.test(r.rawName));
    expect(shcheben).toBeTruthy();
  });
});

describe('5-bo\'lim: ishlar + normalar', () => {
  it('ishlar va normalar bor', () => {
    expect(R.works.length).toBeGreaterThan(150);
    const norms = R.works.reduce((s, w) => s + w.norms.length, 0);
    expect(norms).toBeGreaterThan(500);
  });

  it('ish №3 = Е1101-013-03 + izoh + normalar', () => {
    const w3 = R.works.find(w => w.index === 3);
    expect(w3?.shifr).toBe('Е1101-013-03');
    expect(w3?.shifrNote).toContain('МИНСТРОЙ');
    expect(w3?.norms.length).toBeGreaterThanOrEqual(10);
  });
});

describe('meta + validatsiya', () => {
  it('НДС bilan bosh summa = 865 180 958', () => {
    expect(R.meta.totalWithVat).toBe(865180958);
  });
  it('validatsiya ok (xatolar yo\'q)', () => {
    expect(R.validation.errors).toHaveLength(0);
    expect(R.validation.ok).toBe(true);
  });
});

describe('raqam tokenizer (birlik testlari)', () => {
  it('birlashgan price+total to\'g\'ri ajraladi', () => {
    const t = tokenizeNumbers('4558,9629 \t36 030,00 164 259 433,29').map(x => x.value);
    expect(t).toEqual([4558.9629, 36030, 164259433.29]);
  });
  it('integer qty + guruhlangan raqamlar', () => {
    const t = tokenizeNumbers('8 42 232,00 337 856,00').map(x => x.value);
    expect(t).toEqual([8, 42232, 337856]);
  });
  it('MANFIY qiymat saqlanadi (вычитается позиция)', () => {
    expect(parseNum('-2,601')).toBe(-2.601);
    expect(parseNum('-0,03162')).toBe(-0.03162);
  });
  it('dash → null', () => {
    expect(parseNum('-')).toBeNull();
    expect(parseNum('--')).toBeNull();
  });
});

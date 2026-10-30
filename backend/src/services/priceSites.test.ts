import { describe, it, expect } from 'vitest';
import { normalizeSiteUrl, htmlToText, parseSite, probeSite } from './priceSites';

describe('normalizeSiteUrl', () => {
  it('protokolsiz manzilga https qo\u2018shadi', () => {
    expect(normalizeSiteUrl('narxlar.uz/sement')).toBe('https://narxlar.uz/sement');
  });

  it('ichki tarmoq manzillarini rad etadi (server o\u2018ziga so\u2018rov yubormasin)', () => {
    for (const bad of ['http://localhost/a', 'http://127.0.0.1/a', 'http://192.168.1.5/a', 'http://10.0.0.1/', 'http://172.16.0.1/', 'http://ichki.local/a']) {
      expect(normalizeSiteUrl(bad), bad).toBe('');
    }
  });

  it('http/https bo\u2018lmagan sxemani rad etadi', () => {
    expect(normalizeSiteUrl('file:///etc/passwd')).toBe('');
    expect(normalizeSiteUrl('javascript:alert(1)')).toBe('');
    expect(normalizeSiteUrl('')).toBe('');
  });
});

describe('htmlToText va parseSite', () => {
  it('skript va uslub matni narx deb olinmaydi', () => {
    const t = htmlToText('<style>.a{width:52000px}</style><script>var p=52000</script><p>Salom</p>');
    expect(t).not.toContain('52000');
    expect(t).toContain('Salom');
  });

  it('jadvaldagi narxlarni ajratadi', () => {
    const html = `<table>
      <tr><td>Sement M400</td><td>52 000 so'm/qop</td></tr>
      <tr><td>G'isht M100</td><td>1 200 so'm dona</td></tr>
    </table>`;
    const p = parseSite(html);
    expect(p.length).toBeGreaterThanOrEqual(2);
    expect(p.map((x) => x.price)).toContain(52000);
  });

  it('narx yozilmagan sahifadan hech nima olmaydi', () => {
    expect(parseSite('<p>Biz haqimizda</p><p>Aloqa</p>')).toHaveLength(0);
  });
});

describe('probeSite', () => {
  it('ochilmaydigan saytni aniq sabab bilan qaytaradi', async () => {
    const f = (async () => ({ ok: false, status: 503 })) as unknown as typeof fetch;
    const r = await probeSite('https://narxlar.uz', f);
    expect(r.ok).toBe(false);
    expect(r.error).toContain('503');
  });

  it('ishlaydigan saytda narx sonini va misolni beradi', async () => {
    const f = (async () => ({ ok: true, status: 200, text: async () => "<li>Sement M400 52 000 so'm/qop</li>" })) as unknown as typeof fetch;
    const r = await probeSite('narxlar.uz', f);
    expect(r.ok).toBe(true);
    expect(r.prices).toBe(1);
    expect(r.sample).toContain("so'm");
  });

  it('noto\u2018g\u2018ri manzilga umuman chiqmaydi', async () => {
    let called = false;
    const f = (async () => { called = true; return { ok: true, text: async () => '' }; }) as unknown as typeof fetch;
    const r = await probeSite('http://localhost/a', f);
    expect(r.ok).toBe(false);
    expect(called).toBe(false);
  });
});

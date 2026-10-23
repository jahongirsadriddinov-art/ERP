// SMM matn tozalagichi (owner 2026-10-23: "kanalga keraksiz matn chiqyapti"): faqat sarlavha + matn + heshteglar e'lon qilinadi.
import { describe, it, expect } from 'vitest';
import { asSmmItem, sanitizePost } from '../content';
import { formatChannelPost } from '../channel';

describe('sanitizePost', () => {
  it('yorliqlar, sahna/kadr ko\'rsatmalari, [Rasm: …], markdown, to\'ldiriladigan joylar olib tashlanadi; izohlar notes\'ga', () => {
    const r = sanitizePost({
      title: '**Sarlavha: «Smeta 5 daqiqada»**',
      text: [
        'Telegram post: Qog\'oz cheklar yo\'qolyaptimi? 😟',
        '',
        '## Yechim',
        'Instagram Reels / Karusel: Prorab **ovoz bilan** aytadi — chiqim o\'zi yoziladi. [Rasm: prorab telefonda]',
        '- Summani tushunadi',
        '* Obyektni tanlaydi',
        '',
        'Sahna 1: kamera prorabga yaqinlashadi',
        'Kadr 2 — ekran yozuvi',
        'Muharrir uchun: CTA ni kuchaytiring',
        'Format: 4:5 rasm',
        'Bog\'laning: [telefon raqami] yoki {link}',
        '---',
        '#qurilish #erp',
        'Sizningcha, bu qulaymi?',
      ].join('\n'),
      hashtags: ['#qurilish', 'smeta', 'yomon teg'],
    });
    expect(r.title).toBe('Smeta 5 daqiqada');
    expect(r.text).toBe([
      "Qog'oz cheklar yo'qolyaptimi? 😟",
      '',
      'Yechim',
      "Prorab ovoz bilan aytadi — chiqim o'zi yoziladi.",
      '• Summani tushunadi',
      '• Obyektni tanlaydi',
      '',
      "Bog'laning: yoki",
      'Sizningcha, bu qulaymi?',
    ].join('\n'));
    expect(r.hashtags).toEqual(['#qurilish', '#smeta', '#erp']);
    expect(r.notes.join(' | ')).toContain('Sahna 1');
    expect(r.notes.join(' | ')).toContain('CTA ni kuchaytiring');
    expect(r.notes.join(' | ')).toContain('[Rasm: prorab telefonda]');
  });

  it('oddiy matn (vaqt, raqamlar, ikki nuqta) buzilmaydi', () => {
    const t = "Ertaga soat 10:00 da vebinar.\nNarx: oyiga 290 000 so'm.\n1-qadam: ro'yxatdan o'ting.";
    expect(sanitizePost({ text: t }).text).toBe(t);
  });

  it('asSmmItem: body/editorNotes ajratiladi; kanal formati faqat e\'lon qilinadigan matnni oladi', () => {
    const it = asSmmItem({ title: 'Telegram post: GPS davomat', body: 'Caption: Ishchilar qayerda — xaritada.\n[Video: xarita kadri]', hashtags: '#gps #qurilish', editorNotes: 'Ertalab joylang' })!;
    expect(it).toMatchObject({ title: 'GPS davomat', text: 'Ishchilar qayerda — xaritada.', hashtags: ['#gps', '#qurilish'] });
    expect(it.editorNotes).toContain('Ertalab joylang');
    expect(it.editorNotes).toContain('[Video: xarita kadri]');
    const p = formatChannelPost({ title: '**Instagram: Yangi**', text: '### Matn\nMazmun **muhim**.\n\nSahna 1: kadr', hashtags: ['#erp'] });
    expect(p.captionHtml).toBe('<b>Yangi</b>\n\nMatn\nMazmun muhim.\n\n#erp');
  });
});

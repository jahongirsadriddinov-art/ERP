import { describe, expect, it } from 'vitest';
import { buildSystemPrompt } from '../systemPrompt';
import { buildGuestVoicePrompt, buildVoiceSystemPrompt } from '../../voice/prompts';
import { personaPromptLine } from '../../persona';

// Owner 2026-10-22: "AI to'liq o'zbekcha gapirsin — uslub, sheva, talaffuz; agent aqlliroq bo'lsin".
// Prompt Live qo'ng'iroqda har safar yuboriladi — o'lcham byudjeti ham tekshiriladi (kechikish/narx).

const voice = (lang: 'uz' | 'ru' = 'uz') => buildVoiceSystemPrompt({
  lang, role: 'prorab', channel: 'telegram_call', today: '2026-10-22', weekday: 4, purpose: 'assistant', direction: 'inbound',
});
const text = () => buildSystemPrompt({ lang: 'uz', role: 'direktor', channel: 'bot', today: '2026-10-22', weekday: 4, time: '10:00' });

describe("o'zbekcha nutq (ovoz)", () => {
  const v = voice();

  it('adabiy toshkentcha, kalkasiz, turkcha so\'zlarsiz', () => {
    expect(v).toMatch(/Toshkentcha adabiy/);
    expect(v).toMatch(/kalka qilmang/);
    expect(v).toMatch(/"tamam", "evet"/);
    expect(v).toMatch(/Doim "siz"; ism \+ "aka"\/"opa"/);
  });

  it("tovushlar: o/o', q/k, g'/g, x/h, ng, e; urg'u va ohang", () => {
    for (const r of [/"o" — ochiq, dumaloq/, /"o'" — rus "o"siga yaqin/, /"q" — bo'g'izdan.*"k" emas/, /"g'" — fransuzcha "r"dek.*"g" emas/,
      /"x" — qattiq xirillash.*"h" — yengil nafas/, /"ng" — bitta burun tovushi/, /"ye" emas \(ertaga\)/,
      /Urg'u odatda oxirgi bo'g'inda/, /inkor "-ma" urg'usiz/, /ohang ko'tariladi/]) {
      expect(v).toMatch(r);
    }
  });

  it("raqam, summa, sana, vaqt — so'z bilan; belgilar o'qilmaydi", () => {
    expect(v).toMatch(/"bir million ikki yuz ming so'm"/);
    expect(v).toMatch(/"yigirma ikkinchi oktabr"/);
    expect(v).toMatch(/"sakkiz yarim"/);
    expect(v).toMatch(/"uchinchi qavat"/);
    expect(v).toMatch(/emoji, markdown.*o'qimang/);
  });

  it("sheva, rus so'zlari va qurilish jargonini tushunish", () => {
    expect(v).toMatch(/turk, qozoq, qirg'iz, tojik/);
    expect(v).toMatch(/"rastvor", "nakladnoy", "limon"/);
    expect(v).toContain("QURILISH SO'ZLARI");
    for (const w of ['mardikor', 'smeta', 'avans', 'nakladnoy', 'priyomka', 'кирпич', '"limon"/"mln" = million']) expect(v, w).toContain(w);
  });

  it('mehmon qo\'ng\'irog\'i ham shu talaffuz qoidalarini oladi', () => {
    expect(buildGuestVoicePrompt({ lang: 'uz', today: '2026-10-22' })).toMatch(/TALAFFUZ:.*Urg'u odatda oxirgi bo'g'inda/);
  });

  it('rus rejimi — adabiy rus tili, sonlar so\'z bilan, standart o\'zbekchaga o\'tmaydi', () => {
    const r = voice('ru');
    expect(r).toMatch(/грамотном литературном русском/);
    expect(r).toMatch(/«один миллион двести тысяч сумов»/);
    expect(r).not.toMatch(/По умолчанию говорите по-узбекски/);
    expect(r).toMatch(/Javob tili: rus/);
  });

  it('persona: ayol/erkak ovozi — ruschada mos jins; samimiy o\'zbekona uslub', () => {
    expect(personaPromptLine(undefined, 'Kore')).toMatch(/поняла/);
    expect(personaPromptLine(undefined, 'Achird')).toMatch(/erkak ovozi.*понял"/);
    expect(personaPromptLine(undefined)).toMatch(/o'zbekona xushmuomala/);
  });
});

describe('aqlli matn agenti', () => {
  const p = text();

  it('qat\'iy tool ishlatish, bitta aniqlashtirish, tasdiq bir marta', () => {
    expect(p).toMatch(/ISHLASH TARTIBI/);
    expect(p).toMatch(/ketma-ket o'zingiz bajaring/);
    expect(p).toMatch(/ko'pi bilan BITTA savol, variantlari bilan/);
    expect(p).toMatch(/Tasdiq BIR MARTA/);
    expect(p).toMatch(/"ha" deyilgach qayta so'ramang/);
  });

  it('raqamli xulosa va muvaffaqiyat faqat tool status="ok" bilan', () => {
    expect(p).toMatch(/Raqamli xulosa: avval jami/);
    expect(p).toMatch(/status="ok" bo'lmagan amalni HECH QACHON "bajarildi" demang/);
    expect(p).toMatch(/listExpenses\(period="this_month", objectName="Olmazor"\)/);
  });

  it("kirill o'zbek yozuvi va oldingi gapga ishora", () => {
    expect(p).toMatch(/ў=o', ғ=g', қ=q, ҳ=h/);
    expect(p).toMatch(/oxirgi tilga olingan narsa/);
  });
});

describe("prompt o'lchami (Live kechikishi/narxi)", () => {
  // 2026-10-22 oldin: matn (bot, direktor) 9373, ovoz uz 11148, ovoz ru 10118, mehmon 2517 belgi.
  // 2026-10-29: 12 000 → 12 300. Yana ikki qoida qo'shildi (qo'ng'iroq kimga qilinishi va
  // qisqa javoblar oldingi so'rovga tegishli ekani) — ikkalasi ham owner xabar qilgan HAQIQIY
  // nosozlikdan kelib chiqqan. 40 ta belgi uchun shu qoidalarni qisqartirish — soxta tejamkorlik.
  // 2026-10-28: matn chegarasi 11 600 → 12 000. Sabab — owner shikoyatlari bo'yicha uchta qoida
  // qo'shildi: mavzu doirasi (ochiq muloqotsiz ERP bilan cheklanish), "qila olmayman" taqiqi va
  // qayta qo'ng'iroq (requestCallback) tartibi. Ular aynan noto'g'ri bajarilgan ishlarni tuzatadi.
  // 2026-10-30: matn 12 300 -> 13 000, ovoz 14 800 -> 15 500, ru 13 300 -> 14 000.
  // Sabab: owner "AI odamga juda yaqin o'xshasin — gapirishi, emotsiyasi, hazillar"
  // dedi va GAPIRISH USLUBI bloki qo'shildi (~600 belgi). Bu ONGLI kelishuv:
  // prompt biroz uzunroq, javob biroz sekinroq — lekin AI quruq idora tilida
  // emas, odamdek gapiradi. Blok ataylab qisqa: mavhum "iliq bo'l" o'rniga
  // qarama-qarshi misollar (model uchun shu kuchliroq va kamroq joy oladi).
  it('byudjetdan oshmaydi', () => {
    expect(text().length).toBeLessThan(13_000);
    expect(voice().length).toBeLessThan(15_500);
    expect(voice('ru').length).toBeLessThan(14_000);
    expect(buildGuestVoicePrompt({ lang: 'uz', today: '2026-10-22' }).length).toBeLessThan(3_600);
  });
});

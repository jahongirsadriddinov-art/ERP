import { describe, it, expect, beforeEach } from 'vitest';
import { tb } from '../../i18n/bot';
import { isMenuButtonText } from '../../aiVoice/bot/aiMode';
import {
  __resetBotUiForTests, canonicalizeIncomingText, canonicalizeUpdate, decorateMarkup, decorateMessage, findLabelConflicts,
  normalizeSnapshot, registerExtraLabelSource, setBotUiSnapshot, stripLeadingEmoji,
} from './runtime';
import { BOT_UI_CATALOG, messageEmojiCandidates } from './catalog';
import { sanitizeAiResult, candidatesFor } from './autoDecorate';

const use = (doc: any) => setBotUiSnapshot(normalizeSnapshot(doc));

describe('botUi runtime — tugmalar', () => {
  beforeEach(() => __resetBotUiForTests());

  it('sozlama yo\'q — klaviatura aynan o\'sha obyekt (hech narsa o\'zgarmaydi)', () => {
    const kb = { keyboard: [[{ text: tb('uz', 'kb_chat') }]], resize_keyboard: true };
    expect(decorateMarkup(kb)).toBe(kb);
    expect(canonicalizeIncomingText(tb('uz', 'kb_chat'))).toBe(tb('uz', 'kb_chat'));
  });

  it('matn (uz/ru), premium emoji ikonka va rang qo\'llanadi; asl obyekt o\'zgarmaydi', () => {
    use({ buttons: { kb_chat: { text: { uz: '💬 Suhbat', ru: '💬 Беседа' }, iconCustomEmojiId: '5368324170671202286', style: 'primary' } } });
    const kb = { keyboard: [[{ text: tb('uz', 'kb_chat') }], [{ text: tb('ru', 'kb_chat') }], [{ text: tb('uz', 'kb_objects') }]], resize_keyboard: true };
    const d = decorateMarkup(kb);
    expect(d).not.toBe(kb);
    // ikonka bor → matn boshidagi oddiy emoji olib tashlanadi (ikki marta ko'rinmasin)
    expect(d.keyboard[0][0]).toEqual({ text: 'Suhbat', icon_custom_emoji_id: '5368324170671202286', style: 'primary' });
    expect(d.keyboard[1][0]).toEqual({ text: 'Беседа', icon_custom_emoji_id: '5368324170671202286', style: 'primary' });
    expect(d.keyboard[2][0]).toEqual({ text: tb('uz', 'kb_objects') });
    expect(kb.keyboard[0][0]).toEqual({ text: tb('uz', 'kb_chat') });
  });

  it('kirill (uz-cyrl) matni uz\'dan avtomatik hosil bo\'ladi', () => {
    use({ buttons: { kb_objects: { text: { uz: 'Qurilishlar' } } } });
    const d = decorateMarkup({ keyboard: [[{ text: tb('uz-cyrl', 'kb_objects') }]] });
    expect(d.keyboard[0][0].text).toBe('Қурилишлар');
    expect(canonicalizeIncomingText('Қурилишлар')).toBe(tb('uz-cyrl', 'kb_objects'));
  });

  it('bosilgan (o\'zgartirilgan) matn standart matnga qaytadi — bot handlerlari va isMenuButtonText ishlayveradi', () => {
    use({ buttons: { kb_addExpense: { text: { uz: '💸 Xarajat yozish' }, iconCustomEmojiId: '111', style: 'success' } } });
    decorateMarkup({ keyboard: [[{ text: tb('uz', 'kb_addExpense') }]] });
    const pressed = 'Xarajat yozish'; // ikonka bor → emoji'siz
    expect(isMenuButtonText(pressed)).toBe(false);
    const c = canonicalizeIncomingText(pressed);
    expect(c).toBe(tb('uz', 'kb_addExpense'));
    expect(isMenuButtonText(c)).toBe(true);
    // eski klaviaturadagi standart matn ham ishlaydi
    expect(canonicalizeIncomingText(tb('uz', 'kb_addExpense'))).toBe(tb('uz', 'kb_addExpense'));
    // boshqa (menyuga aloqasiz) matn tegilmaydi
    expect(canonicalizeIncomingText('salom')).toBe('salom');
  });

  it('server qayta ishga tushgandan keyin ham (alias xotirasiz) canonicalize hisoblab topadi', () => {
    use({ buttons: { kb_report: { text: { ru: '📈 Отчёты' } } } });
    expect(canonicalizeIncomingText('📈 Отчёты')).toBe(tb('ru', 'kb_report'));
  });

  it('canonicalizeUpdate xabar matnini joyida almashtiradi, /buyruqlarga tegmaydi', () => {
    use({ buttons: { kb_chat: { text: { uz: 'Gaplashish' } } } });
    const u: any = { message: { text: 'Gaplashish', entities: [] } };
    canonicalizeUpdate(u);
    expect(u.message.text).toBe(tb('uz', 'kb_chat'));
    const c: any = { message: { text: '/start' } };
    canonicalizeUpdate(c);
    expect(c.message.text).toBe('/start');
  });

  it('inline tugmalar (callback_data saqlanadi) va JSON-satr reply_markup', () => {
    use({ buttons: { confirmYes: { iconCustomEmojiId: '42', style: 'success' }, confirmNo: { style: 'danger' } } });
    const markup = JSON.stringify({ inline_keyboard: [[{ text: tb('uz', 'confirmYes'), callback_data: 'y' }, { text: tb('uz', 'confirmNo'), callback_data: 'n' }]] });
    const d = JSON.parse(decorateMarkup(markup));
    expect(d.inline_keyboard[0][0]).toEqual({ text: 'Ha', callback_data: 'y', icon_custom_emoji_id: '42', style: 'success' });
    expect(d.inline_keyboard[0][1]).toEqual({ text: tb('uz', 'confirmNo'), callback_data: 'n', style: 'danger' });
  });

  it('AppSettings ("⚙️ Tugmalarni sozlash") orqali o\'zgartirilgan matn ham bezaladi va qaytariladi', () => {
    registerExtraLabelSource(() => [{ key: 'kb_broadcast', text: '📣 Elon' }]);
    use({ buttons: { kb_broadcast: { iconCustomEmojiId: '77' } } });
    const d = decorateMarkup({ keyboard: [[{ text: '📣 Elon' }]] });
    expect(d.keyboard[0][0]).toEqual({ text: 'Elon', icon_custom_emoji_id: '77' });
    expect(canonicalizeIncomingText('Elon')).toBe('📣 Elon');
  });

  it('noto\'g\'ri style/id e\'tiborsiz qoldiriladi', () => {
    use({ buttons: { kb_chat: { style: 'pink', iconCustomEmojiId: 'abc' } } });
    const kb = { keyboard: [[{ text: tb('uz', 'kb_chat') }]] };
    expect(decorateMarkup(kb)).toBe(kb);
  });

  it('matn to\'qnashuvi aniqlanadi', () => {
    expect(findLabelConflicts({ kb_chat: { text: { uz: tb('uz', 'kb_objects') } } })).not.toHaveLength(0);
    expect(findLabelConflicts({ kb_chat: { text: { uz: 'A' } }, kb_objects: { text: { uz: 'A' } } })).not.toHaveLength(0);
    expect(findLabelConflicts({ kb_chat: { text: { uz: 'Suhbat' } } })).toEqual([]);
  });

  it('stripLeadingEmoji', () => {
    expect(stripLeadingEmoji('⚙️ Tugmalarni sozlash')).toBe('Tugmalarni sozlash');
    expect(stripLeadingEmoji('🏗 Obyektlar')).toBe('Obyektlar');
    expect(stripLeadingEmoji('🔥')).toBe('🔥');
    expect(stripLeadingEmoji('Chat')).toBe('Chat');
  });

  it('katalog: barcha kalitlar takrorlanmas, standart matnlar bo\'sh emas', () => {
    const keys = BOT_UI_CATALOG.map(i => i.key);
    expect(new Set(keys).size).toBe(keys.length);
    for (const i of BOT_UI_CATALOG) { expect(i.defaults.uz).toBeTruthy(); expect(i.defaults.ru).toBeTruthy(); }
    expect(messageEmojiCandidates()).toContain('✅');
  });
});

describe('botUi runtime — xabarlardagi premium emoji', () => {
  beforeEach(() => __resetBotUiForTests());

  it('oddiy matn → custom_emoji entity (UTF-16 offset), mavjud entitylar saqlanadi', () => {
    use({ messageEmoji: [{ emoji: '✅', id: '900' }, { emoji: '🏗', id: '901' }] });
    const { text, opts } = decorateMessage('Salom ✅ va 🏗 obyekt', { entities: [{ type: 'bold', offset: 0, length: 5 }] });
    expect(text).toBe('Salom ✅ va 🏗 obyekt');
    expect(opts.entities).toEqual([
      { type: 'bold', offset: 0, length: 5 },
      { type: 'custom_emoji', offset: 6, length: 1, custom_emoji_id: '900' },
      { type: 'custom_emoji', offset: 11, length: 2, custom_emoji_id: '901' },
    ]);
  });

  it('HTML rejimi → <tg-emoji>, teglar ichiga tegmaydi', () => {
    use({ messageEmoji: [{ emoji: '✅', id: '900' }] });
    const r = decorateMessage('<b>✅ OK</b> <code>✅</code>', { parse_mode: 'HTML' });
    expect(r.text).toBe('<b><tg-emoji emoji-id="900">✅</tg-emoji> OK</b> <code>✅</code>');
  });

  it('Markdown (eski) rejimi HTML\'ga o\'giriladi va bezaladi; o\'chirilgan holat o\'zgarmaydi', () => {
    use({ messageEmoji: [{ emoji: '✅', id: '900' }] });
    const o = { parse_mode: 'Markdown' };
    expect(decorateMessage('✅ *ok* _x_ `a<b` [s](https://e.uz) 2\\*3', o)).toEqual({
      text: '<tg-emoji emoji-id="900">✅</tg-emoji> <b>ok</b> <i>x</i> <code>a&lt;b</code> <a href="https://e.uz">s</a> 2*3',
      opts: { parse_mode: 'HTML' },
    });
    use({ messageEmoji: [{ emoji: '✅', id: '900' }], messageEmojiEnabled: false });
    expect(decorateMessage('✅', undefined).opts).toBeUndefined();
  });
  it('emojisiz xabar — mazmuniga mos premium emoji boshiga; xaritada yo\'q emoji paketdan topiladi', () => {
    use({ packs: [{ stickers: [{ id: '501', emoji: '✅' }, { id: '502', emoji: '💰' }, { id: '503', emoji: 'ℹ️' }, { id: '504', emoji: '🔥' }] }] });
    const a = decorateMessage("Chiqim saqlandi", undefined);
    expect(a.text).toBe('✅ Chiqim saqlandi');
    expect(a.opts.entities).toEqual([{ type: 'custom_emoji', offset: 0, length: 1, custom_emoji_id: '501' }]);
    const b = decorateMessage('<b>Balans</b>: 5 000 so\'m', { parse_mode: 'HTML' });
    expect(b.text).toBe('<tg-emoji emoji-id="502">💰</tg-emoji> <b>Balans</b>: 5 000 so\'m');
    const c = decorateMessage('Yangi 🔥 xabar', undefined);
    expect(c.opts.entities).toEqual([{ type: 'custom_emoji', offset: 6, length: 2, custom_emoji_id: '504' }]);
    use({ packs: [{ stickers: [{ id: '501', emoji: '✅' }] }], messagePrefixEnabled: false });
    expect(decorateMessage('Chiqim saqlandi', undefined)).toEqual({ text: 'Chiqim saqlandi', opts: undefined });
  });
  it("katalogda yo'q (dinamik) tugmalar ham bezaladi: paketdan ikonka, vazifasiga qarab rang", () => {
    use({ packs: [{ stickers: [{ id: '601', emoji: '🏗' }, { id: '602', emoji: '❌' }] }] });
    const m = decorateMarkup({ inline_keyboard: [[{ text: '🏗 Yangi uy', callback_data: 'obj_1' }, { text: '❌ Bekor', callback_data: 'x' }, { text: 'Boshqa', callback_data: 'y' }]], });
    expect(m.inline_keyboard[0]).toEqual([
      { text: 'Yangi uy', callback_data: 'obj_1', icon_custom_emoji_id: '601', style: 'primary' },
      { text: 'Bekor', callback_data: 'x', icon_custom_emoji_id: '602', style: 'danger' },
      { text: 'Boshqa', callback_data: 'y', style: 'primary' },
    ]);
    const r = decorateMarkup({ keyboard: [['🏗 Obyekt A']] });
    expect(r.keyboard[0][0]).toEqual({ text: '🏗 Obyekt A', icon_custom_emoji_id: '601', style: 'primary' }); // reply matni o'zgarmaydi
  });
  it("AI ma'nosi mos bo'lmagan ikonkani qo'ya olmaydi: 'Ha'ga ✖ yo'q, 'Yo'q'ga ✔ yo'q", () => {
    const st = [{ id: '1', emoji: '✅' }, { id: '2', emoji: '❌' }, { id: '3', emoji: '✔️' }];
    const r = sanitizeAiResult({ buttons: { confirmYes: { icon: '2', style: 'success' }, confirmNo: { icon: '3', style: 'danger' }, kb_chat: { icon: '1' } }, messages: { '✅': '2', '❌': '2' } }, st);
    expect(r.buttons.confirmYes).toEqual({ style: 'success' });
    expect(r.buttons.confirmNo).toEqual({ style: 'danger' });
    expect(r.buttons.kb_chat).toBeUndefined();
    expect(r.messageEmoji).toEqual({ '❌': '2' });
    expect(candidatesFor('✅', st).map(s => s.id)).toEqual(['1', '3']);
  });
});

import { CHANNEL_NAMES, type ChannelAdapter, type ChannelName } from '../contracts';

// Kanal reestri — adapterlar DI orqali (bootstrap.ts) ro'yxatga olinadi, shuning uchun bu fayl
// hech bir adapterni import qilmaydi (bot.ts'ni modul darajasida yuklamaslik uchun ham — u
// tokensiz xato tashlaydi). Testlar soxta adapterlarni shu yerga qo'yadi.

const adapters = new Map<ChannelName, ChannelAdapter>();

export function registerChannel(adapter: ChannelAdapter): void {
  if (!CHANNEL_NAMES.includes(adapter.name)) throw new Error(`[aiVoice] noma'lum kanal: ${adapter.name}`);
  adapters.set(adapter.name, adapter);   // qayta ro'yxatga olish — almashtiradi (testlar/hot reload)
}

export function getChannel(name: ChannelName): ChannelAdapter | undefined {
  return adapters.get(name);
}

export function listChannels(): ChannelAdapter[] {
  return CHANNEL_NAMES.map((n) => adapters.get(n)).filter((a): a is ChannelAdapter => !!a);
}

/** Faqat testlar uchun. */
export function clearChannels(): void { adapters.clear(); }

// Kanal adapterlari interfeysi — contracts.ts'dagi muzlatilgan turlarning qayta eksporti.
// Adapterlar (botChannel, pushChannel, managerChannel, inAppCallChannel, telegramCallChannel)
// alohida fayllarda; ular registry'ga bootstrap orqali ro'yxatga olinadi (bu yerdan import qilinmaydi).
export type {
  ChannelName, ChannelAdapter, ChannelCtx, ChannelRequest, ChannelAttemptResult, ChannelOutcome, ChannelButton,
} from '../contracts';
export { CHANNEL_NAMES } from '../contracts';

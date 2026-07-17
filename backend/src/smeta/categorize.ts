// ─── Kategoriya (ixtiyoriy, parsing'ga daxlsiz post-processing) ───────────────
// Avval LUG'AT bilan (90%+ shu bilan yopiladi). AI mavjud bo'lmasa 'boshqa'.
// Parsing HECH QACHON kategoriyaga bog'liq emas — bu faqat filtr/guruhlash.

import { ResourceRow } from './types';

export type Category =
  | 'beton' | 'metall' | 'elektrika' | 'santexnika' | 'otdelka'
  | 'krovlya' | 'izolyatsiya' | 'krepezh' | 'mehanizm' | 'mehnat' | 'boshqa';

const DICT: { re: RegExp; cat: Category }[] = [
  { re: /БЕТОН|ЦЕМЕНТ|РАСТВОР|ЩЕБЕН|ПЕСОК|ЖЕЛЕЗОБЕТОН|КЕРАМЗИТ|ГРАВИЙ|БУТ/i, cat: 'beton' },
  { re: /КАБЕЛ|ПРОВОД|АВТОМАТ|РОЗЕТК|ВЫКЛЮЧАТЕЛ|СВЕТИЛЬНИК|ЛАМПА|ЭЛЕКТР|ВИДЕОКАМЕР|ЩИТ|ТРАНСФОРМАТОР|ИЗОЛЕНТА/i, cat: 'elektrika' },
  { re: /ТРУБА|КРАН|СМЕСИТЕЛ|УНИТАЗ|УМЫВАЛЬНИК|РАКОВИН|РАДИАТОР|ВЕНТИЛ|ЗАДВИЖ|САНТЕХ|КОЛОДЕЦ|ЛЮК|БАЧ|ДНИШ|КРИШК/i, cat: 'santexnika' },
  { re: /КРОВЛ|ЧЕРЕПИЦ|ПРОФНАСТИЛ|ШИФЕР|ОНДУЛИН|МЕМБРАН|КОНЁК/i, cat: 'krovlya' },
  { re: /ПЕНА\s*МОНТАЖ|УТЕПЛИТ|ПЕНОПЛАСТ|МИНВАТА|МИНЕРАЛОВАТ|ГИДРОИЗОЛ|ПАРОИЗОЛ|ПЕНОПОЛИСТИРОЛ|ИЗОЛЯЦ/i, cat: 'izolyatsiya' },
  { re: /ГВОЗД|САМОРЕЗ|ШУРУП|БОЛТ|ГАЙК|ДЮБЕЛ|АНКЕР|ЗАКЛЕПК|КРЕПЕЖ|КЛИН/i, cat: 'krepezh' },
  { re: /КРАСК|ШПАТЛ|ШПАКЛ|ГРУНТОВК|ОБОИ|ПЛИТК|ЛИНОЛЕУМ|ЛАМИНАТ|ГИПСОКАРТОН|ШТУКАТУР|ОБЛИЦ|ЗАТИРК|ГЕРМЕТИК|ФАЯНС|КЕРАМИЧ/i, cat: 'otdelka' },
  { re: /МЕТАЛЛ|СТАЛЬ|ПРОФИЛЬ|УГОЛОК|ШВЕЛЛЕР|БАЛКА|ФЕРМА|АРМАТУР|ПРОКАТ|ЛИСТ\s|ТРУБА\s*СТАЛ|СЕТКА|ПРОВОЛОК/i, cat: 'metall' },
];

/** Bitta resurs qatorini kategoriyalaydi (lug'at + guruh asosida). */
export function categorizeResource(r: ResourceRow): Category {
  if (r.group === 'labor') return 'mehnat';
  if (r.group === 'machinery') return 'mehanizm';
  const name = r.rawName || '';
  for (const d of DICT) if (d.re.test(name)) return d.cat;
  return 'boshqa';
}

/** Barcha resurslarga kategoriya qo'yadi (mutatsiya). */
export function applyCategories(resources: ResourceRow[]): void {
  for (const r of resources) r.category = categorizeResource(r);
}

// ─── AI hook (ixtiyoriy, KELAJAK) ────────────────────────────────────────────
// Lug'at topa olmagan ('boshqa') nomlarni batch (50 tadan) AI'ga yuborish mumkin.
// Hozircha OFF — parsing AI'ga bog'liq emas. Natijani DB'da cache qilish tavsiya:
// key = sha1(shifr + rawName). Bu yerda faqat interfeys qoldiramiz.
export interface CategorizeOptions { useAI?: boolean; }

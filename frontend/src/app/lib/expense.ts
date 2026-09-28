import type { ExpType } from "../App";

// Tavsifdan chiqim turini taxmin qilish (backend/src/services/botExpense.ts bilan bir xil kalit so'zlar)
const EXP_TYPE_KEYWORDS: [ExpType, RegExp][] = [
  ['oylik', /oylik|maosh|ish haqi|avans|premiya|mukofot|зарплат|оклад|аванс|премия/i],
  ['transport', /transport|benzin|dizel|yoqilg|solyarka|taksi|kamaz|yuk tashish|mashina|бензин|топлив|дизел|такси|доставк|перевозк|транспорт/i],
  ['jihozlar', /jihoz|asbob|uskuna|instrument|drel|kompressor|nasos|perforator|generator|arenda|ijara|оборудован|инструмент|аренд/i],
  ['material', /material|sement|g['’`ʻ]?isht|qum|shag['’`ʻ]?al|armatura|beton|taxta|bo['’`ʻ]?yoq|shifer|profil|gips|penoplast|kabel|quvur|цемент|кирпич|песок|щебень|арматур|бетон|доск|краск|гипс|кабел|труб|материал/i],
];
export function guessExpType(desc: string): ExpType | null {
  if (!desc || desc.trim().length < 3) return null;
  for (const [k, re] of EXP_TYPE_KEYWORDS) if (re.test(desc)) return k;
  return null;
}


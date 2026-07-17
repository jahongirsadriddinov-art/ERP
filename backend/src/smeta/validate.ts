// ─── Validatsiya — AI'siz aniqlikni kafolatlash ──────────────────────────────
import { ResourceRow, WorkRow, GroupTotal, Validation, ValidationCheck, ResourceGroup, SmetaMeta } from './types';

const TOL = 1.5; // yaxlitlash tolerantligi (so'm)

const GROUP_LABELS: Record<ResourceGroup, string> = {
  labor: 'ТРУДОВЫЕ РЕСУРСЫ',
  general: 'РЕСУРСЫ ОБЩЕГО НАЗНАЧЕНИЯ',
  machinery: 'СТРОИТЕЛЬНЫЕ МАШИНЫ',
  material: 'МАТЕРИАЛЬНЫЕ РЕСУРСЫ',
  equipment: 'ОБОРУДОВАНИЕ',
};

export function validate(
  resources: ResourceRow[],
  works: WorkRow[],
  declaredTotals: { group: ResourceGroup; declared: number | null }[],
  meta: SmetaMeta,
): { validation: Validation; totals: GroupTotal[] } {
  const checks: ValidationCheck[] = [];
  const warnings: string[] = [];
  const errors: string[] = [];

  // 1) Guruh summalari: hisoblangan ↔ deklaratsiya (СУМ)
  const totals: GroupTotal[] = [];
  const groups: ResourceGroup[] = ['labor', 'general', 'machinery', 'material', 'equipment'];
  for (const g of groups) {
    const rows = resources.filter(r => r.group === g);
    if (!rows.length) continue;
    const computed = Math.round(rows.reduce((s, r) => s + (r.total || 0), 0));
    const declEntry = declaredTotals.find(d => d.group === g && d.declared != null);
    const declared = declEntry?.declared ?? null;
    const passed = declared == null ? true : Math.abs(computed - declared) <= TOL;
    totals.push({ group: GROUP_LABELS[g], declared: declared ?? 0, computed, diff: declared == null ? 0 : computed - declared, passed });
    if (declared != null) {
      checks.push({ name: `Guruh summasi: ${GROUP_LABELS[g]}`, expected: declared, actual: computed, diff: computed - declared, passed });
      if (!passed) errors.push(`Guruh "${GROUP_LABELS[g]}" summasi mos kelmadi: hisob ${computed}, deklar ${declared} (farq ${computed - declared})`);
    }
  }

  // 2) Qator-daraja: qty × price ≈ total
  let rowMathFail = 0;
  for (const r of resources) {
    if (r.price != null && r.total != null) {
      if (Math.abs(r.qty * r.price - r.total) > TOL) {
        rowMathFail++;
        r.warnings.push(`qty×price (${(r.qty * r.price).toFixed(2)}) ≠ total (${r.total})`);
      }
    }
  }
  checks.push({ name: 'Qator hisobi (qty×price=total)', expected: 0, actual: rowMathFail, passed: rowMathFail === 0 });
  if (rowMathFail) warnings.push(`${rowMathFail} ta qatorда qty×price ≠ total`);

  // 3) № ketma-ketligi (resurslar) — uzilish = tashlab ketilgan qator
  const resGaps = sequenceGaps(resources.map(r => r.index));
  checks.push({ name: '№ ketma-ketligi (resurslar)', expected: 'uzluksiz', actual: resGaps.length ? resGaps.join(', ') : 'uzluksiz', passed: resGaps.length === 0 });
  if (resGaps.length) errors.push(`Resurs № uzilishlari (tashlab ketilgan qator?): ${resGaps.join(', ')}`);

  // 4) № ketma-ketligi (ishlar) — ogohlantirish (5-bo'lim kam kritik)
  const workGaps = sequenceGaps(works.map(w => w.index).filter(Number.isFinite));
  checks.push({ name: '№ ketma-ketligi (ishlar)', expected: 'uzluksiz', actual: workGaps.length ? workGaps.join(', ') : 'uzluksiz', passed: workGaps.length === 0 });
  if (workGaps.length) warnings.push(`Ish № uzilishlari: ${workGaps.join(', ')}`);

  // 5) Bosh summa (НДС bilan) topildimi
  checks.push({ name: 'Bosh summa (НДС bilan)', expected: 'topildi', actual: meta.totalWithVat != null ? String(meta.totalWithVat) : 'topilmadi', passed: meta.totalWithVat != null });
  if (meta.totalWithVat == null) warnings.push('Bosh summa (С УЧЕТОМ НДС) topilmadi — titul buzuq bo\'lishi mumkin');

  const ok = errors.length === 0;
  return { validation: { ok, checks, warnings, errors }, totals };
}

function sequenceGaps(nums: number[]): string[] {
  const gaps: string[] = [];
  for (let i = 1; i < nums.length; i++) {
    if (nums[i] !== nums[i - 1] + 1) gaps.push(`${nums[i - 1]}→${nums[i]}`);
  }
  return gaps;
}

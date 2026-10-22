// Excel faylni qurib saqlash (web — yuklab olish, Android — Download papkasi, Windows ilovasi — Yuklanmalar).
import { saveOrShareBlob } from '../../platform';
import type { AppUser, Expense, Project } from '../../App';
import { buildXlsx, XLSX_MIME, type SheetDef, type WorkbookMeta } from './writer';
import { expensesSheets } from './reportWorkbook';

export async function saveXlsx(filename: string, sheets: SheetDef[], meta: WorkbookMeta = {}): Promise<boolean> {
  const bytes = await buildXlsx(sheets, meta);
  const r = await saveOrShareBlob(filename.replace(/\.(csv|xls)$/i, '') + (/\.xlsx$/i.test(filename) ? '' : '.xlsx'), new Blob([bytes as BlobPart], { type: XLSX_MIME }));
  return r.ok;
}

export function saveExpensesXlsx(expenses: Expense[], users: AppUser[], projects: Project[], filename: string): Promise<boolean> {
  let company = '';
  try { company = localStorage.getItem('erp_companyName') || ''; } catch { /* */ }
  return saveXlsx(filename, expensesSheets(expenses, users, projects, company), { title: 'Chiqimlar', author: company || 'QurilishERP' });
}

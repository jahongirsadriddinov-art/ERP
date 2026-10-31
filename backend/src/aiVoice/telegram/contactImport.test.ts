// Owner 2026-10-30: "kontaktga qo'shilgan userlar ro'yxatga chiqmasin va
// kontaktga ulangan BARCHA akkauntlarga bittada qo'shsin".
import { describe, it, expect, vi, beforeEach } from 'vitest';

const users = [
  { _id: 'u1', firstName: 'Ali', lastName: 'V', role: 'ishchi', companyId: 'c1' },
  { _id: 'u2', firstName: 'Vali', lastName: '', role: 'prorab', companyId: 'c1' },
];
let contacts: any[] = [];
let connected: string[] = ['platform', 'acc-1'];

vi.mock('../../models/User', () => ({ default: {
  find: () => ({ select: () => ({ sort: () => ({ limit: () => ({ lean: async () => users }) }) }) }),
} }));
vi.mock('../../models/Company', () => ({ default: {
  find: () => ({ select: () => ({ lean: () => ({ catch: async () => [{ _id: 'c1', name: 'Alfa' }] }) }) }),
} }));
vi.mock('../../models/AiEmployeeContact', () => ({ default: {
  find: () => ({ select: () => ({ lean: () => ({ catch: async () => contacts }) }) }),
} }));
vi.mock('./accountService', () => ({ connectedAccountIds: async () => connected }));

import { listCandidates } from './contactImport';

beforeEach(() => { contacts = []; connected = ['platform', 'acc-1']; });

describe('listCandidates', () => {
  it('hech kim qo\u2018shilmagan bo\u2018lsa — hammasi chiqadi', async () => {
    expect((await listCandidates()).map((u) => u.id)).toEqual(['u1', 'u2']);
  });

  it('BARCHA ulangan akkauntga qo\u2018shilgan odam ro\u2018yxatda chiqmaydi', async () => {
    contacts = [{ employeeId: 'u1', telegram: { tgUserId: '1', importedAccounts: ['platform', 'acc-1'] } }];
    expect((await listCandidates()).map((u) => u.id)).toEqual(['u2']);
  });

  it('faqat BIR akkauntga qo\u2018shilgan bo\u2018lsa — baribir chiqadi', async () => {
    contacts = [{ employeeId: 'u1', telegram: { tgUserId: '1', importedAccounts: ['platform'] } }];
    const r = await listCandidates();
    expect(r.map((u) => u.id)).toEqual(['u1', 'u2']);
    expect(r[0]).toMatchObject({ accounts: 1, accountsTotal: 2 });
  });

  it('yangi akkaunt ulansa — avval qo\u2018shilganlar yana chiqadi', async () => {
    contacts = [{ employeeId: 'u1', telegram: { tgUserId: '1', importedAccounts: ['platform', 'acc-1'] } }];
    connected = ['platform', 'acc-1', 'acc-2'];
    expect((await listCandidates()).map((u) => u.id)).toEqual(['u1', 'u2']);
  });

  it('includeDone bilan qo\u2018shilganlar ham ko\u2018rinadi', async () => {
    contacts = [{ employeeId: 'u1', telegram: { tgUserId: '1', importedAccounts: ['platform', 'acc-1'] } }];
    expect((await listCandidates({ includeDone: true })).map((u) => u.id)).toEqual(['u1', 'u2']);
  });

  it('akkaunt umuman ulanmagan bo\u2018lsa — hech kim yashirilmaydi', async () => {
    connected = [];
    contacts = [{ employeeId: 'u1', telegram: { tgUserId: '1', importedAccounts: ['platform'] } }];
    expect((await listCandidates()).map((u) => u.id)).toEqual(['u1', 'u2']);
  });
});

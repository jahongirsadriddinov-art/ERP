// Guruh video chatini yakunlash — yo'q/yaroqsiz ma'lumot bilan ham NaN yozilmaydi va ilova yiqilmaydi
// (production: "lastVideoChat.durationSec: Cast to Number failed for value NaN", "activeVideoChat.mode … required").
import { describe, it, expect, beforeAll, afterAll, beforeEach, vi } from 'vitest';
import mongoose from 'mongoose';
import { MongoMemoryServer } from 'mongodb-memory-server';

vi.mock('./push', () => ({ sendPushToUser: vi.fn(() => Promise.resolve()) }));

import { finishVideoChat, leaveVideoChat } from './socket';
import { videoChatDurationSec, isValidActiveVideoChat, safeDate } from './videoChatState';
import Group from '../models/Group';
import Message from '../models/Message';

let mongo: MongoMemoryServer;
beforeAll(async () => {
  mongo = await MongoMemoryServer.create();
  await mongoose.connect(mongo.getUri());
}, 60000);
afterAll(async () => { await mongoose.disconnect(); await mongo?.stop(); });
beforeEach(async () => { await Group.deleteMany({}); await Message.deleteMany({}); });

// Validatsiyani chetlab "yarim" holatni yozamiz — eskirgan nusxa save() qilganda bazada aynan shunday paydo bo'lardi
async function groupWithRawChat(activeVideoChat: any) {
  const g = await Group.create({ name: 'G', memberIds: ['a', 'b'], createdBy: 'a' });
  await Group.collection.updateOne({ _id: g._id }, { $set: { activeVideoChat } });
  return (await Group.findById(g._id))!;
}

describe('videoChatState helpers', () => {
  it('duration is never NaN', () => {
    const end = new Date('2026-01-01T00:01:00Z');
    expect(videoChatDurationSec(new Date('2026-01-01T00:00:00Z'), end)).toBe(60);
    expect(videoChatDurationSec(undefined, end)).toBe(0);
    expect(videoChatDurationSec('garbage', end)).toBe(0);
    expect(videoChatDurationSec(new Date('2027-01-01'), end)).toBe(0);
    expect(safeDate(null)).toBeNull();
  });
  it('validates required fields', () => {
    expect(isValidActiveVideoChat({ startedBy: 'a', startedByName: 'A', startedAt: new Date(), mode: 'video', participantIds: [] })).toBe(true);
    expect(isValidActiveVideoChat({ participantIds: ['a'] })).toBe(false);
    expect(isValidActiveVideoChat(null)).toBe(false);
  });
});

describe('finishVideoChat / leaveVideoChat', () => {
  it('finishes a normal chat: duration saved, activeVideoChat unset, "ended" message posted', async () => {
    const g = await groupWithRawChat({ startedBy: 'a', startedByName: 'A', startedAt: new Date(Date.now() - 90_000), mode: 'video', participantIds: ['a'] });
    await finishVideoChat(g);
    const fresh: any = await Group.findById(g._id).lean();
    expect(fresh.activeVideoChat).toBeUndefined();
    expect(fresh.lastVideoChat.durationSec).toBeGreaterThanOrEqual(89);
    expect(await Message.countDocuments({ type: 'video_event' })).toBe(1);
  });

  it('partial chat (no startedAt/mode/startedBy) — durationSec 0, no NaN, no throw, no bogus message', async () => {
    const g = await groupWithRawChat({ participantIds: ['a'] });
    await expect(finishVideoChat(g)).resolves.toBeUndefined();
    const fresh: any = await Group.findById(g._id).lean();
    expect(fresh.activeVideoChat).toBeUndefined();
    expect(fresh.lastVideoChat.durationSec).toBe(0);
    expect(Number.isNaN(fresh.lastVideoChat.durationSec)).toBe(false);
    expect(await Message.countDocuments({})).toBe(0);
    // Keyingi oddiy save() endi required xatosi bermaydi
    const again = (await Group.findById(g._id))!;
    again.name = 'G2';
    await expect(again.save()).resolves.toBeTruthy();
  });

  it('invalid startedAt string → 0', async () => {
    const g = await groupWithRawChat({ startedBy: 'a', startedByName: 'A', startedAt: 'not-a-date', mode: 'video', participantIds: ['a'] });
    await finishVideoChat(g);
    const fresh: any = await Group.findById(g._id).lean();
    expect(fresh.lastVideoChat.durationSec).toBe(0);
  });

  it('stale copy leaving after the chat ended does not recreate a partial activeVideoChat', async () => {
    const g = await groupWithRawChat({ startedBy: 'a', startedByName: 'A', startedAt: new Date(), mode: 'video', participantIds: ['a', 'b'] });
    const stale = (await Group.findById(g._id))!;
    await finishVideoChat(g); // boshqa handler chatni tugatdi
    await leaveVideoChat(stale, 'b'); // eskirgan nusxa: 'a' qoladi deb o'ylaydi
    const fresh: any = await Group.findById(g._id).lean();
    expect(fresh.activeVideoChat).toBeUndefined();
  });

  it('leave keeps the rest of the participants and ends on the last one', async () => {
    const g = await groupWithRawChat({ startedBy: 'a', startedByName: 'A', startedAt: new Date(), mode: 'voice', participantIds: ['a', 'b'] });
    await leaveVideoChat(g, 'b');
    let fresh: any = await Group.findById(g._id).lean();
    expect(fresh.activeVideoChat.participantIds).toEqual(['a']);
    await leaveVideoChat(g, 'a');
    fresh = await Group.findById(g._id).lean();
    expect(fresh.activeVideoChat).toBeUndefined();
  });

  it('leave on a partial chat clears it silently', async () => {
    const g = await groupWithRawChat({ participantIds: ['a', 'b'] });
    await expect(leaveVideoChat(g, 'a')).resolves.toBeUndefined();
    const fresh: any = await Group.findById(g._id).lean();
    expect(fresh.activeVideoChat).toBeUndefined();
  });

  it('a DB failure is logged, not thrown', async () => {
    const spy = vi.spyOn(Group, 'updateOne').mockRejectedValueOnce(new Error('db down'));
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    await expect(finishVideoChat({ _id: new mongoose.Types.ObjectId(), activeVideoChat: { participantIds: [] } })).resolves.toBeUndefined();
    expect(err).toHaveBeenCalled();
    spy.mockRestore(); err.mockRestore();
  });
});

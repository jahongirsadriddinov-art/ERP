// Birlik sinovlari: SigV4 (AWS rasmiy test vektorlari), S3 mijozi (soxta fetch), shifrlash, saqlash siyosati, bo'laklar.
import { describe, it, expect } from 'vitest';
import { signRequest, signingKey, EMPTY_SHA256, S3Client, parseListXml, s3ConfigFromEnv, uriEncode, canonicalQuery } from './sigv4';
import { encryptBuffer, decryptBuffer, primaryKey, allKeys, isArchive, archiveKeyId, ArchiveKeyError } from './archive';
import { selectRetention, isoWeekKey } from './retention';
import { splitParts, joinParts, partFileName } from './telegram';
import { parseArchiveKey, archiveKeyFor, lastSlot } from './index';

describe('SigV4 — AWS test vektorlari', () => {
  it('imzolash kaliti (AWS hujjatidagi misol: iam, 20120215)', () => {
    expect(signingKey('wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', '20120215', 'us-east-1', 'iam').toString('hex'))
      .toBe('f4780e2d9f65fa895f9c67b32ce1baf0b0d8a43505a000a1a9e090d414db404d');
  });
  it('aws-sig-v4-test-suite: get-vanilla', () => {
    const r = signRequest({ method: 'GET', path: '/', headers: { Host: 'example.amazonaws.com', 'X-Amz-Date': '20150830T123600Z' }, payloadHash: EMPTY_SHA256,
      accessKeyId: 'AKIDEXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 'service', amzDate: '20150830T123600Z' });
    expect(r.canonicalRequest).toBe('GET\n/\n\nhost:example.amazonaws.com\nx-amz-date:20150830T123600Z\n\nhost;x-amz-date\n' + EMPTY_SHA256);
    expect(r.signature).toBe('5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
    expect(r.authorization).toBe('AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE/20150830/us-east-1/service/aws4_request, SignedHeaders=host;x-amz-date, Signature=5fa00fa31553b73ebf1942676e86291e8372ff2a2260956d9b8aae1d763fbf31');
  });
  it('S3 hujjatidagi misol: GET /test.txt (Range bilan)', () => {
    const r = signRequest({ method: 'GET', path: '/test.txt', headers: { host: 'examplebucket.s3.amazonaws.com', range: 'bytes=0-9', 'x-amz-content-sha256': EMPTY_SHA256, 'x-amz-date': '20130524T000000Z' },
      payloadHash: EMPTY_SHA256, accessKeyId: 'AKIAIOSFODNN7EXAMPLE', secretAccessKey: 'wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY', region: 'us-east-1', service: 's3', amzDate: '20130524T000000Z' });
    expect(r.signature).toBe('f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41');
  });
  it('URI va so\'rov satri kodlash', () => {
    expect(uriEncode('a b/c+d~', false)).toBe('a%20b/c%2Bd~');
    expect(canonicalQuery({ prefix: 'x/y', 'list-type': '2' })).toBe('list-type=2&prefix=x%2Fy');
  });
});

describe('S3 mijozi (soxta fetch)', () => {
  const cfg = { endpoint: 'https://acc.r2.cloudflarestorage.com', bucket: 'erp-zaxira', accessKeyId: 'AK', secretAccessKey: 'SK', region: 'auto', pathStyle: true };
  it('PUT: path-style URL, imzo sarlavhalari, tana xeshi', async () => {
    const calls: any[] = [];
    const f: any = async (url: string, init: any) => { calls.push({ url, init }); return new Response('', { status: 200, headers: { etag: '"x"' } }); };
    const c = new S3Client(cfg, f, () => new Date('2026-10-26T01:02:03Z'));
    await c.put('qurilish-erp-backups/full/a b.qbk', Buffer.from('salom'));
    expect(calls[0].url).toBe('https://acc.r2.cloudflarestorage.com/erp-zaxira/qurilish-erp-backups/full/a%20b.qbk');
    expect(calls[0].init.method).toBe('PUT');
    expect(calls[0].init.headers['x-amz-date']).toBe('20261026T010203Z');
    expect(calls[0].init.headers['x-amz-content-sha256']).toMatch(/^[a-f0-9]{64}$/);
    expect(calls[0].init.headers.authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AK\/20261026\/auto\/s3\/aws4_request, SignedHeaders=content-type;host;x-amz-content-sha256;x-amz-date, Signature=[a-f0-9]{64}$/);
  });
  it('LIST: sahifalash va XML tahlili; xato — kod bilan', async () => {
    let n = 0;
    const f: any = async (url: string) => {
      n++;
      if (n === 1) { expect(url).toContain('list-type=2'); return new Response('<ListBucketResult><IsTruncated>true</IsTruncated><NextContinuationToken>t&amp;1</NextContinuationToken><Contents><Key>p/a.qbk</Key><Size>10</Size><LastModified>2026-10-01T00:00:00Z</LastModified></Contents></ListBucketResult>'); }
      expect(url).toContain('continuation-token=t%261');
      return new Response('<ListBucketResult><IsTruncated>false</IsTruncated><Contents><Key>p/b &amp; c.qbk</Key><Size>20</Size></Contents></ListBucketResult>');
    };
    const list = await new S3Client(cfg, f).list('p/');
    expect(list.map((x) => x.key)).toEqual(['p/a.qbk', 'p/b & c.qbk']);
    const bad: any = async () => new Response('<Error><Code>AccessDenied</Code><Message>no</Message></Error>', { status: 403 });
    await expect(new S3Client(cfg, bad).get('k')).rejects.toThrow(/AccessDenied/);
  });
  it('virtual-host uslubi va env sozlamasi', async () => {
    let u = '';
    const f: any = async (url: string) => { u = url; return new Response('ok'); };
    await new S3Client({ ...cfg, pathStyle: false }, f).get('x/y.qbk');
    expect(u).toBe('https://erp-zaxira.acc.r2.cloudflarestorage.com/x/y.qbk');
    expect(s3ConfigFromEnv({ BACKUP_S3_BUCKET: 'b', BACKUP_S3_ACCESS_KEY_ID: 'a', BACKUP_S3_SECRET_ACCESS_KEY: 's' } as any)).toMatchObject({ endpoint: 'https://s3.us-east-1.amazonaws.com', region: 'auto', pathStyle: true });
    expect(s3ConfigFromEnv({} as any)).toBeNull();
    expect(parseListXml('<x/>')).toEqual([]);
  });
});

describe('shifrlash', () => {
  const env = { BACKUP_ENCRYPTION_KEY: 'juda-maxfiy-kalit-1234567890' } as any;
  it('aylanma: shifrlash → ochish; sarlavha va kalit ID', () => {
    const k = primaryKey(env)!;
    expect(k.source).toBe('BACKUP_ENCRYPTION_KEY');
    const plain = Buffer.from('maxfiy firma ma\'lumoti '.repeat(100));
    const file = encryptBuffer(plain, k);
    expect(isArchive(file)).toBe(true);
    expect(archiveKeyId(file)).toBe(k.id);
    expect(file.includes(Buffer.from('maxfiy firma'))).toBe(false); // ochiq matn yo'q
    expect(decryptBuffer(file, allKeys(env)).equals(plain)).toBe(true);
  });
  it("o'zgartirilgan fayl va boshqa kalit — rad etiladi; _PREV kalit bilan ochiladi", () => {
    const k = primaryKey(env)!;
    const file = encryptBuffer(Buffer.from('abc'), k);
    const tampered = Buffer.from(file); tampered[tampered.length - 20] ^= 1;
    expect(() => decryptBuffer(tampered, allKeys(env))).toThrow(ArchiveKeyError);
    expect(() => decryptBuffer(file, allKeys({ BACKUP_ENCRYPTION_KEY: 'boshqa-kalit-xxxxxxxx' } as any))).toThrow(/boshqa kalit/);
    expect(decryptBuffer(file, allKeys({ BACKUP_ENCRYPTION_KEY: 'yangi-kalit-yyyyyyyy', BACKUP_ENCRYPTION_KEY_PREV: 'juda-maxfiy-kalit-1234567890' } as any)).toString()).toBe('abc');
  });
  it('kalit manbai: AI_SECRETS_KEY, keyin JWT_SECRET (standart "secret" emas)', () => {
    expect(primaryKey({ AI_SECRETS_KEY: 'a'.repeat(64) } as any)!.source).toBe('AI_SECRETS_KEY');
    expect(primaryKey({ JWT_SECRET: 'secret' } as any)).toBeNull();
    expect(primaryKey({ JWT_SECRET: 'uzun-jwt-maxfiy-satr-123' } as any)!.source).toBe('JWT_SECRET');
  });
});

describe('saqlash siyosati (14 kunlik / 8 haftalik / 12 oylik)', () => {
  it('400 kunlik kunlik arxivlardan to\'g\'ri to\'plamni qoldiradi', () => {
    const now = new Date('2026-10-26T00:00:00Z');
    const items = Array.from({ length: 400 }, (_, i) => ({ key: `d${i}`, createdAt: new Date(now.getTime() - i * 86400000 - 3600000), scheduled: true }));
    const { keep, prune } = selectRetention(items, now);
    expect(keep.length + prune.length).toBe(400);
    for (let i = 0; i < 14; i++) expect(keep).toContain(`d${i}`); // oxirgi 14 kun
    const weeks = new Set(keep.map((k) => isoWeekKey(items[Number(k.slice(1))].createdAt)));
    expect(weeks.size).toBeGreaterThanOrEqual(8);
    const months = new Set(keep.map((k) => items[Number(k.slice(1))].createdAt.toISOString().slice(0, 7)));
    expect(months.size).toBe(12);
    expect(keep.length).toBeLessThanOrEqual(14 + 8 + 12);
    expect(prune).toContain('d399');
  });
  it("rejasiz arxivlar 60 kun turadi; eng yangi hech qachon o'chmaydi", () => {
    const now = new Date('2026-10-26T00:00:00Z');
    const r = selectRetention([
      { key: 'old-manual', createdAt: new Date('2026-07-01T00:00:00Z'), scheduled: false },
      { key: 'new-manual', createdAt: new Date('2026-10-20T00:00:00Z'), scheduled: false },
      { key: 'only-daily', createdAt: new Date('2020-01-01T00:00:00Z'), scheduled: true },
    ], now);
    expect(r.prune).toEqual(['old-manual']);
    expect(isoWeekKey(new Date('2026-01-01T00:00:00Z'))).toBe('2026-W01');
  });
});

describe('arxiv nomi, jadval, Telegram bo\'laklari', () => {
  it('kalit nomi → sana/sabab/doira', () => {
    const at = new Date('2026-10-26T22:00:05Z');
    const { key } = archiveKeyFor('company', '65a1b2c3d4e5f60718293a4b', 'pre_reset', at);
    expect(key).toMatch(/^qurilish-erp-backups\/company\/65a1b2c3d4e5f60718293a4b\/2026\/10\/company-65a1b2c3d4e5f60718293a4b_2026-10-26T22-00-05Z_pre_reset_[a-f0-9]{4}\.qbk$/);
    expect(parseArchiveKey(key)).toEqual({ createdAt: at, reason: 'pre_reset', scope: 'company', companyId: '65a1b2c3d4e5f60718293a4b' });
    expect(parseArchiveKey(archiveKeyFor('full', undefined, 'daily', at).key)).toMatchObject({ scope: 'full', reason: 'daily' });
  });
  it('kunlik vaqt: Toshkent 03:00 = UTC 22:00', () => {
    expect(lastSlot(new Date('2026-10-26T21:59:00Z'), 3).toISOString()).toBe('2026-10-25T22:00:00.000Z');
    expect(lastSlot(new Date('2026-10-26T22:01:00Z'), 3).toISOString()).toBe('2026-10-26T22:00:00.000Z');
  });
  it("bo'lish va qayta yig'ish (tartibsiz yuklansa ham)", () => {
    const buf = Buffer.from(Array.from({ length: 1000 }, (_, i) => i % 256));
    const parts = splitParts(buf, 300);
    expect(parts.length).toBe(4);
    const files = parts.map((d, i) => ({ name: partFileName('x.qbk', i, parts.length), data: d })).reverse();
    expect(joinParts(files).equals(buf)).toBe(true);
    expect(() => joinParts(files.slice(1))).toThrow(/to'liq emas/);
    expect(joinParts([{ name: 'x.qbk', data: buf }]).equals(buf)).toBe(true);
  });
});

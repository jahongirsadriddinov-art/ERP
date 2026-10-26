// AWS Signature Version 4 (SigV4) — S3-mos obyekt xotirasi (Cloudflare R2, Backblaze B2, AWS S3, MinIO) uchun
// imzolangan PUT/GET/LIST/DELETE so'rovlari. Yangi kutubxona qo'shilmadi: faqat node:crypto + global fetch.
// Rasmiy hujjat: https://docs.aws.amazon.com/IAM/latest/UserGuide/reference_sigv-create-signed-request.html
import crypto from 'crypto';

export const EMPTY_SHA256 = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export const sha256Hex = (data: string | Buffer | Uint8Array) => crypto.createHash('sha256').update(data).digest('hex');
const hmac = (key: crypto.BinaryLike, data: string) => crypto.createHmac('sha256', key).update(data, 'utf8').digest();

/** RFC 3986 bo'yicha kodlash (AWS talabi: faqat A-Z a-z 0-9 - _ . ~ ochiq qoladi). */
export function uriEncode(s: string, encodeSlash = true): string {
  let out = '';
  for (const ch of Buffer.from(s, 'utf8')) {
    const c = String.fromCharCode(ch);
    if (/[A-Za-z0-9\-_.~]/.test(c)) out += c;
    else if (c === '/' && !encodeSlash) out += c;
    else out += '%' + ch.toString(16).toUpperCase().padStart(2, '0');
  }
  return out;
}

export function signingKey(secret: string, date: string, region: string, service: string): Buffer {
  const kDate = hmac('AWS4' + secret, date);
  const kRegion = hmac(kDate, region);
  const kService = hmac(kRegion, service);
  return hmac(kService, 'aws4_request');
}

export interface SignInput {
  method: string;
  /** URI yo'li — ALLAQACHON kodlangan (masalan /bucket/a%20b.txt). */
  path: string;
  query?: Record<string, string>;
  /** Imzolanadigan sarlavhalar (host shart). Kalitlar har qanday registrda. */
  headers: Record<string, string>;
  payloadHash: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** YYYYMMDDTHHMMSSZ */
  amzDate: string;
}

export interface SignOutput { authorization: string; canonicalRequest: string; stringToSign: string; signature: string; signedHeaders: string }

export function canonicalQuery(query: Record<string, string> = {}): string {
  return Object.keys(query)
    .map((k) => [uriEncode(k), uriEncode(String(query[k] ?? ''))] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : a[1] > b[1] ? 1 : 0))
    .map(([k, v]) => `${k}=${v}`)
    .join('&');
}

export function signRequest(i: SignInput): SignOutput {
  const hdrs = Object.entries(i.headers)
    .map(([k, v]) => [k.toLowerCase().trim(), String(v).trim().replace(/\s+/g, ' ')] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalHeaders = hdrs.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = hdrs.map(([k]) => k).join(';');
  const canonicalRequest = [i.method.toUpperCase(), i.path || '/', canonicalQuery(i.query), canonicalHeaders, signedHeaders, i.payloadHash].join('\n');
  const date = i.amzDate.slice(0, 8);
  const scope = `${date}/${i.region}/${i.service}/aws4_request`;
  const stringToSign = ['AWS4-HMAC-SHA256', i.amzDate, scope, sha256Hex(canonicalRequest)].join('\n');
  const signature = crypto.createHmac('sha256', signingKey(i.secretAccessKey, date, i.region, i.service)).update(stringToSign, 'utf8').digest('hex');
  const authorization = `AWS4-HMAC-SHA256 Credential=${i.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return { authorization, canonicalRequest, stringToSign, signature, signedHeaders };
}

export const toAmzDate = (d: Date) => d.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

// ── S3 mijozi ──────────────────────────────────────────────────────────────────
export interface S3Config {
  endpoint: string; // https://<account>.r2.cloudflarestorage.com
  bucket: string;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;   // R2: "auto"
  pathStyle: boolean;
}

export interface S3Object { key: string; size: number; lastModified: string }

export class S3Error extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}

export class S3Client {
  constructor(private cfg: S3Config, private fetchImpl: typeof fetch = (...a) => fetch(...a), private now: () => Date = () => new Date()) {}

  private target(key?: string): { url: string; host: string; path: string } {
    const ep = new URL(this.cfg.endpoint.replace(/\/+$/, ''));
    const encKey = key ? '/' + uriEncode(key, false) : '';
    const basePath = ep.pathname.replace(/\/+$/, '');
    if (this.cfg.pathStyle) {
      const path = `${basePath}/${uriEncode(this.cfg.bucket)}${encKey}` || '/';
      return { url: `${ep.protocol}//${ep.host}${path}`, host: ep.host, path };
    }
    const host = `${this.cfg.bucket}.${ep.host}`;
    const path = `${basePath}${encKey}` || '/';
    return { url: `${ep.protocol}//${host}${path}`, host, path };
  }

  async request(method: string, key: string | undefined, opts: { query?: Record<string, string>; body?: Buffer; headers?: Record<string, string>; timeoutMs?: number } = {}): Promise<Response> {
    const { url, host, path } = this.target(key);
    const payloadHash = opts.body ? sha256Hex(opts.body) : EMPTY_SHA256;
    const amzDate = toAmzDate(this.now());
    const headers: Record<string, string> = { host, 'x-amz-content-sha256': payloadHash, 'x-amz-date': amzDate, ...(opts.headers || {}) };
    const { authorization } = signRequest({ method, path, query: opts.query, headers, payloadHash, accessKeyId: this.cfg.accessKeyId, secretAccessKey: this.cfg.secretAccessKey, region: this.cfg.region, service: 's3', amzDate });
    const qs = canonicalQuery(opts.query);
    const sendHeaders: Record<string, string> = { ...headers, authorization };
    delete sendHeaders.host; // fetch o'zi qo'yadi (qiymati bir xil)
    const res = await this.fetchImpl(qs ? `${url}?${qs}` : url, {
      method,
      headers: sendHeaders,
      body: opts.body ? new Uint8Array(opts.body) : undefined,
      signal: AbortSignal.timeout(opts.timeoutMs ?? 10 * 60_000),
    } as RequestInit);
    return res;
  }

  private async fail(res: Response, what: string): Promise<never> {
    const text = await res.text().catch(() => '');
    const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] || `HTTP_${res.status}`;
    const msg = /<Message>([^<]+)<\/Message>/.exec(text)?.[1] || text.slice(0, 200);
    throw new S3Error(res.status, code, `S3 ${what}: ${code}${msg ? ' — ' + msg : ''}`);
  }

  async put(key: string, body: Buffer, contentType = 'application/octet-stream'): Promise<{ etag: string | null }> {
    const res = await this.request('PUT', key, { body, headers: { 'content-type': contentType } });
    if (!res.ok) return this.fail(res, 'PUT');
    await res.arrayBuffer().catch(() => undefined);
    return { etag: res.headers.get('etag') };
  }

  async get(key: string): Promise<Buffer> {
    const res = await this.request('GET', key);
    if (!res.ok) return this.fail(res, 'GET');
    return Buffer.from(await res.arrayBuffer());
  }

  async delete(key: string): Promise<void> {
    const res = await this.request('DELETE', key);
    if (!res.ok && res.status !== 404) return this.fail(res, 'DELETE');
    await res.arrayBuffer().catch(() => undefined);
  }

  async list(prefix: string, maxPages = 50): Promise<S3Object[]> {
    const out: S3Object[] = [];
    let token: string | undefined;
    for (let page = 0; page < maxPages; page++) {
      const query: Record<string, string> = { 'list-type': '2', prefix, 'max-keys': '1000' };
      if (token) query['continuation-token'] = token;
      const res = await this.request('GET', undefined, { query });
      if (!res.ok) return this.fail(res, 'LIST');
      const xml = await res.text();
      out.push(...parseListXml(xml));
      const truncated = /<IsTruncated>true<\/IsTruncated>/.test(xml);
      token = /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(xml)?.[1];
      if (!truncated || !token) break;
      token = decodeXml(token);
    }
    return out;
  }
}

const decodeXml = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');

export function parseListXml(xml: string): S3Object[] {
  const out: S3Object[] = [];
  const re = /<Contents>([\s\S]*?)<\/Contents>/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml))) {
    const block = m[1];
    const key = /<Key>([\s\S]*?)<\/Key>/.exec(block)?.[1];
    if (!key) continue;
    out.push({
      key: decodeXml(key),
      size: Number(/<Size>(\d+)<\/Size>/.exec(block)?.[1] || 0),
      lastModified: /<LastModified>([^<]+)<\/LastModified>/.exec(block)?.[1] || '',
    });
  }
  return out;
}

/** Env'dan S3 sozlamasi (yo'q bo'lsa null). */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const bucket = (env.BACKUP_S3_BUCKET || '').trim();
  const accessKeyId = (env.BACKUP_S3_ACCESS_KEY_ID || '').trim();
  const secretAccessKey = (env.BACKUP_S3_SECRET_ACCESS_KEY || '').trim();
  if (!bucket || !accessKeyId || !secretAccessKey) return null;
  const region = (env.BACKUP_S3_REGION || '').trim() || 'auto';
  let endpoint = (env.BACKUP_S3_ENDPOINT || '').trim();
  if (!endpoint) endpoint = `https://s3.${region === 'auto' ? 'us-east-1' : region}.amazonaws.com`;
  if (!/^https?:\/\//i.test(endpoint)) endpoint = 'https://' + endpoint;
  const pathStyle = !/^(0|false|no)$/i.test((env.BACKUP_S3_PATH_STYLE || '').trim());
  return { endpoint, bucket, accessKeyId, secretAccessKey, region, pathStyle };
}

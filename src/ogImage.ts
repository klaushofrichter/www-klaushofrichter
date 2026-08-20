import fs from 'fs';
import dns from 'dns';
import net from 'net';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (compatible; www-klaushofrichter-bot/1.0; +https://www.klaushofrichter.net)';
const FETCH_TIMEOUT_MS = 8000;
const MAX_DOWNLOAD_BYTES = 5 * 1024 * 1024;
const ALLOWED_CONTENT_TYPES = new Set(['image/png', 'image/jpeg', 'image/gif', 'image/webp']);

// Returns true if `ip` is a loopback, private, or link-local address (i.e.
// not something an SSRF-guarded outbound fetch should be allowed to reach).
function isPrivateOrLoopbackIp(ip: string): boolean {
  if (net.isIPv4(ip)) {
    const octets = ip.split('.').map(Number);
    const [a, b] = octets;
    if (octets.length !== 4 || octets.some((n) => Number.isNaN(n) || n < 0 || n > 255)) {
      return true; // malformed - fail closed
    }
    if (a === 127) return true; // 127.0.0.0/8 loopback
    if (a === 10) return true; // 10.0.0.0/8 private
    if (a === 172 && b >= 16 && b <= 31) return true; // 172.16.0.0/12 private
    if (a === 192 && b === 168) return true; // 192.168.0.0/16 private
    if (a === 169 && b === 254) return true; // 169.254.0.0/16 link-local
    if (a === 0) return true; // 0.0.0.0/8 unspecified
    return false;
  }
  if (net.isIPv6(ip)) {
    const lower = ip.toLowerCase();
    if (lower === '::1' || lower === '::') return true; // loopback / unspecified
    if (lower.startsWith('fe80:')) return true; // fe80::/10 link-local
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true; // fc00::/7 unique local
    const mapped = lower.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateOrLoopbackIp(mapped[1]);
    return false;
  }
  return true; // not a recognizable IP - fail closed
}

// SSRF guard: only allow https URLs whose hostname resolves to a public IP.
async function isUrlSafeToFetch(rawUrl: string): Promise<boolean> {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  try {
    const { address } = await dns.promises.lookup(parsed.hostname);
    return !isPrivateOrLoopbackIp(address);
  } catch {
    return false;
  }
}

export async function fetchOgImage(url: string): Promise<string | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const html = await response.text();
    const $ = cheerio.load(html);
    const content = $('meta[property="og:image"]').attr('content');
    return content ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

export async function downloadImage(imageUrl: string, destPath: string): Promise<string | null> {
  if (!(await isUrlSafeToFetch(imageUrl))) return null;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) return null;

    const contentType = (response.headers.get('content-type') ?? '')
      .split(';')[0]
      .trim()
      .toLowerCase();
    if (!ALLOWED_CONTENT_TYPES.has(contentType)) return null;

    const contentLengthHeader = response.headers.get('content-length');
    if (contentLengthHeader && Number(contentLengthHeader) > MAX_DOWNLOAD_BYTES) return null;

    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_DOWNLOAD_BYTES) return null;

    await fs.promises.writeFile(destPath, buffer);
    return contentType;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

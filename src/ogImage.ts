import fs from 'fs';
import * as cheerio from 'cheerio';

const USER_AGENT =
  'Mozilla/5.0 (compatible; www-klaushofrichter-bot/1.0; +https://www.klaushofrichter.net)';
const FETCH_TIMEOUT_MS = 8000;

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
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(imageUrl, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const contentType = response.headers.get('content-type') ?? 'image/jpeg';
    const buffer = Buffer.from(await response.arrayBuffer());
    await fs.promises.writeFile(destPath, buffer);
    return contentType;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

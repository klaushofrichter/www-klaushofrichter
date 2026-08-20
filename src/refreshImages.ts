import fs from 'fs';
import path from 'path';
import cron from 'node-cron';
import { links } from './links';
import { fetchOgImage, downloadImage } from './ogImage';

export const IMAGES_DIR = path.join(process.cwd(), 'data', 'images');
const DAILY_CRON_SCHEDULE = '0 6 * * *';

const imageContentTypes = new Map<string, string>();

export function imagePath(id: string): string {
  return path.join(IMAGES_DIR, id);
}

export function hasImage(id: string): boolean {
  return imageContentTypes.has(id);
}

export function getImageContentType(id: string): string | undefined {
  return imageContentTypes.get(id);
}

async function refreshOne(id: string, url: string): Promise<void> {
  const ogImageUrl = await fetchOgImage(url);
  if (!ogImageUrl) {
    imageContentTypes.delete(id);
    return;
  }
  const contentType = await downloadImage(ogImageUrl, imagePath(id));
  if (contentType) {
    imageContentTypes.set(id, contentType);
  } else {
    imageContentTypes.delete(id);
  }
}

export async function refreshAllImages(): Promise<void> {
  fs.mkdirSync(IMAGES_DIR, { recursive: true });
  await Promise.all(links.map((link) => refreshOne(link.id, link.url)));
}

export function scheduleDailyRefresh(): void {
  cron.schedule(DAILY_CRON_SCHEDULE, () => {
    refreshAllImages().catch((err) => {
      console.error('Daily image refresh failed', err);
    });
  });
}

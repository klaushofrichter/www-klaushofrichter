import fs from 'fs';
import path from 'path';

// Baked into the image by the Dockerfile (COPY public ./public), so this
// resolves the same way from dist/ in the container as from src/ under tsx.
export const PUBLIC_DIR = path.join(__dirname, '..', 'public');

export interface PublicFile {
  name: string;
  size: number;
}

// Flat listing on purpose: the folder holds a handful of downloads that change
// rarely, so subdirectories are skipped rather than walked. Dotfiles are left
// out to match the dotfiles:'ignore' setting on the static handler that serves
// them - the listing should never advertise something the server won't send.
export function listPublicFiles(): PublicFile[] {
  let entries: fs.Dirent[];
  try {
    entries = fs.readdirSync(PUBLIC_DIR, { withFileTypes: true });
  } catch {
    return [];
  }
  return entries
    .filter((entry) => entry.isFile() && !entry.name.startsWith('.'))
    .map((entry) => ({
      name: entry.name,
      size: fs.statSync(path.join(PUBLIC_DIR, entry.name)).size,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

export function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

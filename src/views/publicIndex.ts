import { PublicFile, formatSize } from '../publicFiles';
import { escapeHtml } from './escapeHtml';

const TITLE = 'Public files';
const INTRO = 'Files published alongside the site. Pick one to download.';

const CSS = `
  * { box-sizing: border-box; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: linear-gradient(160deg, #0f0c29, #1b1740, #24243e);
    color: #eef0fb;
    min-height: 100vh;
  }
  .page { padding: 40px 5%; max-width: 720px; margin: 0 auto; }
  h1 { font-size: 26px; margin: 0 0 10px; }
  .intro { font-size: 14px; line-height: 1.6; opacity: 0.75; margin: 0 0 28px; }
  ul { list-style: none; margin: 0; padding: 0; }
  li {
    border: 1px solid rgba(255, 255, 255, 0.12);
    border-radius: 10px;
    background: rgba(255, 255, 255, 0.04);
    margin-bottom: 10px;
  }
  li a {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: 16px;
    padding: 14px 18px;
    color: #eef0fb;
    text-decoration: none;
  }
  li a:hover { background: rgba(255, 255, 255, 0.07); border-radius: 10px; }
  .name { word-break: break-word; }
  .size { font-size: 13px; opacity: 0.6; white-space: nowrap; }
  .empty { font-size: 14px; opacity: 0.6; }
  .back { display: inline-block; margin-top: 28px; font-size: 14px; color: #a7a4e8; text-decoration: none; }
  .back:hover { text-decoration: underline; }
`;

function renderItem(file: PublicFile): string {
  // encodeURIComponent, not the raw name: these are arbitrary filenames and
  // may contain spaces, '+', '#' or '?', all of which change the URL's meaning
  // if they reach the href unescaped. The download attribute makes a click
  // save the file rather than let the browser decide per content type.
  const href = `/public/${encodeURIComponent(file.name)}`;
  return `
        <li><a href="${escapeHtml(href)}" download>
          <span class="name">${escapeHtml(file.name)}</span>
          <span class="size">${escapeHtml(formatSize(file.size))}</span>
        </a></li>`;
}

export function renderPublicIndex(files: PublicFile[]): string {
  const body = files.length
    ? `<ul>${files.map(renderItem).join('\n')}
      </ul>`
    : '<p class="empty">Nothing here yet.</p>';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(TITLE)} — Klaus Hofrichter</title>
    <meta name="description" content="${escapeHtml(INTRO)}" />
    <!-- A file index is not something to surface in search results. -->
    <meta name="robots" content="noindex" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />
    <style>${CSS}</style>
  </head>
  <body>
    <div class="page">
      <h1>${escapeHtml(TITLE)}</h1>
      <p class="intro">${escapeHtml(INTRO)}</p>
      <main>${body}</main>
      <a class="back" href="/">← Back to klaushofrichter.net</a>
    </div>
  </body>
</html>`;
}

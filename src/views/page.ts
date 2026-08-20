import { links, Link } from '../links';
import { hasImage } from '../refreshImages';

const ABOUT_TITLE = 'Klaus Hofrichter';
const ABOUT_BODY =
  'Engineer, tinkerer, and occasional puppy photographer. This page collects the places you can find me online — from professional profiles to side projects and creative work.';
const FOOTER_TEXT = 'Contact: klaus@klaushofrichter.net';
const SITE_URL = 'https://www.klaushofrichter.net';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function displayUrl(url: string): string {
  return url.replace(/^https?:\/\//, '').replace(/\/$/, '');
}

function renderCard(link: Link): string {
  const imageMarkup = hasImage(link.id)
    ? `<img src="/images/${link.id}" alt="${escapeHtml(link.title)}" class="card-image-img" />`
    : '';
  return `
        <div class="card">
          <div class="card-image" style="background: ${link.gradient};">${imageMarkup}</div>
          <div class="card-body">
            <h3>${escapeHtml(link.title)}</h3>
            <p>${escapeHtml(link.abstract)}</p>
            <a class="card-link" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(displayUrl(link.url))} →</a>
          </div>
        </div>`;
}

const PAGE_CSS = `
  * { box-sizing: border-box; }
  html { scrollbar-width: thin; scrollbar-color: #4b4a78 #16142b; }
  ::-webkit-scrollbar { width: 10px; }
  ::-webkit-scrollbar-track { background: #16142b; }
  ::-webkit-scrollbar-thumb { background: #4b4a78; border-radius: 6px; }
  ::-webkit-scrollbar-thumb:hover { background: #5f5d99; }
  body {
    margin: 0;
    font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
    background: linear-gradient(160deg, #0f0c29, #1b1740, #24243e);
    color: #eef0fb;
    min-height: 100vh;
  }
  .page { padding: 40px 24px; }
  .about { max-width: 640px; margin: 0 auto 40px; text-align: center; }
  .about-avatar {
    width: 72px; height: 72px; border-radius: 50%;
    background: linear-gradient(135deg, #3b82f6, #8b5cf6);
    margin: 0 auto 16px;
  }
  .about h1 { font-size: 26px; margin: 0 0 10px; }
  .about p { font-size: 14px; line-height: 1.6; opacity: 0.75; margin: 0; }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(220px, 1fr));
    gap: 18px;
    max-width: 960px;
    margin: 0 auto;
  }
  .card {
    background: rgba(255,255,255,0.06);
    backdrop-filter: blur(6px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    overflow: hidden;
  }
  .card-image { height: 110px; display: flex; align-items: center; justify-content: center; }
  .card-image-img { width: 100%; height: 100%; object-fit: cover; }
  .card-body { padding: 14px; }
  .card-body h3 { margin: 0; font-size: 14px; }
  .card-body p { font-size: 12px; opacity: 0.7; margin: 5px 0 0; }
  .card-link { display: inline-block; margin-top: 10px; font-size: 11px; color: #93a5fd; text-decoration: none; }
  .card-link:hover { text-decoration: underline; }
  .site-footer {
    max-width: 960px; margin: 48px auto 0; padding-top: 20px;
    border-top: 1px solid rgba(255,255,255,0.1);
    text-align: center; font-size: 12px; opacity: 0.6;
  }
  #refresh-button {
    position: fixed; top: 16px; right: 16px;
    width: 36px; height: 36px; border-radius: 50%;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #eef0fb; font-size: 16px; cursor: pointer;
    opacity: 0.35; transition: opacity 0.2s;
  }
  #refresh-button:hover { opacity: 1; }
  #refresh-button.loading { animation: spin 1s linear infinite; opacity: 1; }
  @keyframes spin { to { transform: rotate(360deg); } }
  #refresh-message {
    position: fixed; top: 58px; right: 16px;
    font-size: 11px; background: rgba(0,0,0,0.6); padding: 6px 10px; border-radius: 6px;
    opacity: 0; transition: opacity 0.2s; pointer-events: none;
  }
  #refresh-message.visible { opacity: 1; }
`;

const REFRESH_SCRIPT = `
  (function () {
    var button = document.getElementById('refresh-button');
    var message = document.getElementById('refresh-message');
    function showMessage(text) {
      message.textContent = text;
      message.classList.add('visible');
      setTimeout(function () { message.classList.remove('visible'); }, 4000);
    }
    button.addEventListener('click', function () {
      if (button.classList.contains('loading')) return;
      button.classList.add('loading');
      fetch('/refresh', { method: 'POST' })
        .then(function (response) {
          if (response.ok) {
            window.location.reload();
            return;
          }
          showMessage(response.status === 429 ? 'Please wait a bit before refreshing again.' : 'Refresh failed.');
          button.classList.remove('loading');
        })
        .catch(function () {
          showMessage('Refresh failed.');
          button.classList.remove('loading');
        });
    });
  })();
`;

export function renderPage(): string {
  const cards = links.map(renderCard).join('\n');
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Klaus Hofrichter</title>
    <meta property="og:title" content="Klaus Hofrichter" />
    <meta property="og:description" content="${escapeHtml(ABOUT_BODY)}" />
    <meta property="og:image" content="${SITE_URL}/assets/og-image.png" />
    <meta property="og:url" content="${SITE_URL}/" />
    <meta property="og:type" content="website" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    <button id="refresh-button" title="Refresh images" aria-label="Refresh images">⟳</button>
    <div id="refresh-message"></div>
    <div class="page">
      <header class="about">
        <div class="about-avatar"></div>
        <h1>${escapeHtml(ABOUT_TITLE)}</h1>
        <p>${escapeHtml(ABOUT_BODY)}</p>
      </header>
      <main class="cards">${cards}
      </main>
      <footer class="site-footer">${escapeHtml(FOOTER_TEXT)}</footer>
    </div>
    <script>${REFRESH_SCRIPT}</script>
  </body>
</html>`;
}

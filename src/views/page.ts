import { appVersion } from '../version';
import { links, Link } from '../links';
import { hasImage } from '../refreshImages';
import { hasStaticCard, staticCardUrl } from '../staticCards';

const ABOUT_TITLE = 'Klaus Hofrichter';
const ABOUT_BODY =
  'Engineer, tinkerer, and occasional puppy photographer. This page collects the places you can find me online — from professional profiles to side projects and creative work.';
const FOOTER_TEXT = 'Contact: klaus@klaushofrichter.net';
const SITE_URL = 'https://www.klaushofrichter.net';
const REPO_URL = 'https://github.com/klaushofrichter/www-klaushofrichter';
const OG_IMAGE_ALT = 'Klaus Hofrichter — engineer, tinkerer, and occasional puppy photographer.';

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

function cardImageSrc(link: Link): string | null {
  if (hasStaticCard(link.id)) {
    return staticCardUrl(link.id);
  }
  if (hasImage(link.id)) {
    return `/images/${link.id}`;
  }
  return null;
}

function renderCard(link: Link): string {
  const imageSrc = cardImageSrc(link);
  const imageMarkup = imageSrc
    ? `<img src="${escapeHtml(imageSrc)}" alt="${escapeHtml(link.title)}" class="card-image-img" />`
    : '';
  return `
        <div class="card" style="background: ${link.cardColor};">
          <a class="card-image" style="background: ${link.gradient};" href="${escapeHtml(link.url)}" target="_blank" rel="noopener noreferrer">${imageMarkup}</a>
          <div class="card-body">
            <h2>${escapeHtml(link.title)}</h2>
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
  .page { padding: 40px 5%; }
  .about { max-width: 640px; margin: 0 auto 40px; text-align: center; }
  .about-avatar {
    width: 72px; height: 72px; border-radius: 50%;
    background: url('/assets/apple-touch-icon.png') center / cover;
    margin: 0 auto 16px;
  }
  .about h1 { font-size: 26px; margin: 0 0 10px; }
  .about p { font-size: 14px; line-height: 1.6; opacity: 0.75; margin: 0; }
  .cards {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(275px, 1fr));
    gap: 18px;
  }
  .card {
    background: rgba(255,255,255,0.06);
    backdrop-filter: blur(6px);
    border: 1px solid rgba(255,255,255,0.12);
    border-radius: 14px;
    overflow: hidden;
  }
  .card-image { height: 110px; display: flex; align-items: center; justify-content: center; text-decoration: none; }
  .card-image-img { width: 100%; height: 100%; object-fit: cover; }
  .card-body { padding: 14px; }
  .card-body h2 { margin: 0; font-size: 14px; }
  .card-body p { font-size: 12px; opacity: 0.7; margin: 5px 0 0; }
  .card-link { display: inline-block; margin-top: 10px; font-size: 11px; color: #93a5fd; text-decoration: none; }
  .card-link:hover { text-decoration: underline; }
  .site-footer {
    margin: 48px 0 0; padding-top: 20px;
    border-top: 1px solid rgba(255,255,255,0.1);
    text-align: center; font-size: 12px; opacity: 0.6;
  }
  .header-actions {
    position: fixed; top: 16px; right: 16px;
    display: flex; align-items: center; gap: 8px;
  }
  #app-version {
    font-size: 11px; color: #eef0fb; letter-spacing: 0.02em;
    opacity: 0.25; transition: opacity 0.2s;
  }
  .header-actions:hover #app-version { opacity: 0.6; }
  a#app-version { text-decoration: none; }
  a#app-version:hover { opacity: 1; text-decoration: underline; }
  #auth-button {
    display: inline-flex; align-items: center; justify-content: center;
    height: 36px; padding: 0 14px; border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #eef0fb; font-size: 12px; text-decoration: none;
    opacity: 0.35; transition: opacity 0.2s;
  }
  #auth-button:hover { opacity: 1; }
  #refresh-button {
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

const AUTH_ERROR_SCRIPT = `
  (function () {
    var params = new URLSearchParams(window.location.search);
    if (params.get('auth_error') === '1') {
      var message = document.getElementById('refresh-message');
      message.textContent = 'Login failed — only klaus@klaushofrichter.net can sign in.';
      message.classList.add('visible');
      setTimeout(function () { message.classList.remove('visible'); }, 6000);
      params.delete('auth_error');
      var newSearch = params.toString();
      var newUrl = window.location.pathname + (newSearch ? '?' + newSearch : '') + window.location.hash;
      window.history.replaceState({}, '', newUrl);
    }
  })();
`;

export function renderPage(isAuthenticated: boolean): string {
  const visibleLinks = links.filter((link) => !link.requiresAuth || isAuthenticated);
  const cards = visibleLinks.map(renderCard).join('\n');
  // Signed in, the version doubles as a way into the source that built it;
  // signed out it stays inert text. The id is on both so the deploy's smoke
  // test - which greps the logged-out page for it - keeps working either way.
  const version = escapeHtml(appVersion());
  const versionMarkup = isAuthenticated
    ? `<a id="app-version" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" title="Deployed build - open the repository">${version}</a>`
    : `<span id="app-version" title="Deployed build">${version}</span>`;
  const authButtonMarkup = isAuthenticated
    ? '<a id="auth-button" href="/auth/logout">Logout</a>'
    : '<a id="auth-button" href="/auth/google/login">Login</a>';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Klaus Hofrichter</title>
    <meta name="description" content="${escapeHtml(ABOUT_BODY)}" />
    <meta property="og:site_name" content="${escapeHtml(ABOUT_TITLE)}" />
    <meta property="og:title" content="Klaus Hofrichter" />
    <meta property="og:description" content="${escapeHtml(ABOUT_BODY)}" />
    <meta property="og:image" content="${SITE_URL}/assets/og-image.png" />
    <meta property="og:image:type" content="image/png" />
    <!-- Dimensions let a scraper reserve the right space before the image
         itself has loaded; they must match assets/og-image.png. -->
    <meta property="og:image:width" content="1200" />
    <meta property="og:image:height" content="630" />
    <meta property="og:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}" />
    <meta property="og:url" content="${SITE_URL}/" />
    <meta property="og:type" content="website" />
    <!-- X reads og:* for everything else, but renders a small thumbnail
         unless twitter:card explicitly asks for the large one. -->
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="Klaus Hofrichter" />
    <meta name="twitter:description" content="${escapeHtml(ABOUT_BODY)}" />
    <meta name="twitter:image" content="${SITE_URL}/assets/og-image.png" />
    <meta name="twitter:image:alt" content="${escapeHtml(OG_IMAGE_ALT)}" />
    <link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    <div class="header-actions">
      ${versionMarkup}
      ${authButtonMarkup}
      <button id="refresh-button" title="Refresh images" aria-label="Refresh images">⟳</button>
    </div>
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
    <script>${REFRESH_SCRIPT}${AUTH_ERROR_SCRIPT}</script>
  </body>
</html>`;
}

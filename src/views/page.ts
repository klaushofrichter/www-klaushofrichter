import { escapeHtml } from './escapeHtml';
import { BASE_CSS, FAVICON_LINKS, HEADER_CSS, renderHeaderActions } from './layout';
import { links, Link } from '../links';
import { hasImage } from '../refreshImages';
import { hasStaticCard, staticCardUrl } from '../staticCards';

const ABOUT_TITLE = 'Klaus Hofrichter';
const ABOUT_BODY =
  'Engineer, tinkerer, and occasional puppy photographer. This page collects the places you can find me online — from professional profiles to side projects and creative work.';
const FOOTER_TEXT = 'Contact: klaus@klaushofrichter.net';
const SITE_URL = 'https://www.klaushofrichter.net';
const OG_IMAGE_ALT = 'Klaus Hofrichter — engineer, tinkerer, and occasional puppy photographer.';

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
  ${BASE_CSS}
  ${HEADER_CSS}
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
      // Deliberately does not name the allowed addresses: this page is public,
      // and the allow list (ALLOWED_EMAILS) is no longer a single address.
      message.textContent = 'Login failed — this account is not allowed to sign in.';
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
    ${FAVICON_LINKS}
    <style>${PAGE_CSS}</style>
  </head>
  <body>
    ${renderHeaderActions({ isAuthenticated, showRefresh: true })}
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

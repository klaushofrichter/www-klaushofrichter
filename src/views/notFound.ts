import { BASE_CSS, FAVICON_LINKS } from './layout';

// The site's own 404, in place of Express's bare "Cannot GET": it looks like
// the rest of the site and offers a way home.
const CSS = `${BASE_CSS}
  .page { padding: 80px 5%; max-width: 640px; margin: 0 auto; text-align: center; }
  h1 { font-size: 26px; margin: 0 0 10px; }
  p { font-size: 14px; line-height: 1.6; opacity: 0.75; margin: 0 0 28px; }
  a { font-size: 14px; color: #a5b4fc; text-decoration: none; }
  a:hover { text-decoration: underline; }
`;

export function renderNotFound(): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>Not found — Klaus Hofrichter</title>
    <meta name="robots" content="noindex" />
    ${FAVICON_LINKS}
    <style>${CSS}</style>
  </head>
  <body>
    <main class="page">
      <h1>Page not found</h1>
      <p>There is nothing at this address.</p>
      <a href="/">← Home: klaushofrichter.net</a>
    </main>
  </body>
</html>`;
}

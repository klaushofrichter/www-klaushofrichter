import { escapeHtml } from './escapeHtml';
import { BASE_CSS, FAVICON_LINKS, HEADER_CSS, renderHeaderActions } from './layout';

export interface Crumb {
  label: string;
  href?: string;
}

export interface DashboardShellOptions {
  title: string;
  breadcrumb: Crumb[];
  body: string;
  extraCss?: string;
  script?: string;
}

const SHELL_CSS = `
  .page { padding: 40px 5%; max-width: 1100px; margin: 0 auto; }
  .breadcrumb { font-size: 13px; margin: 0 0 18px; opacity: 0.85; }
  .breadcrumb a { color: #93a5fd; text-decoration: none; }
  .breadcrumb a:hover { text-decoration: underline; }
  .breadcrumb .sep { margin: 0 6px; opacity: 0.5; }
  h1 { font-size: 24px; margin: 0 0 8px; }
  .intro { font-size: 14px; line-height: 1.6; opacity: 0.75; margin: 0 0 24px; }
`;

function renderBreadcrumb(crumbs: Crumb[]): string {
  return crumbs
    .map((crumb) =>
      crumb.href
        ? `<a href="${escapeHtml(crumb.href)}">${escapeHtml(crumb.label)}</a>`
        : `<span aria-current="page">${escapeHtml(crumb.label)}</span>`,
    )
    .join('<span class="sep" aria-hidden="true">›</span>');
}

// Only ever served behind requireAuthPage, so the header is always the
// signed-in variant.
export function renderDashboardShell(options: DashboardShellOptions): string {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>${escapeHtml(options.title)} — Klaus Hofrichter</title>
    <meta name="robots" content="noindex" />
    ${FAVICON_LINKS}
    <style>${BASE_CSS}${HEADER_CSS}${SHELL_CSS}${options.extraCss ?? ''}</style>
  </head>
  <body>
    ${renderHeaderActions({ isAuthenticated: true, showRefresh: false })}
    <div class="page">
      <nav class="breadcrumb" aria-label="Breadcrumb">${renderBreadcrumb(options.breadcrumb)}</nav>
      ${options.body}
    </div>
    ${options.script ? `<script>${options.script}</script>` : ''}
  </body>
</html>`;
}

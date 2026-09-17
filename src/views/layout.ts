import { appVersion } from '../version';
import { escapeHtml } from './escapeHtml';

export const REPO_URL = 'https://github.com/klaushofrichter/www-klaushofrichter';

// Shared by the homepage and the dashboard pages so the two look like one site.
export const BASE_CSS = `
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
`;

export const HEADER_CSS = `
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
  #auth-button, #dashboard-button {
    display: inline-flex; align-items: center; justify-content: center;
    height: 36px; padding: 0 14px; border-radius: 18px;
    border: 1px solid rgba(255,255,255,0.15);
    background: rgba(255,255,255,0.06);
    color: #eef0fb; font-size: 12px; text-decoration: none;
    opacity: 0.35; transition: opacity 0.2s;
  }
  #auth-button:hover, #dashboard-button:hover { opacity: 1; }
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
`;

export const FAVICON_LINKS = `<link rel="icon" type="image/png" sizes="32x32" href="/assets/favicon-32x32.png" />
    <link rel="icon" type="image/png" sizes="16x16" href="/assets/favicon-16x16.png" />
    <link rel="apple-touch-icon" sizes="180x180" href="/assets/apple-touch-icon.png" />`;

export interface HeaderOptions {
  isAuthenticated: boolean;
  showRefresh: boolean;
}

export function renderHeaderActions({ isAuthenticated, showRefresh }: HeaderOptions): string {
  // Signed in, the version doubles as a way into the source that built it;
  // signed out it stays inert text. The id is on both so the deploy's smoke
  // test - which greps the logged-out page for it - keeps working either way.
  const version = escapeHtml(appVersion());
  const versionMarkup = isAuthenticated
    ? `<a id="app-version" href="${REPO_URL}" target="_blank" rel="noopener noreferrer" title="Deployed build - open the repository">${version}</a>`
    : `<span id="app-version" title="Deployed build">${version}</span>`;
  // Omitted, not hidden with CSS: a signed-out response must not reveal the
  // dashboard exists. The routes behind it are guarded separately.
  const dashboardMarkup = isAuthenticated ? '<a id="dashboard-button" href="/dashboard">Dashboard</a>' : '';
  const authButtonMarkup = isAuthenticated
    ? '<a id="auth-button" href="/auth/logout">Logout</a>'
    : '<a id="auth-button" href="/auth/google/login">Login</a>';
  const refreshMarkup = showRefresh
    ? '<button id="refresh-button" title="Refresh images" aria-label="Refresh images">⟳</button>'
    : '';
  return `<div class="header-actions">
      ${versionMarkup}
      ${dashboardMarkup}
      ${authButtonMarkup}
      ${refreshMarkup}
    </div>`;
}

import { CARD_COLORS } from '../links';
import { renderDashboardShell } from './dashboardShell';

const TILES_CSS = `
  .tiles { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 18px; }
  .tile {
    display: block; padding: 18px; border-radius: 14px;
    border: 1px solid rgba(255,255,255,0.12);
    background: ${CARD_COLORS.indigo};
    color: #eef0fb; text-decoration: none;
  }
  .tile:hover { border-color: rgba(255,255,255,0.35); }
  .tile h2 { margin: 0; font-size: 16px; }
  .tile p { margin: 6px 0 0; font-size: 13px; opacity: 0.75; }
`;

export function renderDashboardPage(): string {
  return renderDashboardShell({
    title: 'Dashboard',
    breadcrumb: [{ label: '← Cards', href: '/' }],
    extraCss: TILES_CSS,
    body: `
      <h1>Dashboard</h1>
      <p class="intro">Tools for the signed-in owner of this site.</p>
      <main class="tiles">
        <a class="tile" href="/dashboard/ip-survey">
          <h2>IP Survey</h2>
          <p>Scan the home network and list every connected device.</p>
        </a>
      </main>`,
  });
}

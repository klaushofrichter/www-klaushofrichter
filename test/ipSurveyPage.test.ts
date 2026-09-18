import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { createApp } from '../src/app';
import { signSession } from '../src/session';
import { embedJson, renderIpSurveyPage } from '../src/views/ipSurvey';
import { SurveyStatus, ScanState } from '../src/survey/types';
import { ScannerClient } from '../src/survey/scannerClient';

const hostileName = '</script><script>alert(1)</script>';

const status: SurveyStatus = {
  scan: { state: 'idle' },
  view: {
    source: 'saved', scannedAt: '2026-09-17T11:00:00.000Z', savedAt: '2026-09-17T11:01:00.000Z', unsaved: false,
    hasSaved: true,
    counts: { devices: 1, new: 0, gone: 0 },
    rows: [{
      ip: '192.168.1.9', mac: 'b8:27:eb:11:22:33', vendor: null, privateMac: false, name: hostileName,
      nameSource: 'mdns', web: null, services: [], ports: [], rttMs: 4,
      status: 'unchanged', ipNum: 3232235785, statusRank: 1, note: null,
    }],
  },
};

function extractEmbedded(html: string): unknown {
  const match = html.match(/<script type="application\/json" id="survey-status">([\s\S]*?)<\/script>/);
  if (!match) throw new Error('embedded status not found');
  return JSON.parse(match[1]);
}

describe('embedJson', () => {
  it('cannot close the surrounding script element', () => {
    const embedded = embedJson({ name: hostileName });

    expect(embedded).not.toContain('<');
    expect(JSON.parse(embedded)).toEqual({ name: hostileName });
  });
});

describe('renderIpSurveyPage', () => {
  it('renders the toolbar, the sortable table and the details dialog', () => {
    const html = renderIpSurveyPage(status);

    expect(html).toContain('id="scan-button"');
    expect(html).toContain('id="save-button"');
    expect(html).toContain('id="survey-rows"');
    expect(html).toContain('<th data-sort-key="ipNum" aria-sort="ascending">');
    expect(html).toContain('<dialog id="details-dialog"');
  });

  it('embeds the status so the page renders without a second request', () => {
    expect(extractEmbedded(renderIpSurveyPage(status))).toEqual(status);
  });

  it('does not let a device name break out of the embedded JSON', () => {
    const html = renderIpSurveyPage(status);

    expect(html).not.toContain(hostileName);
  });

  it('links back to the cards and the dashboard', () => {
    const html = renderIpSurveyPage(status);

    expect(html).toContain('<a href="/">Cards</a>');
    expect(html).toContain('<a href="/dashboard">Dashboard</a>');
    expect(html).toContain('<span aria-current="page">IP Survey</span>');
  });
});

describe('GET /dashboard/ip-survey', () => {
  function scanner(state: ScanState): ScannerClient {
    return { getScan: vi.fn().mockResolvedValue(state), startScan: vi.fn().mockResolvedValue(state) };
  }

  it('redirects a signed-out visitor to the cards', async () => {
    const response = await request(createApp()).get('/dashboard/ip-survey');

    expect(response.status).toBe(302);
    expect(response.headers.location).toBe('/');
  });

  it('renders with the current status for a signed-in user', async () => {
    const app = createApp({ surveyDeps: { scanner: scanner({ state: 'idle' }), surveyDir: '/nonexistent-survey-dir' } });

    const response = await request(app)
      .get('/dashboard/ip-survey')
      .set('Cookie', `session=${signSession('allowed@example.com')}`);

    expect(response.status).toBe(200);
    expect(extractEmbedded(response.text)).toEqual({
      scan: { state: 'idle' },
      view: {
        source: 'none', scannedAt: null, savedAt: null, unsaved: false, hasSaved: false, rows: [],
        counts: { devices: 0, new: 0, gone: 0 },
      },
    });
  });
});

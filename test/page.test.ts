import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/refreshImages', () => ({
  hasImage: vi.fn().mockReturnValue(false),
}));

vi.mock('../src/staticCards', () => ({
  hasStaticCard: vi.fn().mockReturnValue(false),
  staticCardUrl: vi.fn((id: string) => `/assets/cards/${id}.png`),
}));

import { hasImage } from '../src/refreshImages';
import { hasStaticCard } from '../src/staticCards';
import { renderPage } from '../src/views/page';

const mockedHasImage = vi.mocked(hasImage);
const mockedHasStaticCard = vi.mocked(hasStaticCard);

describe('renderPage card images', () => {
  beforeEach(() => {
    mockedHasImage.mockReset();
    mockedHasImage.mockReturnValue(false);
    mockedHasStaticCard.mockReset();
    mockedHasStaticCard.mockReturnValue(false);
  });

  it('uses the static card asset when one exists, in preference to a dynamic image', () => {
    mockedHasStaticCard.mockImplementation((id: string) => id === 'linkedin');
    mockedHasImage.mockReturnValue(true);

    const html = renderPage();

    expect(html).toContain('src="/assets/cards/linkedin.png"');
  });

  it('falls back to the dynamic /images/:id route when no static card exists', () => {
    mockedHasStaticCard.mockReturnValue(false);
    mockedHasImage.mockImplementation((id: string) => id === 'linkedin');

    const html = renderPage();

    expect(html).toContain('src="/images/linkedin"');
  });

  it('wraps the card image area in a link to the card URL', () => {
    mockedHasStaticCard.mockImplementation((id: string) => id === 'linkedin');

    const html = renderPage();

    expect(html).toContain(
      '<a class="card-image" style="background: linear-gradient(135deg, #3b82f6, #8b5cf6);" href="https://www.linkedin.com/in/klaushofrichter" target="_blank" rel="noopener noreferrer">'
    );
  });
});

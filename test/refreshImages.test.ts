import { describe, it, expect, vi, beforeEach } from 'vitest';

vi.mock('../src/ogImage', () => ({
  fetchOgImage: vi.fn(),
  downloadImage: vi.fn(),
}));

vi.mock('../src/staticCards', () => ({
  hasStaticCard: vi.fn().mockReturnValue(false),
}));

import { fetchOgImage, downloadImage } from '../src/ogImage';
import { hasStaticCard } from '../src/staticCards';
import { refreshAllImages, hasImage, getImageContentType, imagePath } from '../src/refreshImages';

const mockedFetchOgImage = vi.mocked(fetchOgImage);
const mockedDownloadImage = vi.mocked(downloadImage);
const mockedHasStaticCard = vi.mocked(hasStaticCard);

describe('refreshAllImages', () => {
  beforeEach(() => {
    mockedFetchOgImage.mockReset();
    mockedDownloadImage.mockReset();
    mockedHasStaticCard.mockReset();
    mockedHasStaticCard.mockReturnValue(false);
  });

  it('downloads an image for every link that has an og:image', async () => {
    mockedFetchOgImage.mockResolvedValue('https://example.com/hero.jpg');
    mockedDownloadImage.mockResolvedValue('image/jpeg');

    await refreshAllImages();

    expect(mockedFetchOgImage).toHaveBeenCalledTimes(8);
    expect(mockedDownloadImage).toHaveBeenCalledTimes(8);
    expect(hasImage('linkedin')).toBe(true);
    expect(getImageContentType('linkedin')).toBe('image/jpeg');
  });

  it('leaves a link without an image if its fetch fails, without affecting others', async () => {
    mockedFetchOgImage.mockImplementation((url: string) =>
      url.includes('linkedin') ? Promise.resolve(null) : Promise.resolve('https://example.com/hero.jpg')
    );
    mockedDownloadImage.mockResolvedValue('image/jpeg');

    await refreshAllImages();

    expect(hasImage('linkedin')).toBe(false);
    expect(getImageContentType('linkedin')).toBeUndefined();
    expect(hasImage('github')).toBe(true);
  });

  it('imagePath returns a path inside the images directory', () => {
    expect(imagePath('linkedin')).toContain('data');
    expect(imagePath('linkedin')).toContain('images');
    expect(imagePath('linkedin')).toContain('linkedin');
  });

  it('skips fetching for links that have a static card asset', async () => {
    mockedHasStaticCard.mockImplementation((id: string) => id === 'linkedin');
    mockedFetchOgImage.mockResolvedValue('https://example.com/hero.jpg');
    mockedDownloadImage.mockResolvedValue('image/jpeg');

    await refreshAllImages();

    expect(mockedFetchOgImage).not.toHaveBeenCalledWith(expect.stringContaining('linkedin'));
    expect(mockedFetchOgImage).toHaveBeenCalledTimes(7);
  });
});

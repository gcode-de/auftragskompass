import { expect, test } from '@playwright/test';

test('built React shell loads in Chromium without runtime errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'Anmelden bei AuftragsKompass' }),
  ).toBeVisible();
  await expect(page.getByRole('heading', { level: 1 })).toHaveCount(1);
  await expect(page.getByText(/Anfragen, Kontakte und Stammdaten/)).toHaveCount(
    0,
  );
  expect(errors).toEqual([]);
});

test('theme is available before login with one persisted toggle', async ({
  page,
}) => {
  await page.addInitScript(() => {
    if (!localStorage.getItem('ak-theme'))
      localStorage.setItem('ak-theme', 'light');
  });
  await page.goto('/');
  await page.setViewportSize({ width: 320, height: 740 });
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth),
  ).toBeLessThanOrEqual(321);
  await page.setViewportSize({ width: 1280, height: 720 });
  const toggle = page.getByRole('button', { name: 'Dunkelmodus aktivieren' });
  await expect(toggle).toHaveCount(1);
  await expect(toggle).toHaveAttribute('title', 'Dunkelmodus aktivieren');
  await expect(toggle).toHaveAttribute('aria-pressed', 'false');
  await toggle.click();
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  await page.reload();
  const dark = page.getByRole('button', { name: 'Hellmodus aktivieren' });
  await expect(dark).toHaveCount(1);
  await expect(dark).toHaveAttribute('aria-pressed', 'true');
  await expect(dark).toHaveAttribute('title', 'Hellmodus aktivieren');
});

test('declares and serves the original compass favicon at 16 and 32 pixels', async ({
  page,
}) => {
  await page.goto('/');
  const svgLink = page.locator('link[rel~="icon"][type="image/svg+xml"]');
  await expect(svgLink).toHaveCount(1);
  const svgHref = await svgLink.getAttribute('href');
  expect(svgHref).toBe('/favicon.svg');

  const svgResponse = await page.request.get(svgHref!);
  expect(svgResponse.status()).toBe(200);
  expect(svgResponse.headers()['content-type']).toContain('image/svg+xml');
  const svg = await svgResponse.text();
  expect(svg).toContain('viewBox="0 0 32 32"');
  expect(svg).toContain('<title>AuftragsKompass</title>');

  const pngLink = page.locator('link[rel~="icon"][type="image/png"]');
  await expect(pngLink).toHaveAttribute('sizes', '32x32');
  const pngResponse = await page.request.get(
    (await pngLink.getAttribute('href'))!,
  );
  expect(pngResponse.status()).toBe(200);
  expect(pngResponse.headers()['content-type']).toContain('image/png');
  expect((await pngResponse.body()).subarray(0, 8).toString('hex')).toBe(
    '89504e470d0a1a0a',
  );

  const sameDesign = await page.evaluate(async () => {
    const draw = (image: HTMLImageElement, size: number) => {
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = size;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0, size, size);
      return context.getImageData(0, 0, size, size).data;
    };
    const svg = new Image();
    svg.src = '/favicon.svg';
    await svg.decode();
    const png = new Image();
    png.src = '/favicon-32.png';
    await png.decode();
    const left = draw(svg, 32);
    const right = draw(png, 32);
    let difference = 0;
    let paintedLeft = 0;
    let paintedRight = 0;
    for (let index = 0; index < left.length; index += 4) {
      if (left[index + 3]! > 128) paintedLeft += 1;
      if (right[index + 3]! > 128) paintedRight += 1;
      for (let channel = 0; channel < 4; channel += 1)
        difference = Math.max(
          difference,
          Math.abs(left[index + channel]! - right[index + channel]!),
        );
    }
    return { difference, paintedLeft, paintedRight };
  });
  expect(sameDesign.difference).toBeLessThanOrEqual(2);
  expect(sameDesign.paintedLeft).toBe(sameDesign.paintedRight);

  for (const size of [16, 32]) {
    const metrics = await page.evaluate(async (pixels) => {
      const link = document.querySelector<HTMLLinkElement>(
        'link[rel~="icon"][type="image/svg+xml"]',
      )!;
      const image = new Image();
      image.src = link.href;
      await image.decode();
      const canvas = document.createElement('canvas');
      canvas.width = canvas.height = pixels;
      const context = canvas.getContext('2d')!;
      context.drawImage(image, 0, 0, pixels, pixels);
      const data = context.getImageData(0, 0, pixels, pixels).data;
      let painted = 0;
      let lightest = 0;
      let darkest = 1;
      for (let index = 0; index < data.length; index += 4) {
        if (data[index + 3]! < 128) continue;
        painted += 1;
        const luminance =
          (0.2126 * data[index]! +
            0.7152 * data[index + 1]! +
            0.0722 * data[index + 2]!) /
          255;
        lightest = Math.max(lightest, luminance);
        darkest = Math.min(darkest, luminance);
      }
      const centre = context.getImageData(pixels / 2, pixels / 2, 1, 1).data;
      return {
        painted,
        contrast: (lightest + 0.05) / (darkest + 0.05),
        centreAlpha: centre[3]!,
      };
    }, size);
    expect(metrics.painted).toBeGreaterThan(size * size * 0.4);
    expect(metrics.contrast).toBeGreaterThanOrEqual(4.5);
    expect(metrics.centreAlpha).toBeGreaterThan(200);
  }
});

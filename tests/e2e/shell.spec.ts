import { expect, test } from '@playwright/test';
test('built React shell loads in Chromium without runtime errors', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('/');
  await expect(
    page.getByRole('heading', { name: 'AuftragsKompass' }),
  ).toBeVisible();
  await expect(
    page.getByText(/Anfragen, Kontakte und Stammdaten/),
  ).toContainText('verwalten');
  expect(errors).toEqual([]);
});

import { expect, test } from '@playwright/test';

// BKP005: one small synthetic reference surface (list, form, legend, dialog)
// rendered with the shipped classes in both themes at 390 and 1280. It carries
// no business data and proves the neutral palette in a real browser.
const referenceSurface = `
<div class="workspace-page" data-synthetic="theme-reference">
  <section aria-label="Synthetische Referenzfläche">
    <div class="section-heading">
      <h2>Synthetische Referenzfläche</h2>
      <div class="section-actions">
        <button type="button" class="primary-action">Eintrag speichern</button>
        <button type="button" class="secondary-action">Eingabe verwerfen</button>
        <button type="button" class="tertiary-action">Liste aktualisieren</button>
      </div>
    </div>
    <p class="files-subtitle">Fiktive Angaben für die Theme-Abnahme, keine echten Daten.</p>
    <ul class="event-list">
      <li>
        <div class="event-row">
          <div class="event-summary-block">
            <span class="event-title">Fiktives Event am Monatsanfang</span>
            <span class="event-meta">Gebucht · Hochzeit · Fiktive Kundin</span>
            <span class="event-resource-hint">Ressourcen: FB1 #1</span>
          </div>
          <div class="event-actions">
            <button type="button" class="icon-action tier-quiet-icon" aria-label="Event bearbeiten">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 20h4l10-10-4-4L4 16v4Z"/><path d="M13.5 6.5 17.5 10.5"/></svg>
            </button>
          </div>
        </div>
      </li>
      <li>
        <div class="event-row">
          <div class="event-summary-block">
            <span class="event-title">Fiktives Event ohne Datum</span>
            <span class="event-meta">Anfrage · Firmenfeier · Kontakt offen</span>
            <span class="event-source-quiet">Website</span>
          </div>
        </div>
      </li>
    </ul>
    <fieldset>
      <legend>Fiktive Buchungsangaben</legend>
      <label>Eventname<input value="Fiktives Event am Monatsanfang" readonly></label>
      <label>Buchungsstatus<select><option>Gebucht</option><option>Option</option></select></label>
      <label><input type="checkbox" checked> Fiktive Zusatzleistung</label>
      <p role="alert">Fiktiver Konflikt: Die Einheit ist bereits gebucht.</p>
      <button type="button" class="secondary-action" disabled>Gesperrte Aktion</button>
    </fieldset>
    <div role="group" aria-label="Kalenderlegende">
      <ul>
        <li><span class="event-source-quiet">Gebucht</span> Bestätigte Buchung, Einheit reserviert</li>
        <li><span class="event-source-quiet">Option</span> Vorgemerkt, noch nicht bestätigt</li>
        <li><span class="event-source-quiet">Sperre</span> Zeitweise nicht verfügbar</li>
        <li><span class="event-source-quiet">Konflikt</span> Überschneidung mit einer Buchung</li>
      </ul>
    </div>
  </section>
</div>`;

const referenceDialog = `
<div class="form-dialog-backdrop" data-synthetic="theme-dialog">
  <div class="form-dialog" role="dialog" aria-modal="true" aria-labelledby="synthetic-dialog-title">
    <div class="form-dialog-header">
      <h3 id="synthetic-dialog-title">Fiktiven Eintrag bearbeiten</h3>
      <button type="button" class="form-dialog-close tertiary-action" aria-label="Dialog schließen">×</button>
    </div>
    <form>
      <fieldset>
        <legend>Angaben</legend>
        <label>Bezeichnung<input value="Fiktiver Eintrag"></label>
      </fieldset>
      <div class="form-dialog-footer">
        <button type="button" class="primary-action">Speichern</button>
        <button type="button" class="secondary-action">Abbrechen</button>
      </div>
    </form>
  </div>
</div>`;

const referenceSidebar = `
<aside class="desktop-sidebar" data-synthetic="theme-sidebar">
  <nav aria-label="Fiktive Arbeitsbereiche">
    <a href="#events" aria-current="page">Events</a>
    <a href="#contacts">Kontakte</a>
  </nav>
</aside>`;

/** How far a colour leans green: the green channel above the red/blue mean. */
function greenness(value: string) {
  const [r, g, b] = value
    .match(/[\d.]+/g)!
    .slice(0, 3)
    .map(Number);
  return g! - (r! + b!) / 2;
}

type ComputedStyle = {
  background: string;
  color: string;
  border: string;
  text: string;
};
type ReferenceMeasurement = {
  canvas: string;
  panel: ComputedStyle;
  primary: ComputedStyle;
  disabled: ComputedStyle;
  alert: ComputedStyle;
  input: ComputedStyle;
  ring: { width: string; style: string; offset: string; color: string };
  legend: string[];
  overflow: number;
};
type RailMeasurement = {
  background: string;
  activeBackground: string;
  activeColor: string;
  linkColor: string;
};

function contrast(a: string, b: string) {
  const luminance = (value: string) => {
    const [r, g, b] = value
      .match(/[\d.]+/g)!
      .slice(0, 3)
      .map(Number)
      .map((channel) => {
        const v = channel / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      });
    return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
  };
  const first = luminance(a);
  const second = luminance(b);
  return (Math.max(first, second) + 0.05) / (Math.min(first, second) + 0.05);
}

test('contact rows keep names and actions readable on narrow screens', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.body.innerHTML = `<main class="workspace-page"><section><ul class="contact-list"><li><div class="contact-row"><a class="contact-name-link" href="#contact">Ein fiktiver Kontakt mit einem sehr langen Namen</a><span>Fiktive Ansprechpartnerin</span><a href="mailto:example@example.invalid">E-Mail</a><a href="tel:123">Anrufen</a><button class="icon-action tier-quiet-icon" aria-label="Kontakt bearbeiten">✎</button></div></li></ul></section></main>`;
  });
  for (const theme of ['light', 'dark']) {
    await page
      .locator('html')
      .evaluate((el, value) => el.setAttribute('data-theme', value), theme);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 800 });
      const values = await page.evaluate(() => {
        const list = document.querySelector('.contact-list')!;
        const row = document.querySelector('.contact-row')!;
        const name = document.querySelector('.contact-name-link')!;
        const mail = row.querySelector('a[href^="mailto:"]')!;
        return {
          marker: getComputedStyle(list).listStyleType,
          nameWeight: getComputedStyle(name).fontWeight,
          nameColor: getComputedStyle(name).color,
          rowBackground: getComputedStyle(row).backgroundColor,
          nameHeight: name.getBoundingClientRect().height,
          mailHeight: mail.getBoundingClientRect().height,
          overflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });
      expect(values.marker).toBe('none');
      expect(Number(values.nameWeight)).toBeGreaterThanOrEqual(600);
      expect(
        contrast(values.nameColor, values.rowBackground),
      ).toBeGreaterThanOrEqual(4.5);
      expect(values.nameHeight).toBeGreaterThanOrEqual(44);
      expect(values.mailHeight).toBeGreaterThanOrEqual(44);
      expect(values.overflow).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: `tests/test-results/contact-hierarchy-${theme}-${width}.png`,
      });
    }
  }
  await page.locator('.contact-name-link').focus();
  await expect(page.locator('.contact-name-link')).toHaveCSS(
    'outline-style',
    'solid',
  );
  await page
    .locator('.contact-row')
    .evaluate((row) => row.setAttribute('hidden', ''));
  await expect(page.locator('.contact-row')).toBeHidden();
});

test('event months and cards keep their hierarchy across themes and widths', async ({
  page,
}) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.body.innerHTML = `<main class="workspace-page"><section><section class="event-month"><h2>Oktober 2030 <span class="event-month-count">· 2 Events</span></h2><ul class="event-list"><li class="event-card" data-status="booked"><div class="event-row"><a class="event-summary" href="#event"><span class="event-date"><span class="event-date-day">24</span></span><span class="event-body"><span class="event-status">Gebucht</span><span class="event-title">Eine fiktive Veranstaltung mit einem besonders langen Namen</span></span></a></div></li><li class="event-card" data-status="option"><div class="event-row"><span class="event-title">Weitere fiktive Veranstaltung</span></div></li></ul></section><section class="event-month"><h3>November 2030 <span class="event-month-count">· 1 Event</span></h3></section></section></main>`;
  });
  for (const theme of ['light', 'dark']) {
    await page
      .locator('html')
      .evaluate((el, value) => el.setAttribute('data-theme', value), theme);
    for (const width of [320, 390, 768, 1280]) {
      await page.setViewportSize({ width, height: 900 });
      const values = await page.evaluate(() => {
        const h2 = document.querySelector('.event-month h2')!;
        const h3 = document.querySelector('.event-month h3')!;
        const count = h2.querySelector('span')!;
        const card = document.querySelector('.event-card')!;
        const panel = document.querySelector('.workspace-page > section')!;
        return {
          month2: getComputedStyle(h2).backgroundColor,
          month3: getComputedStyle(h3).backgroundColor,
          card: getComputedStyle(card).backgroundColor,
          cardText: getComputedStyle(card).color,
          monthText: getComputedStyle(h2).color,
          countText: getComputedStyle(count).color,
          panel: getComputedStyle(panel).backgroundColor,
          titleWeight: getComputedStyle(h2).fontWeight,
          countWeight: getComputedStyle(count).fontWeight,
          overflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });
      expect(values.month2).toBe(values.month3);
      expect(values.card).not.toBe(values.panel);
      expect(contrast(values.cardText, values.card)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(values.monthText, values.month2)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(contrast(values.countText, values.month2)).toBeGreaterThanOrEqual(
        4.5,
      );
      expect(Number(values.countWeight)).toBeLessThan(
        Number(values.titleWeight),
      );
      expect(values.overflow).toBeLessThanOrEqual(0);
      await page.screenshot({
        path: `tests/test-results/event-hierarchy-${theme}-${width}.png`,
      });
    }
  }
  await page.locator('.event-summary').focus();
  await expect(page.locator('.event-summary')).toBeFocused();
  await expect(page.locator('.event-summary')).toHaveCSS(
    'outline-style',
    'solid',
  );
});

test('both themes keep a neutral reference surface readable at 390 and 1280', async ({
  page,
}) => {
  test.setTimeout(120000);
  await page.addInitScript(() => {
    localStorage.setItem('ak-theme', 'light');
  });
  await page.goto('/');
  const results: {
    label: string;
    width: number;
    rail: RailMeasurement;
    measured: ReferenceMeasurement;
    dialog: {
      box: { x: number; y: number; width: number; height: number };
      background: string;
    };
  }[] = [];

  for (const theme of ['light', 'dark'] as const) {
    const toggle = page.getByRole('button', { name: /modus aktivieren/ });
    if ((await page.locator('html').getAttribute('data-theme')) !== theme)
      await toggle.click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    for (const width of [390, 1280] as const) {
      await page.setViewportSize({ width, height: width === 390 ? 844 : 900 });

      // The rail is measured on its own: it is a fixed overlay and would cover
      // the reference surface.
      await page.evaluate((markup) => {
        document.body.insertAdjacentHTML('beforeend', markup);
      }, referenceSidebar);
      const rail = await page.evaluate(() => {
        const sidebar = document.querySelector<HTMLElement>(
          '[data-synthetic="theme-sidebar"]',
        )!;
        const active = sidebar.querySelector<HTMLElement>('a[aria-current]')!;
        const link = sidebar.querySelectorAll<HTMLElement>('a')[1]!;
        return {
          background: getComputedStyle(sidebar).backgroundColor,
          activeBackground: getComputedStyle(active).backgroundColor,
          activeColor: getComputedStyle(active).color,
          linkColor: getComputedStyle(link).color,
        };
      });
      await page.evaluate(() => {
        document.querySelector('[data-synthetic="theme-sidebar"]')!.remove();
      });

      await page.evaluate((markup) => {
        document.body.insertAdjacentHTML('beforeend', markup);
      }, referenceSurface);
      const reference = page.locator('[data-synthetic="theme-reference"]');
      await expect(
        reference.getByRole('heading', {
          name: 'Synthetische Referenzfläche',
        }),
      ).toBeVisible();
      await expect(
        reference.getByText('Fiktives Event am Monatsanfang').first(),
      ).toBeVisible();
      await expect(reference.getByLabel('Buchungsstatus')).toBeVisible();
      const legend = reference.getByRole('group', { name: 'Kalenderlegende' });
      await expect(legend.getByRole('listitem')).toHaveCount(4);
      for (const label of ['Gebucht', 'Option', 'Sperre', 'Konflikt'])
        await expect(legend.getByText(label, { exact: true })).toBeVisible();

      // A real key press first: Chromium only matches :focus-visible for a
      // programmatic focus once the last interaction was the keyboard.
      await page.keyboard.press('Tab');
      await reference.locator('.primary-action').focus();
      const measured = await page.evaluate(() => {
        const style = (selector: string) => {
          const element = document.querySelector<HTMLElement>(selector)!;
          const computed = getComputedStyle(element);
          return {
            background: computed.backgroundColor,
            color: computed.color,
            border: computed.borderTopStyle,
            text: element.textContent ?? '',
          };
        };
        const focused = document.activeElement as HTMLElement;
        const ring = getComputedStyle(focused);
        return {
          canvas: getComputedStyle(document.documentElement).backgroundColor,
          panel: style('[data-synthetic="theme-reference"] section'),
          primary: style('[data-synthetic="theme-reference"] .primary-action'),
          disabled: style(
            '[data-synthetic="theme-reference"] .secondary-action:disabled',
          ),
          alert: style('[data-synthetic="theme-reference"] [role="alert"]'),
          input: style('[data-synthetic="theme-reference"] input:not([type])'),
          ring: {
            width: ring.outlineWidth,
            style: ring.outlineStyle,
            offset: ring.outlineOffset,
            color: ring.outlineColor,
          },
          legend: Array.from(
            document.querySelectorAll(
              '[data-synthetic="theme-reference"] [role="group"] li',
            ),
          ).map((item) => item.textContent?.trim() ?? ''),
          overflow:
            document.documentElement.scrollWidth -
            document.documentElement.clientWidth,
        };
      });

      await page.evaluate(() => window.scrollTo(0, 0));
      await page.screenshot({
        path: `tests/test-results/theme-reference-${width}-${theme}.png`,
        fullPage: true,
        animations: 'disabled',
      });

      await page.evaluate((markup) => {
        document.body.insertAdjacentHTML('beforeend', markup);
      }, referenceDialog);
      const dialog = page.getByRole('dialog', {
        name: 'Fiktiven Eintrag bearbeiten',
      });
      await expect(dialog).toBeVisible();
      const dialogBox = (await dialog.boundingBox())!;
      const dialogBackground = await dialog.evaluate(
        (element) => getComputedStyle(element).backgroundColor,
      );
      await dialog.screenshot({
        path: `tests/test-results/theme-reference-dialog-${width}-${theme}.png`,
        animations: 'disabled',
      });
      await page.evaluate(() => {
        document.querySelector('[data-synthetic="theme-dialog"]')!.remove();
        document.querySelector('[data-synthetic="theme-reference"]')!.remove();
      });

      results.push({
        label: `${theme} ${width}`,
        rail,
        measured,
        dialog: { box: dialogBox, background: dialogBackground },
        width,
      });
    }
  }

  // Assert after both themes and both widths have been captured, so one run
  // always leaves the full before/after screenshot set behind.
  for (const { label, rail, measured, dialog, width } of results) {
    expect(
      greenness(rail.background),
      `${label}: the navigation rail is anthracite`,
    ).toBeLessThanOrEqual(4);
    expect(
      greenness(rail.activeBackground),
      `${label}: the active row stays a whisper`,
    ).toBeLessThanOrEqual(12);
    expect(
      contrast(rail.activeColor, rail.activeBackground),
      `${label}: the active navigation label is readable`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(rail.linkColor, rail.background),
      `${label}: quiet navigation links are readable`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(measured.overflow, `${label}: no body overflow`).toBeLessThanOrEqual(
      0,
    );
    expect(
      greenness(measured.canvas),
      `${label}: canvas neutral`,
    ).toBeLessThanOrEqual(4);
    expect(
      greenness(measured.panel.background),
      `${label}: panel neutral`,
    ).toBeLessThanOrEqual(4);
    expect(
      greenness(measured.input.background),
      `${label}: field neutral`,
    ).toBeLessThanOrEqual(4);
    expect(
      greenness(measured.primary.background),
      `${label}: the primary action keeps the brand accent`,
    ).toBeGreaterThanOrEqual(8);
    expect(measured.ring.style, `${label}: focus ring is drawn`).toBe('solid');
    expect(measured.ring.width, `${label}: focus ring width`).toBe('3px');
    expect(measured.ring.offset, `${label}: focus ring offset`).toBe('3px');
    expect(
      contrast(measured.ring.color, measured.panel.background),
      `${label}: focus ring contrast`,
    ).toBeGreaterThanOrEqual(3);
    expect(
      measured.disabled.border,
      `${label}: disabled stays labelled with a dashed border`,
    ).toBe('dashed');
    expect(
      contrast(measured.disabled.color, measured.panel.background),
      `${label}: disabled label contrast`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      contrast(measured.alert.color, measured.alert.background),
      `${label}: alert text contrast`,
    ).toBeGreaterThanOrEqual(4.5);
    expect(
      measured.legend.every((line) => line.length > 8),
      `${label}: every status names itself in words`,
    ).toBe(true);
    expect(
      dialog.box.x,
      `${label}: dialog starts inside the viewport`,
    ).toBeGreaterThanOrEqual(0);
    expect(
      dialog.box.x + dialog.box.width,
      `${label}: dialog fits the viewport`,
    ).toBeLessThanOrEqual(width + 1);
    expect(
      greenness(dialog.background),
      `${label}: dialog surface neutral`,
    ).toBeLessThanOrEqual(4);
  }
});

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

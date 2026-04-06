/**
 * WhatsApp screenshot spec.
 *
 * Captures the real Settings > WhatsApp Lines UI in several states:
 *   1. empty — no lines configured
 *   2. add-line — the "Add Line" form is open
 *   3. one-connected — one primary line connected
 *   4. all-connected — 1 primary + 4 relay lines, relay pool status visible
 */

import { seedWhatsAppLines, clearWhatsAppLines, DUMMY_WHATSAPP_LINES } from '../lib/seed.mjs';

export async function run(ctx) {
  const { page, dbClient, goto, wait } = ctx;

  // --- 1. Empty state ---
  console.log('\n→ Capturing empty state');
  await clearWhatsAppLines(dbClient);
  await goto('/settings');
  await shotSection(ctx, 'whatsapp-empty', 'WhatsApp Lines');

  // --- 2. Add Line form open ---
  console.log('\n→ Capturing add-line form');
  await clickButtonWithText(page, 'Add Line');
  // Wait for the label input to mount so the form is fully rendered
  await page.waitForFunction(
    () => {
      const inputs = Array.from(document.querySelectorAll('input[placeholder]'));
      return inputs.some((i) => (i.placeholder || '').toLowerCase().includes('main line'));
    },
    { timeout: 5000 },
  ).catch(() => {});
  // Type a label so the screenshot has realistic content
  await page.evaluate(() => {
    const input = Array.from(document.querySelectorAll('input')).find((i) =>
      (i.placeholder || '').toLowerCase().includes('main line'),
    );
    if (input) {
      const setter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      ).set;
      setter.call(input, 'Main Line');
      input.dispatchEvent(new Event('input', { bubbles: true }));
    }
  });
  await wait(300);
  await shotSection(ctx, 'whatsapp-add-line', 'WhatsApp Lines');

  // --- 3. One primary line connected ---
  console.log('\n→ Capturing one line connected');
  await clearWhatsAppLines(dbClient);
  await seedWhatsAppLines(dbClient, [DUMMY_WHATSAPP_LINES.primary]);
  await goto('/settings');
  await shotSection(ctx, 'whatsapp-one-connected', 'WhatsApp Lines');

  // --- 4. All 5 lines connected (1 primary + 4 relay) ---
  console.log('\n→ Capturing all lines connected + relay pool');
  await clearWhatsAppLines(dbClient);
  await seedWhatsAppLines(dbClient, [
    DUMMY_WHATSAPP_LINES.primary,
    ...DUMMY_WHATSAPP_LINES.relays,
  ]);
  await goto('/settings');
  await shotSection(ctx, 'whatsapp-all-connected', 'WhatsApp Lines');

  console.log('\n✓ WhatsApp capture complete');
}

/**
 * Find a button by its visible text and click it.
 */
async function clickButtonWithText(page, text) {
  const handle = await page.evaluateHandle((t) => {
    const buttons = Array.from(document.querySelectorAll('button'));
    return buttons.find((b) => (b.textContent || '').trim() === t) || null;
  }, text);
  const el = handle.asElement();
  if (!el) {
    // Dump all visible button text for diagnostics
    const all = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('button')).map((b) => b.textContent?.trim() || '');
    });
    throw new Error(
      `Button not found: "${text}". Visible buttons: ${JSON.stringify(all)}`,
    );
  }
  await el.click();
}

/**
 * Find a shadcn Card by its heading text and return an ElementHandle
 * pointing to the Card element. Walks up from the heading to the
 * nearest ancestor with `bg-card` (shadcn's Card marker class).
 */
async function findCardHandle(page, headerText) {
  const handle = await page.evaluateHandle((text) => {
    const headings = Array.from(document.querySelectorAll('h1, h2, h3, h4, h5'));
    const heading = headings.find((h) => {
      const own = (h.textContent || '').trim();
      return own === text || own.startsWith(text);
    });
    if (!heading) return null;
    let el = heading.parentElement;
    while (el && el !== document.body) {
      const cls = typeof el.className === 'string' ? el.className : '';
      if (cls.includes('bg-card')) return el;
      el = el.parentElement;
    }
    return null;
  }, headerText);

  const element = handle.asElement();
  if (!element) {
    await handle.dispose();
    return null;
  }
  return element;
}

async function shotSection(ctx, name, headerText) {
  const { page, outputDir, shot } = ctx;

  const card = await findCardHandle(page, headerText);
  if (!card) {
    // Diagnostic: dump available headings
    const available = await page.evaluate(() => {
      return Array.from(document.querySelectorAll('h1, h2, h3, h4, h5'))
        .map((h) => (h.textContent || '').trim())
        .filter(Boolean)
        .slice(0, 20);
    });
    console.warn(`  ⚠ Card "${headerText}" not found. Headings: ${JSON.stringify(available)}`);
    return shot(name);
  }

  // Let Puppeteer handle scroll-to-view and document/viewport coords automatically
  const nodePath = await import('path');
  const outPath = nodePath.resolve(outputDir, `${name}.png`);
  await card.screenshot({ path: outPath });
  console.log(`  📸 ${name}.png`);
  return outPath;
}

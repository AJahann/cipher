const { chromium } = require('/usr/local/lib/node_modules/@playwright/test');
(async () => {
  if (process.version !== 'v24.11.1')
    throw new Error('Unexpected Node version');
  const installed =
    require('/usr/local/lib/node_modules/@playwright/test/package.json').version;
  if (installed !== process.env.PLAYWRIGHT_IMAGE_VERSION)
    throw new Error('Image package mismatch');
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    await page.setContent('<title>Cipher image smoke</title>');
    if ((await page.title()) !== 'Cipher image smoke')
      throw new Error('Browser failed');
  } finally {
    await browser.close();
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

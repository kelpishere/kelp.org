const fs = require("node:fs");
const path = require("node:path");
const { PNG } = require("pngjs");
const { chromium } = require("playwright");

const root = __dirname;
const targetUrl = `file://${path.join(root, "index.html")}`;
const artifactDir = path.join(root, "artifacts");

const viewports = [
  { name: "desktop", width: 1440, height: 900, isMobile: false, hasTouch: false },
  { name: "mobile", width: 390, height: 844, isMobile: true, hasTouch: true },
];

async function analyzeImage(filePath) {
  const png = PNG.sync.read(fs.readFileSync(filePath));
  let samples = 0;
  let sum = 0;
  let sumSq = 0;
  const colorSet = new Set();

  for (let y = 0; y < png.height; y += 18) {
    for (let x = 0; x < png.width; x += 18) {
      const idx = (png.width * y + x) << 2;
      const r = png.data[idx];
      const g = png.data[idx + 1];
      const b = png.data[idx + 2];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      sum += luma;
      sumSq += luma * luma;
      samples += 1;
      colorSet.add(`${r >> 4}-${g >> 4}-${b >> 4}`);
    }
  }

  const mean = sum / samples;
  const variance = sumSq / samples - mean * mean;
  return {
    meanLuma: Number(mean.toFixed(2)),
    stdDev: Number(Math.sqrt(Math.max(variance, 0)).toFixed(2)),
    quantizedColors: colorSet.size,
  };
}

async function verifyViewport(browser, config) {
  const context = await browser.newContext({
    viewport: { width: config.width, height: config.height },
    isMobile: config.isMobile,
    hasTouch: config.hasTouch,
  });
  const page = await context.newPage();
  const consoleMessages = [];
  const pageErrors = [];

  page.on("console", (message) => {
    consoleMessages.push({ type: message.type(), text: message.text() });
  });

  page.on("pageerror", (error) => {
    pageErrors.push(error.message);
  });

  await page.goto(targetUrl, { waitUntil: "load" });
  await page.waitForTimeout(1800);

  const startButton = page.getByRole("button", { name: "Enter the Island" });
  if (await startButton.isVisible()) {
    await startButton.click();
    await page.waitForTimeout(1600);
  }

  const screenshotPath = path.join(artifactDir, `${config.name}.png`);
  await page.screenshot({ path: screenshotPath, fullPage: false });

  const canvasCount = await page.locator("canvas").count();
  const analysis = await analyzeImage(screenshotPath);
  await context.close();

  return {
    viewport: config.name,
    screenshotPath,
    canvasCount,
    analysis,
    consoleMessages,
    pageErrors,
  };
}

async function main() {
  fs.mkdirSync(artifactDir, { recursive: true });
  const browser = await chromium.launch({
    headless: true,
    executablePath: "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  });
  try {
    const results = [];
    for (const viewport of viewports) {
      results.push(await verifyViewport(browser, viewport));
    }
    console.log(JSON.stringify(results, null, 2));
  } finally {
    await browser.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

/**
 * Scrape Twitter/X GraphQL endpoint IDs from the web client.
 * 
 * These endpoint IDs (query hashes) are required to call Twitter's internal
 * GraphQL API. Twitter rotates them periodically, so this scraper extracts
 * the current values from the JavaScript bundles.
 * 
 * Usage:
 *   bun run scrape.ts
 * 
 * Output:
 *   twitter-graphql-endpoints.json
 */

import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

puppeteer.use(StealthPlugin());

const __dirname = dirname(fileURLToPath(import.meta.url));
const OUTPUT_FILE = join(__dirname, "twitter-graphql-endpoints.json");

type Endpoint = { name: string; hash: string; features: string[] };

// Regexes for endpoint extraction
const WITH_FEATURES = /queryId:\s*"([^"]+)"[^}]*?operationName:\s*"([^"]+)"[^}]*?featureSwitches:\s*\[([^\]]*)\]/g;
const WITHOUT_FEATURES = /queryId:\s*"([^"]+)"[^}]{0,500}?operationName:\s*"(\w+)"/g;

function extractEndpoints(code: string): Endpoint[] {
  const endpoints: Endpoint[] = [];
  
  // With features
  for (const m of code.matchAll(WITH_FEATURES)) {
    const features = m[3].match(/"([^"]+)"/g)?.map(f => f.replace(/"/g, "")) || [];
    endpoints.push({ hash: m[1], name: m[2], features });
  }
  
  // Without features (fallback)
  for (const m of code.matchAll(WITHOUT_FEATURES)) {
    endpoints.push({ hash: m[1], name: m[2], features: [] });
  }
  
  return endpoints;
}

console.log("=== Twitter/X GraphQL Endpoint Scraper ===\n");

console.log("Launching browser...");
const browser = await puppeteer.launch({ headless: true });
const page = await browser.newPage();

console.log("Navigating to x.com...");
await page.goto("https://x.com/explore", { waitUntil: "domcontentloaded", timeout: 30000 });
await page.waitForFunction("window.webpackChunk_twitter_responsive_web?.length > 0", { timeout: 15000 }).catch(() => {});
console.log("");

// Get JS bundle URLs from service worker
console.log("Fetching bundle list from service worker...");
const bundleUrls: string[] = await page.evaluate(async () => {
  const resp = await fetch("https://x.com/sw.js");
  const text = await resp.text();
  const match = text.match(/self\.ASSETS=\[([\s\S]*?)\]/);
  if (!match) return [];
  return (match[1].match(/"([^"]+)"/g) || [])
    .map(s => s.replace(/"/g, ""))
    .filter(s => s.endsWith(".js"));
});
console.log(`Found ${bundleUrls.length} JS bundles\n`);

// Extract from loaded webpack chunks
console.log("Extracting from webpack chunks...");
const chunkCode: string = await page.evaluate(() => {
  const chunks = (window as any).webpackChunk_twitter_responsive_web || [];
  return chunks
    .filter((c: any) => c[1])
    .flatMap((c: any) => Object.values(c[1]))
    .map((fn: any) => fn.toString())
    .join("\n");
});
const fromChunks = extractEndpoints(chunkCode);
console.log(`  From chunks: ${fromChunks.length} endpoints`);

// Scan additional bundles
console.log("\nScanning bundles...");
const keyBundles = bundleUrls.filter(u => 
  u.includes("main") || u.includes("vendor") || u.includes("bundle.") || u.includes("ondemand.")
);

const fromBundles: Endpoint[] = [];
let scanned = 0;

for (const url of keyBundles) {
  try {
    const code = await page.evaluate(async (u: string) => {
      const resp = await fetch(u);
      return resp.text();
    }, url);
    fromBundles.push(...extractEndpoints(code));
    scanned++;
    if (scanned % 50 === 0) console.log(`  Scanned ${scanned}/${keyBundles.length}...`);
  } catch {}
}
console.log(`  From bundles: ${fromBundles.length} (${scanned} scanned)`);

// Deduplicate (prefer entries with features)
console.log("\nProcessing...");
const all = new Map<string, Endpoint>();
for (const ep of [...fromChunks, ...fromBundles]) {
  if (!ep.name || !ep.hash || ep.name.length <= 3 || ep.hash.length <= 10) continue;
  const existing = all.get(ep.name);
  if (!existing || ep.features.length > existing.features.length) {
    all.set(ep.name, ep);
  }
}

const endpoints = [...all.values()].sort((a, b) => a.name.localeCompare(b.name));
const withFeatures = endpoints.filter(e => e.features.length > 0).length;
console.log(`  ${endpoints.length} unique (${withFeatures} with features)`);

// Write output
writeFileSync(OUTPUT_FILE, JSON.stringify({
  generated: new Date().toISOString(),
  count: endpoints.length,
  endpoints
}, null, 2));

await browser.close();

console.log("\n=== Done ===");
console.log(`${endpoints.length} endpoints (${withFeatures} with features)`);
console.log(`Saved to: ${OUTPUT_FILE}`);

# twitter-graphql-scraper

Extracts GraphQL endpoint IDs (query hashes) from Twitter/X's web client.

Twitter's internal GraphQL API requires these IDs to make requests. They rotate periodically, so this tool scrapes the current values from the JavaScript bundles.

## Usage

```bash
bun install   # downloads Chromium (~500MB) to ~/.cache/puppeteer/
bun run scrape
```

Outputs `twitter-graphql-endpoints.json`:

```json
{
  "generated": "2026-01-13T12:00:00.000Z",
  "count": 239,
  "endpoints": [
    {
      "name": "UserByScreenName",
      "hash": "-oaLodhGbbnzJBACb1kk2Q",
      "features": ["hidden_profile_subscriptions_enabled", ...]
    },
    ...
  ]
}
```

## How It Works

1. Launches headless Chrome with [puppeteer-extra-plugin-stealth](https://github.com/berstend/puppeteer-extra/tree/master/packages/puppeteer-extra-plugin-stealth) to bypass bot detection
2. Navigates to x.com and extracts endpoints from loaded webpack chunks
3. Fetches the service worker (`sw.js`) to get a list of all JS bundle URLs
4. Scans bundles for `queryId`/`operationName` pairs using regex
5. Deduplicates and writes JSON

## Authentication

To call these endpoints, you need:

```bash
# 1. Bearer token (public, hardcoded in Twitter's JS)
Authorization: Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA

# 2. auth_token cookie (from browser devtools → Application → Cookies → x.com)
# 3. ct0 = any 32-char lowercase hex string (must match between cookie and header)

Cookie: auth_token=YOUR_AUTH_TOKEN; ct0=deadbeef12345678deadbeef12345678
x-csrf-token: deadbeef12345678deadbeef12345678
```

## Extra Headers for Some Endpoints

Some endpoints require two additional headers or they return 404:

| Header | Description |
|--------|-------------|
| `x-client-transaction-id` | ~70-100 char base64 string, single-use per request |
| `x-xp-forwarded-for` | 512 hex chars, session-based with expiry |

**Known endpoints that require these headers:**
- `Followers`
- `SearchTimeline`
- `/i/api/1.1/saved_searches/list.json`
- `/i/api/1.1/account/settings.json`
- (likely others)

These values are validated server-side (random values won't work). Both have been reverse-engineered:
- **Transaction ID**: [XClientTransaction](https://github.com/iSarabjitDhiman/XClientTransaction) (Python) / [XClientTransactionJS](https://github.com/swyxio/XClientTransactionJS) (JS)
- **XP-Forwarded-For**: [twitter-x-xp-forwarded-for-header](https://github.com/dsekz/twitter-x-xp-forwarded-for-header) — AES-GCM encrypted JSON using SHA-256(static_key + guest_id), valid for 5 minutes

## Notes

- Scraping endpoints requires no authentication—they come from public JS files
- Some endpoints (Birdwatch, Spaces) only appear in bundles when logged in

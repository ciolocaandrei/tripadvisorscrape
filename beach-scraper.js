/**
 * TripAdvisor Beach Scraper - Using Bright Data Scraping Browser
 * Extracts top beaches from TripAdvisor Travelers Choice
 * This handles CAPTCHAs automatically!
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

// Bright Data Scraping Browser credentials
const AUTH = 'brd-customer-hl_94d90749-zone-scraping_browser:7923gx0w4vyy';

const CONFIG = {
  BEACH_LIST_URL: 'https://www.tripadvisor.co.uk/TravelersChoice-Beaches',
  MAX_BEACHES: 25,  // Target: top 25 beaches
  RESULTS_DIR: './results/beaches',
  // Seed list of beaches to verify/match
  SEED_BEACHES: [
    'Elafonissi Beach',
    'Banana Beach',
    'Eagle Beach',
    'Siesta Beach',
    'Praia da Falésia',
    'Playa Varadero',
    'Bavaro Beach',
    'Platja De Muro',
    'Kelingking Beach',
    'Myrtos Beach',
    'Playa de Maspalomas',
    'Poipu Beach Park',
    'Manly Beach',
    'Playa Delfines',
    'Plage de Palombaggia',
    'Anse Lazio',
    'Playa Norte',
    'Tropea Beach',
    "Ka'anapali Beach",
    'Reynisfjara Beach',
    'Bondi Beach',
    'Muro Alto Beach'
  ]
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

function saveResults(data, filename) {
  if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
    fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
  }
  const filepath = path.join(CONFIG.RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`✓ Saved: ${filepath}`);
}

async function extractBeachesFromCurrentPage(page) {
  return await page.evaluate(() => {
    const beachList = [];
    const seenUrls = new Set();
    const seenNames = new Set();

    // TripAdvisor Travelers Choice beaches page has attraction links
    // Look for links to attraction pages (beaches are attractions)
    const allLinks = document.querySelectorAll('a[href*="/Attraction_Review-"]');

    for (const link of allLinks) {
      const url = link.href.split('?')[0].split('#')[0];
      if (seenUrls.has(url)) continue;

      // Try to find the beach name
      let name = '';

      // Look for title elements within the link or nearby
      const titleEl = link.querySelector('[class*="title"], [class*="name"], h2, h3, span');
      if (titleEl) {
        name = titleEl.textContent?.trim();
      }

      if (!name) {
        // Try the link text itself
        const text = link.textContent?.trim() || '';
        // Filter out junk text
        if (text.length > 3 &&
            text.length < 100 &&
            !text.match(/^\d+$/) &&
            !text.includes('reviews)') &&
            !text.match(/^(See|View|Read|More)/i)) {
          name = text;
        }
      }

      // Also check parent container for better name
      if (!name || name.length < 3) {
        const parent = link.closest('[class*="card"], [class*="item"], [class*="poi"]');
        if (parent) {
          const nameEl = parent.querySelector('[class*="title"], [class*="name"], h2, h3');
          if (nameEl) {
            name = nameEl.textContent?.trim();
          }
        }
      }

      // Extract location from URL or nearby text
      let location = '';
      const locationEl = link.closest('[class*="card"], [class*="item"]')?.querySelector('[class*="location"], [class*="subtitle"]');
      if (locationEl) {
        location = locationEl.textContent?.trim();
      }

      if (name && name.length > 3) {
        name = name.replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
        if (seenNames.has(name.toLowerCase())) continue;

        beachList.push({ name, url, location });
        seenUrls.add(url);
        seenNames.add(name.toLowerCase());
      }
    }

    return beachList;
  });
}

async function scrollAndExtractBeaches(page) {
  let allBeaches = [];
  const seenUrls = new Set();

  // Scroll to load more content (lazy loading)
  let previousHeight = 0;
  let scrollAttempts = 0;
  const maxScrolls = 10;

  while (scrollAttempts < maxScrolls) {
    // Extract current beaches
    const currentBeaches = await extractBeachesFromCurrentPage(page);

    // Add new beaches
    for (const beach of currentBeaches) {
      if (!seenUrls.has(beach.url)) {
        allBeaches.push({
          rank: allBeaches.length + 1,
          ...beach
        });
        seenUrls.add(beach.url);
      }
    }

    console.log(`   Found ${allBeaches.length} beaches so far...`);

    // Check if we have enough
    if (allBeaches.length >= CONFIG.MAX_BEACHES) {
      break;
    }

    // Scroll down
    const currentHeight = await page.evaluate(() => document.body.scrollHeight);
    if (currentHeight === previousHeight) {
      // Try clicking "Show More" button if exists
      const showMoreClicked = await page.evaluate(() => {
        const buttons = document.querySelectorAll('button, [role="button"]');
        for (const btn of buttons) {
          const text = btn.textContent?.toLowerCase() || '';
          if (text.includes('show more') || text.includes('load more') || text.includes('see more')) {
            btn.click();
            return true;
          }
        }
        return false;
      });

      if (!showMoreClicked) {
        scrollAttempts++;
      }
    }

    previousHeight = currentHeight;
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500);
  }

  return allBeaches.slice(0, CONFIG.MAX_BEACHES);
}

async function extractBeachListFromURL(url) {
  const browserWSEndpoint = `wss://${AUTH}@brd.superproxy.io:9222`;
  let browser;

  try {
    console.log(`\n📄 Connecting to browser...`);

    browser = await puppeteer.connect({
      browserWSEndpoint,
      timeout: 15000
    });

    const page = await browser.newPage();
    const client = await page.createCDPSession();

    console.log(`   ✓ Connected! Loading ${url}`);

    await page.goto(url, {
      timeout: 60000,
      waitUntil: 'domcontentloaded'
    });

    console.log('   ⏳ Checking for CAPTCHA...');
    try {
      const { status } = await client.send('Captcha.waitForSolve', {
        detectTimeout: 3000,
      });
      console.log(`   ✓ CAPTCHA status: ${status}`);
    } catch (e) {
      console.log('   ✓ No CAPTCHA detected');
    }

    // Wait for page to load
    await delay(2000);

    // Scroll and extract beaches
    console.log('   📜 Scrolling to load all beaches...');
    const beaches = await scrollAndExtractBeaches(page);

    await browser.close();
    console.log(`   ✓ Browser closed`);

    return beaches;

  } catch (error) {
    console.error(`   ❌ Error: ${error.message}`);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore close errors
      }
    }
    return [];
  }
}

async function extractBeachList() {
  console.log('\n🏖️  Extracting TripAdvisor Travelers Choice beaches...');
  console.log('🔄 Using Bright Data Scraping Browser\n');

  const beaches = await extractBeachListFromURL(CONFIG.BEACH_LIST_URL);

  if (beaches.length > 0) {
    console.log(`\n✅ Extracted ${beaches.length} beaches\n`);

    // Re-rank beaches
    beaches.forEach((beach, index) => {
      beach.rank = index + 1;
    });
  }

  return beaches;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  TripAdvisor Beach Scraper - Travelers Choice          ║');
  console.log('║  (Bright Data Scraping Browser - Automatic CAPTCHA)    ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('📋 Config:');
  console.log(`   Target Beaches: ${CONFIG.MAX_BEACHES}`);
  console.log(`   Source: ${CONFIG.BEACH_LIST_URL}`);

  try {
    const beaches = await extractBeachList();

    if (beaches.length === 0) {
      console.error('❌ No beaches found from page scraping');
      console.log('\n📋 Using seed list instead...');

      // If scraping fails, we can use the seed list to manually construct
      console.log('⚠️  Please manually add beach URLs to beaches-list.json');
      return;
    }

    saveResults(beaches, 'beaches-list.json');

    console.log('\n' + '═'.repeat(60));
    console.log('✅ BEACH LIST EXTRACTION COMPLETED!');
    console.log('═'.repeat(60));
    console.log(`📊 Beaches found: ${beaches.length}`);
    console.log(`📁 Saved to: ./${CONFIG.RESULTS_DIR}/beaches-list.json`);

    console.log('\n🏖️  Top beaches found:');
    beaches.slice(0, 10).forEach((beach, i) => {
      console.log(`   ${i + 1}. ${beach.name}${beach.location ? ` (${beach.location})` : ''}`);
    });

    console.log(`\n➡️  Next: Run beach-reviews-extractor.js to get reviews\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

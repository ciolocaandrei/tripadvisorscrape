/**
 * TripAdvisor Scraper - Using Bright Data Scraping Browser
 * This handles CAPTCHAs automatically!
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

// Bright Data Scraping Browser credentials
const AUTH = 'brd-customer-hl_94d90749-zone-scraping_browser:7923gx0w4vyy';

const CONFIG = {
  HOTEL_LIST_URLS: [
    'https://www.tripadvisor.co.uk/Hotels-g45963-a_travelersChoice.1-Las_Vegas_Nevada-Hotels.html', // First 30 hotels
    'https://www.tripadvisor.co.uk/Hotels-g45963-oa30-a_travelersChoice.1-Las_Vegas_Nevada-Hotels.html' // Next 20 hotels
  ],
  HOTELS_PER_PAGE: 30,  // First page has 30 hotels
  MAX_HOTELS: 50,  // Total target: 50 hotels
  RESULTS_DIR: './results',
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => delay(Math.floor(Math.random() * (max - min + 1) + min));

function saveResults(data, filename) {
  if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
    fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
  }
  const filepath = path.join(CONFIG.RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`✓ Saved: ${filepath}`);
}

async function extractHotelsFromCurrentPage(page) {
  return await page.evaluate(() => {
    const hotelList = [];
    const seenUrls = new Set();
    const seenNames = new Set();

    // Try to find proper hotel card containers first
    let hotelCards = document.querySelectorAll('[data-automation="hotel-card"]');

    if (hotelCards.length === 0) {
      // Fallback: look for links with hotel review URLs
      const allLinks = document.querySelectorAll('a[href*="/Hotel_Review-"]');

      for (const link of allLinks) {
        const url = link.href.split('?')[0].split('#')[0];
        if (seenUrls.has(url)) continue;

        let name = '';
        const titleEl = link.querySelector('[class*="Title"], [class*="title"], div[class*="name"]');
        if (titleEl) {
          name = titleEl.textContent?.trim();
        }

        if (!name) {
          const text = link.textContent?.trim() || '';
          if (text.length > 3 &&
              text.length < 100 &&
              !text.includes('reviews)') &&
              !text.includes('review)') &&
              !text.includes('All inclusive') &&
              !text.includes('Best seller') &&
              !text.includes('Top rated') &&
              !text.includes('Breakfast included') &&
              !text.match(/^\(\d+,?\d*\s*reviews?\)$/i) &&
              !text.match(/^\d+\.\s*$/) &&
              !text.match(/^(from|to|per night)/i)) {
            name = text;
          }
        }

        if (name && name.length > 3) {
          name = name.replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();
          if (seenNames.has(name.toLowerCase())) continue;

          hotelList.push({ name, url });
          seenUrls.add(url);
          seenNames.add(name.toLowerCase());
        }
      }
    } else {
      hotelCards.forEach((card) => {
        const link = card.querySelector('a[href*="/Hotel_Review-"]');
        const titleEl = card.querySelector('[data-automation="hotel-card-title"]');

        if (link && titleEl) {
          const name = titleEl.textContent?.trim();
          const url = link.href.split('?')[0].split('#')[0];

          if (name && !seenUrls.has(url) && !seenNames.has(name.toLowerCase())) {
            hotelList.push({ name, url });
            seenUrls.add(url);
            seenNames.add(name.toLowerCase());
          }
        }
      });
    }

    return hotelList;
  });
}

async function extractHotelsFromURL(url, pageNum) {
  const browserWSEndpoint = `wss://${AUTH}@brd.superproxy.io:9222`;
  let browser;

  try {
    console.log(`\n📄 Page ${pageNum}: Connecting to fresh browser...`);

    browser = await puppeteer.connect({
      browserWSEndpoint,
      timeout: 60000
    });

    const page = await browser.newPage();
    const client = await page.createCDPSession();

    console.log(`   ✓ Connected! Loading ${url}`);

    await page.goto(url, {
      timeout: 120000,
      waitUntil: 'domcontentloaded'
    });

    console.log('   ⏳ Checking for CAPTCHA...');
    try {
      const { status } = await client.send('Captcha.waitForSolve', {
        detectTimeout: 10000,
      });
      console.log(`   ✓ CAPTCHA status: ${status}`);
    } catch (e) {
      console.log('   ✓ No CAPTCHA detected');
    }

    await delay(3000);

    const pageHotels = await extractHotelsFromCurrentPage(page);

    await browser.close();
    console.log(`   ✓ Browser closed`);

    return pageHotels;

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

async function extractHotelList() {
  console.log('\n🌐 Extracting TripAdvisor hotel list...');
  console.log('🔄 Using fresh browser for each page\n');

  let allHotels = [];
  const seenUrls = new Set();

  // Page 1: Get exactly 30 hotels
  console.log('📄 Page 1: Extracting first 30 hotels...');
  const page1Hotels = await extractHotelsFromURL(CONFIG.HOTEL_LIST_URLS[0], 1);

  let addedFromPage1 = 0;
  for (let i = 0; i < page1Hotels.length && addedFromPage1 < 30; i++) {
    const hotel = page1Hotels[i];
    if (!seenUrls.has(hotel.url)) {
      allHotels.push({
        rank: allHotels.length + 1,
        name: hotel.name,
        url: hotel.url
      });
      seenUrls.add(hotel.url);
      addedFromPage1++;
    }
  }

  console.log(`   ✓ Found ${page1Hotels.length} hotels, added ${addedFromPage1} (limit: 30)`);
  console.log(`   📊 Total so far: ${allHotels.length}/${CONFIG.MAX_HOTELS}`);

  // Page 2: Get remaining hotels (20 more to reach 50)
  if (allHotels.length < CONFIG.MAX_HOTELS) {
    await delay(2000);

    const remaining = CONFIG.MAX_HOTELS - allHotels.length;
    console.log(`\n📄 Page 2: Extracting remaining ${remaining} hotels...`);
    const page2Hotels = await extractHotelsFromURL(CONFIG.HOTEL_LIST_URLS[1], 2);

    let addedFromPage2 = 0;
    for (let i = 0; i < page2Hotels.length && allHotels.length < CONFIG.MAX_HOTELS; i++) {
      const hotel = page2Hotels[i];
      if (!seenUrls.has(hotel.url)) {
        allHotels.push({
          rank: allHotels.length + 1,
          name: hotel.name,
          url: hotel.url
        });
        seenUrls.add(hotel.url);
        addedFromPage2++;
      }
    }

    console.log(`   ✓ Found ${page2Hotels.length} hotels, added ${addedFromPage2}`);
    console.log(`   📊 Total: ${allHotels.length}/${CONFIG.MAX_HOTELS}`);
  }

  console.log(`\n✅ Extracted ${allHotels.length} hotels total\n`);
  return allHotels;
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  TripAdvisor Scraper - Bright Data Scraping Browser   ║');
  console.log('║  (Fresh browser per page - Automatic CAPTCHA)         ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('📋 Config:');
  console.log(`   Target Hotels: ${CONFIG.MAX_HOTELS}`);
  console.log(`   Pages to scrape: ${CONFIG.HOTEL_LIST_URLS.length}`);

  try {
    const hotels = await extractHotelList();

    if (hotels.length === 0) {
      console.error('❌ No hotels found');
      return;
    }

    saveResults(hotels, 'hotels-list.json');

    console.log('\n' + '═'.repeat(60));
    console.log('✅ HOTEL LIST EXTRACTION COMPLETED!');
    console.log('═'.repeat(60));
    console.log(`📊 Hotels found: ${hotels.length}`);
    console.log(`📁 Saved to: ./${CONFIG.RESULTS_DIR}/hotels-list.json`);
    console.log(`\n➡️  Next: Run extract-reviews.js to get reviews\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

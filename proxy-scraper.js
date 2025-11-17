/**
 * TripAdvisor Scraper with Proxy Support
 *
 * SETUP:
 * 1. Get proxy credentials from Bright Data, Oxylabs, or SmartProxy
 * 2. Update PROXY_CONFIG below with your credentials
 * 3. Run: node proxy-scraper.js
 */

import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';
import { userInfo } from 'os';

// ============================================
// CONFIGURE YOUR PROXY HERE
// ============================================
const PROXY_CONFIG = {
  // Bright Data configured
  enabled: true,
  server: 'brd.superproxy.io:33335',
  // username:'brd-customer-hl_94d90749-zone-residential_proxy1',
  // password:'qyi2jaarq4h5'
  // username: 'brd-customer-hl_94d90749-zone-news_article_reader',
  // password: 'c07mxzl6v81y'
  username: '',
  password: ''
};

const CONFIG = {
  START_URL: 'https://www.tripadvisor.co.uk/Hotels-g45963-a_travelersChoice.1-Las_Vegas_Nevada-Hotels.html',
  MAX_HOTELS: 3,  // Start with 3 hotels to test proxy
  CELEBRITY_KEYWORDS: ['celeb spotting', 'celeb sighting', 'celebrities'],
  DELAY_BETWEEN_HOTELS: 5000,
  DELAY_BETWEEN_PAGES: 3000,
  RESULTS_DIR: './results',
  HEADLESS: false,  // Keep false to watch it work
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

function countCelebrityMentions(text) {
  if (!text) return { total: 0, breakdown: {} };
  const lowerText = text.toLowerCase();
  const breakdown = {};
  let total = 0;

  CONFIG.CELEBRITY_KEYWORDS.forEach(keyword => {
    const regex = new RegExp(keyword.toLowerCase(), 'gi');
    const matches = lowerText.match(regex);
    const count = matches ? matches.length : 0;
    if (count > 0) {
      breakdown[keyword] = count;
      total += count;
    }
  });

  return { total, breakdown };
}

async function extractHotelList(page) {
  console.log('\n🌐 Loading TripAdvisor...');

  await page.goto(CONFIG.START_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });

  await delay(5000);

  // Check for blocks
  const bodyText = await page.textContent('body');

  if (bodyText.includes('unusual activity') || bodyText.includes('blocked') || bodyText.includes('Access blocked')) {
    console.log('\n❌ STILL BLOCKED!');
    console.log('Your proxy is not working or not configured.\n');

    await page.screenshot({ path: './results/blocked.png' });

    console.log('📸 Screenshot saved to ./results/blocked.png\n');
    console.log('💡 Make sure to:');
    console.log('   1. Configure PROXY_CONFIG in this file');
    console.log('   2. Set enabled: true');
    console.log('   3. Use residential proxies (not datacenter)\n');

    throw new Error('Site blocked - proxy needed');
  }

  console.log('✅ Page loaded successfully (proxy working!)');

  await randomDelay(3000, 5000);

  const hotels = await page.evaluate((maxHotels) => {
    const hotelLinks = document.querySelectorAll('a[href*="/Hotel_Review-"]');
    const hotelList = [];
    const seen = new Set();

    for (const link of hotelLinks) {
      if (hotelList.length >= maxHotels) break;

      const url = link.href;
      if (seen.has(url)) continue;

      let name = link.textContent?.trim();
      if (!name || name.length < 3) {
        const titleEl = link.querySelector('[class*="title"], div, span');
        if (titleEl) name = titleEl.textContent?.trim();
      }

      if (name && name.length > 2) {
        hotelList.push({
          rank: hotelList.length + 1,
          name: name,
          url: url
        });
        seen.add(url);
      }
    }

    return hotelList;
  }, CONFIG.MAX_HOTELS);

  console.log(`✅ Found ${hotels.length} hotels\n`);
  return hotels;
}

async function extractHotelReviews(page, hotelUrl, hotelName) {
  console.log(`\n📖 ${hotelName}`);

  try {
    await page.goto(hotelUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    await randomDelay(3000, 5000);

    let allReviews = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages && currentPage <= 20) {
      console.log(`  Page ${currentPage}...`);

      try {
        await page.waitForSelector('[class*="review"], div', { timeout: 8000 });
        await randomDelay(1500, 2500);

        const pageReviews = await page.evaluate(() => {
          let reviewCards = document.querySelectorAll('[data-automation="reviewCard"]');

          if (reviewCards.length === 0) {
            reviewCards = document.querySelectorAll('[data-test="review"], div[data-reviewid]');
          }

          if (reviewCards.length === 0) {
            reviewCards = Array.from(document.querySelectorAll('div')).filter(div => {
              const text = div.textContent || '';
              return text.length > 100 && text.length < 5000;
            }).slice(0, 20);
          }

          const reviews = [];

          reviewCards.forEach(card => {
            let title = '';
            const titleEl = card.querySelector('[data-automation="reviewTitle"], [class*="title"]');
            if (titleEl) title = titleEl.textContent?.trim() || '';

            let text = '';
            const textEl = card.querySelector('[data-automation="reviewText"], [class*="review-text"]');
            if (textEl) text = textEl.textContent?.trim() || '';

            if (!text && card.textContent?.trim().length > 100) {
              text = card.textContent.trim();
            }

            let rating = 0;
            const ratingEl = card.querySelector('[class*="bubble"], [class*="rating"]');
            if (ratingEl) {
              const match = ratingEl.className.match(/bubble[_-]?(\d+)|rating[_-]?(\d+)/i);
              if (match) rating = parseInt(match[1] || match[2]) / 10;
            }

            let date = '';
            const dateEl = card.querySelector('[data-automation="review-date"], [class*="date"], time');
            if (dateEl) date = dateEl.textContent?.trim() || '';

            let reviewer = '';
            const nameEl = card.querySelector('[class*="reviewer-name"], [class*="username"]');
            if (nameEl) reviewer = nameEl.textContent?.trim() || '';

            if (text && text.length > 20) {
              reviews.push({ title, text, rating, date, reviewer });
            }
          });

          return reviews;
        });

        console.log(`    ✓ ${pageReviews.length} reviews`);
        allReviews = allReviews.concat(pageReviews);

        const nextButton = await page.$('[data-automation="pagination-next"], a.next, a[aria-label*="Next"]');

        if (nextButton) {
          const isDisabled = await nextButton.evaluate(btn =>
            btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true'
          );

          if (!isDisabled) {
            await nextButton.click();
            await randomDelay(CONFIG.DELAY_BETWEEN_PAGES, CONFIG.DELAY_BETWEEN_PAGES + 2000);
            currentPage++;
          } else {
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }

      } catch (error) {
        console.log(`    ⚠️ ${error.message}`);
        hasMorePages = false;
      }
    }

    console.log(`  ✅ Total: ${allReviews.length} reviews`);
    return allReviews;

  } catch (error) {
    console.error(`  ❌ ${error.message}`);
    return [];
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════╗');
  console.log('║  TripAdvisor Scraper - WITH PROXY SUPPORT         ║');
  console.log('╚════════════════════════════════════════════════════╝\n');

  if (!PROXY_CONFIG.enabled) {
    await delay(5000);
  }
  let browser;

  try {
    const launchOptions = {
      headless: CONFIG.HEADLESS,
      args: ['--disable-blink-features=AutomationControlled']
    };

    // Add proxy if configured
    if (PROXY_CONFIG.enabled && PROXY_CONFIG.server) {
      launchOptions.proxy = {
        server: `http://${PROXY_CONFIG.server}`,
        username: PROXY_CONFIG.username,
        password: PROXY_CONFIG.password
      };

      // Additional proxy settings for Bright Data
      launchOptions.args = [
        ...launchOptions.args,
        `--proxy-server=http://${PROXY_CONFIG.server}`
      ];
    }

    browser = await chromium.launch(launchOptions);

    const context = await browser.newContext({
      viewport: { width: 1920, height: 1080 },
      userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
      locale: 'en-US',
      timezoneId: 'America/New_York',
    });

    const page = await context.newPage();

    // Test proxy connection
    if (PROXY_CONFIG.enabled) {
      console.log('\n🔍 Testing proxy connection...');
      try {
        await page.goto('https://api.ipify.org?format=json', { timeout: 30000 });
        const ipInfo = await page.textContent('body');
        const ipData = JSON.parse(ipInfo);
        console.log(`✅ Proxy working! Your IP appears as: ${ipData.ip}`);
        console.log(`   (Original IP was: 159.65.90.254)\n`);
      } catch (e) {
        console.log(`⚠️  Could not verify proxy: ${e.message}\n`);
      }
    }

    const hotels = await extractHotelList(page);

    if (hotels.length === 0) {
      console.error('❌ No hotels found');
      await page.screenshot({ path: './results/no-hotels.png' });
      await browser.close();
      return;
    }

    saveResults(hotels, 'hotels-list.json');

    const results = [];

    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];
      console.log(`\n[${i + 1}/${hotels.length}] ${hotel.name}`);

      const reviews = await extractHotelReviews(page, hotel.url, hotel.name);

      let totalMentions = 0;
      const mentionBreakdown = {};
      const reviewsWithMentions = [];

      reviews.forEach(review => {
        const fullText = `${review.title} ${review.text}`;
        const mentions = countCelebrityMentions(fullText);

        if (mentions.total > 0) {
          totalMentions += mentions.total;
          reviewsWithMentions.push({ ...review, celebrityMentions: mentions });
          Object.keys(mentions.breakdown).forEach(keyword => {
            mentionBreakdown[keyword] = (mentionBreakdown[keyword] || 0) + mentions.breakdown[keyword];
          });
        }
      });

      const hotelResult = {
        rank: hotel.rank,
        name: hotel.name,
        url: hotel.url,
        totalReviews: reviews.length,
        reviewsWithCelebrityMentions: reviewsWithMentions.length,
        totalCelebrityMentions: totalMentions,
        mentionBreakdown: mentionBreakdown,
        reviewsWithMentions: reviewsWithMentions,
        allReviews: reviews
      };

      results.push(hotelResult);

      console.log(`  ⭐ Mentions: ${totalMentions} in ${reviewsWithMentions.length} reviews`);
      if (Object.keys(mentionBreakdown).length > 0) {
        console.log(`  📊 ${JSON.stringify(mentionBreakdown)}`);
      }

      saveResults(results, 'scraping-progress.json');

      if (i < hotels.length - 1) {
        console.log(`  ⏳ Waiting ${CONFIG.DELAY_BETWEEN_HOTELS / 1000}s...`);
        await randomDelay(CONFIG.DELAY_BETWEEN_HOTELS, CONFIG.DELAY_BETWEEN_HOTELS + 2000);
      }
    }

    const summary = {
      totalHotelsScraped: results.length,
      totalReviewsScraped: results.reduce((sum, h) => sum + h.totalReviews, 0),
      totalCelebrityMentions: results.reduce((sum, h) => sum + h.totalCelebrityMentions, 0),
      hotelsWithMentions: results.filter(h => h.totalCelebrityMentions > 0).length,
      topHotelsByMentions: results
        .sort((a, b) => b.totalCelebrityMentions - a.totalCelebrityMentions)
        .slice(0, 10)
        .map(h => ({ rank: h.rank, name: h.name, mentions: h.totalCelebrityMentions, breakdown: h.mentionBreakdown }))
    };

    saveResults(results, 'final-results.json');
    saveResults(summary, 'summary-report.json');

    console.log('\n' + '═'.repeat(60));
    console.log('✅ SCRAPING COMPLETED!');
    console.log('═'.repeat(60));
    console.log(`📊 Hotels: ${summary.totalHotelsScraped}`);
    console.log(`📝 Reviews: ${summary.totalReviewsScraped}`);
    console.log(`⭐ Celebrity Mentions: ${summary.totalCelebrityMentions}`);
    console.log(`🏨 Hotels with Mentions: ${summary.hotelsWithMentions}`);
    console.log('\n🏆 Top 5:');
    summary.topHotelsByMentions.slice(0, 5).forEach((h, i) => {
      console.log(`   ${i + 1}. ${h.name} - ${h.mentions} mentions`);
    });
    console.log(`\n📁 Results: ./${CONFIG.RESULTS_DIR}/\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.message.includes('blocked') || error.message.includes('unusual activity')) {
      console.log('\n💡 You need a working proxy to bypass TripAdvisor blocking.');
      console.log('   See REALISTIC-OPTIONS.md for proxy service recommendations.\n');
    }
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

main().catch(console.error);

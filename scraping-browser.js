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
  START_URL: 'https://www.tripadvisor.co.uk/Hotels-g45963-a_travelersChoice.1-Las_Vegas_Nevada-Hotels.html',
  MAX_HOTELS: 2,  // Target all 50 hotels
  BATCH_SIZE: parseInt(process.env.BATCH_SIZE || '50'),   // Process all hotels by default
  BATCH_START: parseInt(process.env.BATCH_START || '0'),  // Which batch to start from (0, 5, 10, etc.)
  MAX_REVIEW_PAGES: 20,  // Max pages of reviews per hotel
  CELEBRITY_KEYWORDS: ['celeb spotting', 'celeb sighting', 'celebrities'],
  DELAY_BETWEEN_HOTELS: 3000,
  DELAY_BETWEEN_PAGES: 3000,
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

async function extractHotelList(page, client) {
  console.log('\n🌐 Loading TripAdvisor hotel list...');

  await page.goto(CONFIG.START_URL, {
    timeout: 120000,
    waitUntil: 'domcontentloaded'
  });

  console.log('⏳ Waiting for CAPTCHA detection/solving...');
  try {
    const { status } = await client.send('Captcha.waitForSolve', {
      detectTimeout: 10000,
    });
    console.log(`✓ CAPTCHA status: ${status}`);
  } catch (e) {
    console.log('✓ No CAPTCHA detected or already solved');
  }

  await delay(3000);

  const hotels = await page.evaluate((maxHotels) => {
    const hotelList = [];
    const seenUrls = new Set();
    const seenNames = new Set();

    // Try to find proper hotel card containers first
    let hotelCards = document.querySelectorAll('[data-automation="hotel-card"]');

    if (hotelCards.length === 0) {
      // Fallback: look for links with hotel review URLs
      const allLinks = document.querySelectorAll('a[href*="/Hotel_Review-"]');

      for (const link of allLinks) {
        if (hotelList.length >= maxHotels) break;

        const url = link.href.split('?')[0].split('#')[0]; // Remove query params AND anchors

        // Skip if already seen or if it's a reviews anchor link
        if (seenUrls.has(url)) continue;

        // Try to find the hotel name - look for specific elements
        let name = '';

        // Look for title within the link or parent
        const titleEl = link.querySelector('[class*="Title"], [class*="title"], div[class*="name"]');
        if (titleEl) {
          name = titleEl.textContent?.trim();
        }

        // If no title found, use link text but filter out junk
        if (!name) {
          const text = link.textContent?.trim() || '';
          // Only accept if it's reasonable length and doesn't look like metadata
          if (text.length > 3 &&
              text.length < 100 &&
              !text.includes('reviews)') &&
              !text.includes('review)') &&
              !text.includes('All inclusive') &&
              !text.includes('Best seller') &&
              !text.includes('Top rated') &&
              !text.includes('Breakfast included') &&
              !text.includes('This accommodation') &&
              !text.includes('This is one of') &&
              !text.match(/^\(\d+,?\d*\s*reviews?\)$/i) &&
              !text.match(/^\d+\.\s*$/) &&  // Just numbers like "2."
              !text.match(/^(from|to|per night)/i)) {
            name = text;
          }
        }

        if (name && name.length > 3) {
          // Clean up the name - remove leading numbers like "2. Hotel Name"
          name = name.replace(/^\d+\.\s*/, '').replace(/\s+/g, ' ').trim();

          // Skip if we've already seen this name (deduplicate)
          if (seenNames.has(name.toLowerCase())) continue;

          hotelList.push({
            rank: hotelList.length + 1,
            name: name,
            url: url
          });
          seenUrls.add(url);
          seenNames.add(name.toLowerCase());
        }
      }
    } else {
      // Use hotel cards
      hotelCards.forEach((card, index) => {
        if (index >= maxHotels) return;

        const link = card.querySelector('a[href*="/Hotel_Review-"]');
        const titleEl = card.querySelector('[data-automation="hotel-card-title"]');

        if (link && titleEl) {
          const name = titleEl.textContent?.trim();
          const url = link.href.split('?')[0].split('#')[0];

          if (name && !seenUrls.has(url) && !seenNames.has(name.toLowerCase())) {
            hotelList.push({
              rank: hotelList.length + 1,
              name: name,
              url: url
            });
            seenUrls.add(url);
            seenNames.add(name.toLowerCase());
          }
        }
      });
    }

    return hotelList;
  }, CONFIG.MAX_HOTELS);

  console.log(`✅ Found ${hotels.length} hotels\n`);
  return hotels;
}

async function extractHotelReviews(page, client, hotelUrl, hotelName) {
  console.log(`\n📖 ${hotelName}`);

  try {
    await page.goto(hotelUrl, {
      timeout: 120000,
      waitUntil: 'domcontentloaded'
    });

    // Check for CAPTCHA
    try {
      const { status } = await client.send('Captcha.waitForSolve', {
        detectTimeout: 5000,
      });
      if (status !== 'none') {
        console.log(`  ✓ CAPTCHA ${status}`);
      }
    } catch (e) {
      // No CAPTCHA
    }

    await randomDelay(2000, 4000);

    let allReviews = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages && currentPage <= CONFIG.MAX_REVIEW_PAGES) {
      console.log(`  Page ${currentPage}...`);

      try {
        await page.waitForSelector('[class*="review"], div', { timeout: 8000 });
        await randomDelay(1000, 2000);

        const pageReviews = await page.evaluate(() => {
          // TripAdvisor uses div[data-test-target="HR_CC_CARD"] for review cards
          let reviewCards = document.querySelectorAll('div[data-test-target="HR_CC_CARD"]');

          const reviews = [];

          reviewCards.forEach(card => {
            let title = '';
            const titleEl = card.querySelector('[data-test-target="review-title"]');
            if (titleEl) title = titleEl.textContent?.trim() || '';

            let text = '';
            // Review text is usually in a div/span after the title
            const textEl = card.querySelector('[data-test-target="review-text"]');
            if (textEl) {
              text = textEl.textContent?.trim() || '';
            } else {
              // Fallback: look for spans with substantial text
              const allSpans = card.querySelectorAll('span');
              for (const span of allSpans) {
                const spanText = span.textContent?.trim() || '';
                if (spanText.length > 100 && spanText.length < 5000) {
                  text = spanText;
                  break;
                }
              }
            }

            let rating = 0;
            // Rating bubbles have class like "ui_bubble_rating bubble_50" (5.0 rating)
            const ratingEl = card.querySelector('[class*="bubble_rating"]');
            if (ratingEl) {
              const match = ratingEl.className.match(/bubble_(\d+)/);
              if (match) rating = parseInt(match[1]) / 10;
            }

            let date = '';
            const dateEl = card.querySelector('[data-test-target="review-date"], time');
            if (dateEl) date = dateEl.textContent?.trim() || '';

            let reviewer = '';
            // Reviewer name is often in a link to profile
            const nameEl = card.querySelector('a[href*="/Profile/"]');
            if (nameEl) {
              const nameDiv = nameEl.querySelector('span, div');
              if (nameDiv) reviewer = nameDiv.textContent?.trim() || '';
            }

            if (text && text.length > 20) {
              reviews.push({ title, text, rating, date, reviewer });
            }
          });

          return reviews;
        });

        console.log(`    ✓ ${pageReviews.length} reviews`);
        allReviews = allReviews.concat(pageReviews);

        // Try to find next page
        const nextButton = await page.$('[data-automation="pagination-next"], a.next, a[aria-label*="Next"]');

        if (nextButton) {
          const isDisabled = await nextButton.evaluate(btn =>
            btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true'
          );

          if (!isDisabled) {
            await nextButton.click();
            await randomDelay(CONFIG.DELAY_BETWEEN_PAGES, CONFIG.DELAY_BETWEEN_PAGES + 2000);

            // Check for CAPTCHA after navigation
            try {
              const { status } = await client.send('Captcha.waitForSolve', {
                detectTimeout: 3000,
              });
              if (status !== 'none') {
                console.log(`    ✓ CAPTCHA ${status}`);
              }
            } catch (e) {
              // No CAPTCHA
            }

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
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  TripAdvisor Scraper - Bright Data Scraping Browser   ║');
  console.log('║  (Automatic CAPTCHA Solving)                          ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('📋 Config:');
  console.log(`   Target Hotels: ${CONFIG.MAX_HOTELS}`);
  console.log(`   Max Review Pages: ${CONFIG.MAX_REVIEW_PAGES} per hotel`);
  console.log(`   Keywords: ${CONFIG.CELEBRITY_KEYWORDS.join(', ')}`);
  console.log('\n🔌 Connecting to Scraping Browser...');

  const browserWSEndpoint = `wss://${AUTH}@brd.superproxy.io:9222`;

  let browser;
  try {
    browser = await puppeteer.connect({
      browserWSEndpoint,
      timeout: 60000
    });

    console.log('✓ Connected to Scraping Browser!\n');

    const page = await browser.newPage();
    const client = await page.createCDPSession();

    const hotels = await extractHotelList(page, client);

    if (hotels.length === 0) {
      console.error('❌ No hotels found');
      await page.screenshot({ path: './results/no-hotels.png' });
      await browser.close();
      return;
    }

    saveResults(hotels, 'hotels-list.json');

    // Load existing results if they exist
    let results = [];
    const progressFile = path.join(CONFIG.RESULTS_DIR, 'scraping-progress.json');
    if (fs.existsSync(progressFile)) {
      try {
        results = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
        console.log(`\n✓ Loaded ${results.length} existing results\n`);
      } catch (e) {
        console.log(`\n⚠️ Could not load existing results: ${e.message}\n`);
      }
    }

    // Process ALL hotels from the list
    console.log(`\n📊 Processing ${hotels.length} hotels\n`);

    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];
      console.log(`\n[${i + 1}/${hotels.length}] ${hotel.name}`);

      // Skip if already processed with reviews
      const existingResult = results.find(r => r.url === hotel.url);
      if (existingResult && existingResult.totalReviews > 0) {
        console.log(`  ⏭️  Already processed (${existingResult.totalReviews} reviews)`);
        continue;
      }

      const reviews = await extractHotelReviews(page, client, hotel.url, hotel.name);

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

      // Update or add result
      const existingIndex = results.findIndex(r => r.url === hotel.url);
      if (existingIndex >= 0) {
        results[existingIndex] = hotelResult;
      } else {
        results.push(hotelResult);
      }

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
    console.log(`📊 Hotels scraped: ${summary.totalHotelsScraped}`);
    console.log(`📝 Total reviews: ${summary.totalReviewsScraped}`);
    console.log(`⭐ Celebrity mentions: ${summary.totalCelebrityMentions}`);
    console.log(`🏨 Hotels with mentions: ${summary.hotelsWithMentions}`);
    console.log('\n🏆 Top 5 Hotels by Celebrity Mentions:');
    summary.topHotelsByMentions.slice(0, 5).forEach((h, i) => {
      console.log(`   ${i + 1}. ${h.name} - ${h.mentions} mentions`);
    });
    console.log(`\n📁 Results saved to: ./${CONFIG.RESULTS_DIR}/\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  } finally {
    if (browser) {
      await browser.close();
      console.log('✓ Browser closed');
    }
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

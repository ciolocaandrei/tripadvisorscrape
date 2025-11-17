/**
 * Step 2: Extract Reviews from Hotel List
 *
 * This script takes the hotels from hotels-list.json (or final-results.json)
 * and extracts ALL reviews from each hotel.
 *
 * Usage:
 *   node extract-reviews.js                    # Process all hotels
 *   BATCH_START=0 node extract-reviews.js      # Process hotels 0-4
 *   BATCH_START=5 node extract-reviews.js      # Process hotels 5-9
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

// Bright Data Scraping Browser credentials
const AUTH = 'brd-customer-hl_94d90749-zone-scraping_browser:7923gx0w4vyy';

const CONFIG = {
  BATCH_SIZE: 5,   // Process in batches due to page limits
  BATCH_START: parseInt(process.env.BATCH_START || '0'),
  MAX_REVIEW_PAGES: 20,  // Max pages of reviews per hotel
  CELEBRITY_KEYWORDS: ['celeb spotting', 'celeb sighting', 'celebrities'],
  DELAY_BETWEEN_HOTELS: 5000,
  DELAY_BETWEEN_PAGES: 3000,
  RESULTS_DIR: './results',
  HOTELS_FILE: './results/hotels-list.json',  // Read from existing hotel list
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => delay(Math.floor(Math.random() * (max - min + 1) + min));

function saveResults(data, filename) {
  if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
    fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
  }
  const filepath = path.join(CONFIG.RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
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
  console.log('║  Step 2: Extract Reviews from Hotel List              ║');
  console.log('║  Bright Data Scraping Browser                          ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Load hotel list
  if (!fs.existsSync(CONFIG.HOTELS_FILE)) {
    console.error(`❌ Hotel list not found: ${CONFIG.HOTELS_FILE}`);
    console.error('   Run scraping-browser.js first to extract hotel list!\n');
    process.exit(1);
  }

  const hotels = JSON.parse(fs.readFileSync(CONFIG.HOTELS_FILE, 'utf8'));
  console.log(`✓ Loaded ${hotels.length} hotels from ${CONFIG.HOTELS_FILE}\n`);

  const batchEnd = Math.min(CONFIG.BATCH_START + CONFIG.BATCH_SIZE, hotels.length);

  console.log('📋 Config:');
  console.log(`   Total Hotels: ${hotels.length}`);
  console.log(`   Batch: ${CONFIG.BATCH_START + 1}-${batchEnd} (${CONFIG.BATCH_SIZE} hotels)`);
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

    // Load existing results if they exist
    let results = [];
    const progressFile = path.join(CONFIG.RESULTS_DIR, 'reviews-progress.json');
    if (fs.existsSync(progressFile)) {
      try {
        results = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
        console.log(`✓ Loaded ${results.length} existing results\n`);
      } catch (e) {
        console.log(`⚠️ Could not load existing results: ${e.message}\n`);
      }
    }

    // Process only the batch range
    const hotelsToProcess = hotels.slice(CONFIG.BATCH_START, batchEnd);

    console.log(`📊 Processing hotels ${CONFIG.BATCH_START + 1}-${batchEnd} of ${hotels.length} total\n`);

    for (let i = 0; i < hotelsToProcess.length; i++) {
      const hotel = hotelsToProcess[i];
      const globalIndex = CONFIG.BATCH_START + i;
      console.log(`\n[${globalIndex + 1}/${hotels.length}] ${hotel.name}`);

      // Skip if already processed
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

      saveResults(results, 'reviews-progress.json');

      if (i < hotelsToProcess.length - 1) {
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

    saveResults(results, 'reviews-final.json');
    saveResults(summary, 'reviews-summary.json');

    console.log('\n' + '═'.repeat(60));
    console.log('✅ REVIEW EXTRACTION COMPLETED!');
    console.log('═'.repeat(60));
    console.log(`📊 Hotels in this batch: ${hotelsToProcess.length}`);
    console.log(`📊 Total hotels with reviews: ${summary.totalHotelsScraped}`);
    console.log(`📝 Reviews: ${summary.totalReviewsScraped}`);
    console.log(`⭐ Celebrity Mentions: ${summary.totalCelebrityMentions}`);
    console.log(`🏨 Hotels with Mentions: ${summary.hotelsWithMentions}`);
    console.log('\n🏆 Top 5:');
    summary.topHotelsByMentions.slice(0, 5).forEach((h, i) => {
      console.log(`   ${i + 1}. ${h.name} - ${h.mentions} mentions`);
    });
    console.log(`\n📁 Results: ./${CONFIG.RESULTS_DIR}/`);

    if (batchEnd < hotels.length) {
      console.log(`\n⚡ To continue with next batch, run:`);
      console.log(`   BATCH_START=${batchEnd} node extract-reviews.js`);
      console.log(`\n📝 Or use the batch runner:`);
      console.log(`   node run-review-batches.js\n`);
    } else {
      console.log(`\n✅ All ${hotels.length} hotels have been processed!\n`);
    }

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

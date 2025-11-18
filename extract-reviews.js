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
  MAX_REVIEW_PAGES: 100,  // Max pages of reviews per hotel (~1000 reviews per hotel)
  CELEBRITY_KEYWORDS: ['celeb spotting', 'celeb sighting', 'celebrities'],
  DELAY_BETWEEN_HOTELS: 3000,
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

async function extractReviewsWithFreshBrowser(hotelUrl, startPage, maxPages) {
  const browserWSEndpoint = `wss://${AUTH}@brd.superproxy.io:9222`;
  let browser;

  try {
    browser = await puppeteer.connect({
      browserWSEndpoint,
      timeout: 60000
    });

    const page = await browser.newPage();
    const client = await page.createCDPSession();

    // Navigate to hotel URL
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
        console.log(`    ✓ CAPTCHA ${status}`);
      }
    } catch (e) {
      // No CAPTCHA
    }

    await randomDelay(2000, 4000);

    let allReviews = [];
    let currentPage = startPage;
    let hasMorePages = true;
    const endPage = startPage + maxPages - 1;

    // If not starting from page 1, navigate to the correct page
    if (startPage > 1) {
      const paginationNeeded = startPage - 1;
      for (let i = 0; i < paginationNeeded; i++) {
        const nextButton = await page.$('[data-automation="pagination-next"], a.next, a[aria-label*="Next"]');
        if (nextButton) {
          const isDisabled = await nextButton.evaluate(btn =>
            btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true'
          );
          if (!isDisabled) {
            await nextButton.click();
            await randomDelay(CONFIG.DELAY_BETWEEN_PAGES, CONFIG.DELAY_BETWEEN_PAGES + 2000);
          } else {
            break;
          }
        } else {
          break;
        }
      }
    }

    while (hasMorePages && currentPage <= endPage) {
      console.log(`    Page ${currentPage}...`);

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
            try {
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
                // No CAPTCHA or error - continue
              }

              currentPage++;
            } catch (navError) {
              // Navigation failed (likely quota limit), stop pagination for this hotel
              console.log(`    ⚠️ Pagination stopped: ${navError.message}`);
              hasMorePages = false;
            }
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

    await browser.close();
    console.log(`    ✓ Browser session closed`);
    return allReviews;

  } catch (error) {
    console.error(`    ❌ ${error.message}`);
    if (browser) {
      try {
        await browser.close();
      } catch (e) {
        // Ignore
      }
    }
    return [];
  }
}

async function processHotelWithFreshBrowser(hotel, hotelIndex, totalHotels) {
  console.log(`\n[${hotelIndex + 1}/${totalHotels}] ${hotel.name}`);
  console.log(`  📖 Extracting up to ${CONFIG.MAX_REVIEW_PAGES} pages (~${CONFIG.MAX_REVIEW_PAGES * 10} reviews)`);
  console.log(`  🔄 Using fresh browser every 25 pages (4 browser sessions total)\n`);

  const PAGES_PER_BROWSER = 25;
  const totalSessions = Math.ceil(CONFIG.MAX_REVIEW_PAGES / PAGES_PER_BROWSER);
  let allReviews = [];

  try {
    for (let session = 0; session < totalSessions; session++) {
      const startPage = session * PAGES_PER_BROWSER + 1;
      const pagesInThisSession = Math.min(PAGES_PER_BROWSER, CONFIG.MAX_REVIEW_PAGES - (session * PAGES_PER_BROWSER));

      console.log(`  🔌 Browser Session ${session + 1}/${totalSessions}: Pages ${startPage}-${startPage + pagesInThisSession - 1}`);

      const sessionReviews = await extractReviewsWithFreshBrowser(hotel.url, startPage, pagesInThisSession);
      allReviews = allReviews.concat(sessionReviews);

      console.log(`    ✓ Session ${session + 1} complete: ${sessionReviews.length} reviews`);

      // Wait between sessions
      if (session < totalSessions - 1) {
        await delay(2000);
      }
    }

    console.log(`  ✅ Total: ${allReviews.length} reviews from ${totalSessions} browser sessions`);
    return allReviews;

  } catch (error) {
    console.error(`  ❌ Error processing hotel: ${error.message}`);
    return allReviews; // Return what we got so far
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  Step 2: Extract Reviews from Hotel List              ║');
  console.log('║  Bright Data Scraping Browser                          ║');
  console.log('║  (Fresh browser connection per hotel)                  ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Load hotel list
  if (!fs.existsSync(CONFIG.HOTELS_FILE)) {
    console.error(`❌ Hotel list not found: ${CONFIG.HOTELS_FILE}`);
    console.error('   Run scraping-browser.js first to extract hotel list!\n');
    process.exit(1);
  }

  const hotels = JSON.parse(fs.readFileSync(CONFIG.HOTELS_FILE, 'utf8'));
  console.log(`✓ Loaded ${hotels.length} hotels from ${CONFIG.HOTELS_FILE}\n`);

  console.log('📋 Config:');
  console.log(`   Hotels to process: ${hotels.length}`);
  console.log(`   Max Review Pages: ${CONFIG.MAX_REVIEW_PAGES} per hotel (~${CONFIG.MAX_REVIEW_PAGES * 10} reviews)`);
  console.log(`   Keywords: ${CONFIG.CELEBRITY_KEYWORDS.join(', ')}`);
  console.log(`   Estimated total reviews: ~${hotels.length * CONFIG.MAX_REVIEW_PAGES * 10}`);

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

  // Start execution timer
  const startTime = Date.now();
  console.log(`📊 Processing all ${hotels.length} hotels\n`);
  console.log(`🔄 Each hotel gets a fresh browser connection\n`);
  console.log(`⏱️  Started at: ${new Date().toLocaleTimeString()}\n`);

  try {
    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];

      // Skip if already processed
      const existingResult = results.find(r => r.url === hotel.url);
      if (existingResult && existingResult.totalReviews > 0) {
        console.log(`\n[${i + 1}/${hotels.length}] ${hotel.name}`);
        console.log(`  ⏭️  Already processed (${existingResult.totalReviews} reviews)`);
        continue;
      }

      const reviews = await processHotelWithFreshBrowser(hotel, i, hotels.length);

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

    saveResults(results, 'reviews-final.json');
    saveResults(summary, 'reviews-summary.json');

    // Calculate execution time
    const endTime = Date.now();
    const totalSeconds = Math.floor((endTime - startTime) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    console.log('\n' + '═'.repeat(60));
    console.log('✅ REVIEW EXTRACTION COMPLETED!');
    console.log('═'.repeat(60));
    console.log(`📊 Total hotels processed: ${summary.totalHotelsScraped}`);
    console.log(`📝 Total reviews: ${summary.totalReviewsScraped}`);
    console.log(`⭐ Celebrity mentions: ${summary.totalCelebrityMentions}`);
    console.log(`🏨 Hotels with mentions: ${summary.hotelsWithMentions}`);
    console.log('\n🏆 Top 5 hotels by celebrity mentions:');
    summary.topHotelsByMentions.slice(0, 5).forEach((h, i) => {
      console.log(`   ${i + 1}. ${h.name} - ${h.mentions} mentions`);
    });
    console.log(`\n⏱️  Execution Time:`);
    console.log(`   Total: ${hours}h ${minutes}m ${seconds}s`);
    console.log(`   Started: ${new Date(startTime).toLocaleTimeString()}`);
    console.log(`   Finished: ${new Date(endTime).toLocaleTimeString()}`);
    console.log(`   Average: ${(totalSeconds / summary.totalHotelsScraped).toFixed(1)}s per hotel`);
    console.log(`\n📁 Results saved to: ./${CONFIG.RESULTS_DIR}/`);
    console.log(`✅ All ${hotels.length} hotels have been processed!\n`);

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

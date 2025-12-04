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
  MAX_HOTELS: 5,  // Process only ONE incomplete hotel per run
  MAX_REVIEW_PAGES: 100,  // Max pages of reviews per hotel (~1000 reviews per hotel)
  TARGET_REVIEWS: 1000,  // Target number of reviews per hotel (will stop when reached)
  CELEBRITY_KEYWORDS: ['celeb spotting', 'celeb sighting', 'celebrities'],
  DELAY_BETWEEN_HOTELS: 100,
  DELAY_BETWEEN_PAGES: 100,
  PAGE_TIMEOUT: 2 * 60 * 1000,  // 2 minutes timeout per page
  MAX_PAGE_RETRIES: 3,  // Max retries per page before skipping
  RESULTS_DIR: './results',
  REVIEWS_DIR: './results/reviews',  // Individual hotel review files
  PROGRESS_DIR: './results/progress',  // Individual hotel progress files
  HOTELS_FILE: './results/hotels-list.json',  // Read from existing hotel list
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));
const randomDelay = (min, max) => delay(Math.floor(Math.random() * (max - min + 1) + min));

// Helper to run a promise with timeout
function withTimeout(promise, timeoutMs, errorMessage = 'Operation timed out') {
  return Promise.race([
    promise,
    new Promise((_, reject) => setTimeout(() => reject(new Error(errorMessage)), timeoutMs))
  ]);
}

function formatTime(ms) {
  const totalSeconds = Math.floor(ms / 1000);
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours > 0) {
    return `${hours}h ${minutes}m ${seconds}s`;
  } else if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}

function saveResults(data, filename) {
  if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
    fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
  }
  const filepath = path.join(CONFIG.RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
}

function sanitizeFilename(name) {
  // Convert to lowercase, replace spaces and special chars with hyphens
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100); // Limit length
}

function saveHotelReviews(hotel, reviews, celebrityData) {
  // Create reviews directory if it doesn't exist
  if (!fs.existsSync(CONFIG.REVIEWS_DIR)) {
    fs.mkdirSync(CONFIG.REVIEWS_DIR, { recursive: true });
  }

  const sanitizedName = sanitizeFilename(hotel.name);
  const filename = `hotel-${hotel.rank}-${sanitizedName}.json`;
  const filepath = path.join(CONFIG.REVIEWS_DIR, filename);

  const hotelData = {
    rank: hotel.rank,
    name: hotel.name,
    url: hotel.url,
    totalReviews: reviews.length,
    reviewsWithCelebrityMentions: celebrityData.reviewsWithMentions.length,
    totalCelebrityMentions: celebrityData.totalMentions,
    mentionBreakdown: celebrityData.mentionBreakdown,
    reviews: reviews,
    reviewsWithMentions: celebrityData.reviewsWithMentions
  };

  fs.writeFileSync(filepath, JSON.stringify(hotelData, null, 2));
  console.log(`  💾 Saved to: ${filename}`);
}

// Generate a filename-safe ID from hotel URL
function getHotelId(hotelUrl) {
  // Extract hotel ID from URL like: Hotel_Review-g45963-d4790631-Reviews-Downtown_Grand_Hotel
  const match = hotelUrl.match(/Hotel_Review-([^.]+)/);
  if (match) {
    return match[1].replace(/-Reviews.*$/, '');
  }
  // Fallback: hash the URL
  return hotelUrl.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
}

function getHotelProgressFile(hotelUrl) {
  return path.join(CONFIG.PROGRESS_DIR, `${getHotelId(hotelUrl)}.json`);
}

// Page progress tracking functions (per hotel file)
function loadHotelProgress(hotelUrl) {
  const progressFile = getHotelProgressFile(hotelUrl);
  if (fs.existsSync(progressFile)) {
    try {
      return JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    } catch (e) {
      console.log(`⚠️ Could not load progress for hotel: ${e.message}`);
    }
  }
  return { lastCompletedPage: 0, reviews: [], startTime: null, elapsedTime: 0, pageTimes: {} };
}

function saveHotelProgress(hotelUrl, progress) {
  if (!fs.existsSync(CONFIG.PROGRESS_DIR)) {
    fs.mkdirSync(CONFIG.PROGRESS_DIR, { recursive: true });
  }
  const progressFile = getHotelProgressFile(hotelUrl);
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

function getHotelPageProgress(pageProgress, hotelUrl) {
  return loadHotelProgress(hotelUrl);
}

function updateHotelPageProgress(pageProgress, hotelUrl, pageNum, allReviewsSoFar, elapsedTime, pageTimeData) {
  let progress = loadHotelProgress(hotelUrl);

  progress.hotelUrl = hotelUrl;
  progress.lastCompletedPage = pageNum;
  progress.reviews = allReviewsSoFar;
  progress.elapsedTime = elapsedTime;
  progress.elapsedMinutes = (elapsedTime / 1000 / 60).toFixed(2);
  progress.totalMinutes = (elapsedTime / 1000 / 60).toFixed(2);

  // Track time per page
  if (pageTimeData) {
    if (!progress.pageTimes) {
      progress.pageTimes = {};
    }
    progress.pageTimes[`page_${pageNum}`] = {
      startTime: pageTimeData.startTime,
      endTime: pageTimeData.endTime,
      durationMinutes: (pageTimeData.durationMs / 1000 / 60).toFixed(2)
    };
  }

  progress.lastUpdated = new Date().toISOString();
  saveHotelProgress(hotelUrl, progress);
}

function initHotelPageProgress(pageProgress, hotelUrl) {
  const progressFile = getHotelProgressFile(hotelUrl);
  console.log(`    📁 Progress file: ${progressFile}`);

  let progress = loadHotelProgress(hotelUrl);
  console.log(`    📁 Loaded progress: lastCompletedPage=${progress.lastCompletedPage}, reviews=${progress.reviews?.length || 0}, startTime=${progress.startTime}`);

  if (!progress.startTime) {
    progress = {
      hotelUrl: hotelUrl,
      lastCompletedPage: 0,
      reviews: [],
      startTime: Date.now(),
      elapsedTime: 0,
      pageTimes: {}
    };
    saveHotelProgress(hotelUrl, progress);
  }
  return progress;
}

function clearHotelPageProgress(hotelUrl) {
  const progressFile = getHotelProgressFile(hotelUrl);
  if (fs.existsSync(progressFile)) {
    fs.unlinkSync(progressFile);
  }
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

function buildReviewPageUrl(baseUrl, pageNum) {
  // TripAdvisor uses -orX- for pagination where X is (pageNum - 1) * 10
  // Example: page 1 = no offset, page 2 = -or10-, page 3 = -or20-
  if (pageNum === 1) {
    return baseUrl;
  }

  const offset = (pageNum - 1) * 10;

  // Insert -orX- before the last part of the URL
  // Example: /Hotel_Review-g45963-d99430-Reviews-Bellagio_Las_Vegas.html
  // becomes: /Hotel_Review-g45963-d99430-Reviews-or10-Bellagio_Las_Vegas.html
  const urlParts = baseUrl.split('-Reviews-');
  if (urlParts.length === 2) {
    return `${urlParts[0]}-Reviews-or${offset}-${urlParts[1]}`;
  }

  return baseUrl;
}

async function extractSinglePageWithFreshBrowser(hotelUrl, pageNum) {
  const browserWSEndpoint = `wss://${AUTH}@brd.superproxy.io:9222`;
  let browser;

  try {
    // Fresh browser for this single page
    browser = await puppeteer.connect({
      browserWSEndpoint,
      timeout: 10000
    });

    const page = await browser.newPage();
    const client = await page.createCDPSession();

    // Build URL for this specific page
    const pageUrl = buildReviewPageUrl(hotelUrl, pageNum);

    // Navigate directly to the page URL
    await page.goto(pageUrl, {
      timeout: 20000,
      waitUntil: 'domcontentloaded'
    });

    // Check for CAPTCHA
    try {
      const { status } = await client.send('Captcha.waitForSolve', {
        detectTimeout: 1000,
      });
      if (status !== 'none') {
        console.log(`    ✓ CAPTCHA ${status}`);
      }
    } catch (e) {
      // No CAPTCHA
    }

    await randomDelay(300, 500);

    // Extract reviews from current page
    await page.waitForSelector('[class*="review"], div', { timeout: 2000 });
    await randomDelay(100, 200);

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

    await browser.close();
    return pageReviews;

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

async function extractReviewsWithFreshBrowser(hotelUrl, startPage, maxPages, pageProgress) {
  // Initialize or get existing page progress
  const hotelProgress = initHotelPageProgress(pageProgress, hotelUrl);
  let allReviews = hotelProgress.reviews || [];
  const resumeFromPage = hotelProgress.lastCompletedPage + 1;
  const previousElapsedTime = hotelProgress.elapsedTime || 0;

  // Track time for this session
  const sessionStartTime = Date.now();

  // Determine actual start page (resume from where we left off)
  const actualStartPage = resumeFromPage > startPage ? resumeFromPage : startPage;
  const endPage = startPage + maxPages - 1;

  if (actualStartPage > startPage) {
    const prevTimeStr = formatTime(previousElapsedTime);
    console.log(`    📂 Resuming from page ${actualStartPage} (${allReviews.length} reviews, ${prevTimeStr} elapsed)`);
  }

  let consecutiveEmptyPages = 0;
  const MAX_EMPTY_PAGES = 3; // Stop after 3 consecutive pages with no reviews

  for (let currentPage = actualStartPage; currentPage <= endPage; currentPage++) {
    console.log(`    Page ${currentPage}...`);

    let pageReviews = [];
    let pageSuccess = false;
    let retryCount = 0;

    // Retry loop for this page
    while (retryCount < CONFIG.MAX_PAGE_RETRIES && !pageSuccess) {
      // Track page start time
      const pageStartTime = Date.now();

      try {
        // Run with timeout
        pageReviews = await withTimeout(
          extractSinglePageWithFreshBrowser(hotelUrl, currentPage),
          CONFIG.PAGE_TIMEOUT,
          `Page ${currentPage} timed out after 2 minutes`
        );

        // Track page end time
        const pageEndTime = Date.now();

        console.log(`    ✓ ${pageReviews.length} reviews`);
        allReviews = allReviews.concat(pageReviews);

        // Calculate total elapsed time (previous + current session)
        const currentSessionTime = Date.now() - sessionStartTime;
        const totalElapsedTime = previousElapsedTime + currentSessionTime;

        // Page time data
        const pageTimeData = {
          startTime: new Date(pageStartTime).toISOString(),
          endTime: new Date(pageEndTime).toISOString(),
          durationMs: pageEndTime - pageStartTime
        };

        // Save page progress after each successful page (pass ALL reviews so far)
        updateHotelPageProgress(pageProgress, hotelUrl, currentPage, allReviews, totalElapsedTime, pageTimeData);
        console.log(`    💾 Progress saved (page ${currentPage}, ${allReviews.length} reviews, ${formatTime(totalElapsedTime)} total)`);

        pageSuccess = true;

        // Check if we've reached target reviews
        if (allReviews.length >= CONFIG.TARGET_REVIEWS) {
          console.log(`    ✅ Reached target of ${CONFIG.TARGET_REVIEWS} reviews (${allReviews.length} collected)`);
          break;
        }

        // Track consecutive empty pages
        if (pageReviews.length === 0) {
          consecutiveEmptyPages++;
          console.log(`    ⚠️ No reviews found (${consecutiveEmptyPages}/${MAX_EMPTY_PAGES} empty pages)`);

          // Stop if we've hit 3 consecutive empty pages
          if (consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
            console.log(`    ⚠️ ${MAX_EMPTY_PAGES} consecutive pages with no reviews, stopping pagination`);
            break;
          }
        } else {
          // Reset counter if we found reviews
          consecutiveEmptyPages = 0;
        }

      } catch (error) {
        retryCount++;
        console.log(`    ⚠️ ${error.message} (attempt ${retryCount}/${CONFIG.MAX_PAGE_RETRIES})`);

        if (retryCount < CONFIG.MAX_PAGE_RETRIES) {
          console.log(`    🔄 Retrying page ${currentPage}...`);
          await delay(2000); // Wait 2 seconds before retry
        }
      }
    }

    // If all retries failed, skip to next page
    if (!pageSuccess) {
      console.log(`    ⏭️ Skipping page ${currentPage} after ${CONFIG.MAX_PAGE_RETRIES} failed attempts`);
      consecutiveEmptyPages++;

      // Stop if we've hit too many consecutive errors/empty pages
      if (consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
        console.log(`    ⚠️ ${MAX_EMPTY_PAGES} consecutive failures, stopping pagination`);
        break;
      }
      continue;
    }

    // Wait between pages
    if (currentPage < endPage) {
      await randomDelay(CONFIG.DELAY_BETWEEN_PAGES, CONFIG.DELAY_BETWEEN_PAGES + 2000);
    }
  }

  // Calculate final total time
  const finalSessionTime = Date.now() - sessionStartTime;
  const totalTime = previousElapsedTime + finalSessionTime;

  console.log(`    ✓ Session complete: ${allReviews.length} reviews extracted in ${formatTime(totalTime)}`);
  return { reviews: allReviews, totalTime };
}

async function processHotelWithFreshBrowser(hotel, hotelIndex, totalHotels, pageProgress) {
  console.log(`\n[${hotelIndex + 1}/${totalHotels}] ${hotel.name}`);
  console.log(`  📖 Extracting up to ${CONFIG.MAX_REVIEW_PAGES} pages (~${CONFIG.MAX_REVIEW_PAGES * 10} reviews)`);
  console.log(`  🔄 Using fresh browser for EACH page\n`);

  try {
    const result = await extractReviewsWithFreshBrowser(hotel.url, 1, CONFIG.MAX_REVIEW_PAGES, pageProgress);
    const { reviews: allReviews, totalTime } = result;
    console.log(`  ✅ Total: ${allReviews.length} reviews extracted in ${formatTime(totalTime)}`);

    // Clear page progress for this hotel once fully complete
    clearHotelPageProgress(hotel.url);

    return { reviews: allReviews, totalTime };

  } catch (error) {
    console.error(`  ❌ Error processing hotel: ${error.message}`);
    return { reviews: [], totalTime: 0 };
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

  const allHotels = JSON.parse(fs.readFileSync(CONFIG.HOTELS_FILE, 'utf8'));
  console.log(`✓ Loaded ${allHotels.length} hotels from ${CONFIG.HOTELS_FILE}\n`);

  // Load existing results to check which hotels are completed
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

  // Find the first incomplete hotel
  let hotels = [];
  for (const hotel of allHotels) {
    // Check if hotel has page progress (partial scrape) - needs to continue
    const hotelProgress = loadHotelProgress(hotel.url);
    const hasPartialProgress = hotelProgress.lastCompletedPage > 0 && hotelProgress.lastCompletedPage < CONFIG.MAX_REVIEW_PAGES;

    // Check if hotel is fully completed:
    // - Has reviews in results AND either reached target reviews OR finished all pages
    const existingResult = results.find(r => r.url === hotel.url);
    const reachedTargetReviews = existingResult && existingResult.totalReviews >= CONFIG.TARGET_REVIEWS;
    const isFullyCompleted = existingResult && existingResult.totalReviews > 0 && !hasPartialProgress;

    // Hotel is done if it reached target reviews OR is fully completed
    if (reachedTargetReviews || isFullyCompleted) {
      continue;
    }

    hotels.push(hotel);
    if (hotels.length >= CONFIG.MAX_HOTELS) {
      break;
    }
  }

  if (hotels.length === 0) {
    console.log('✅ All hotels have been fully processed!\n');
    process.exit(0);
  }

  console.log(`📋 Found ${hotels.length} incomplete hotel(s) to process\n`);

  console.log('📋 Config:');
  console.log(`   Hotels to process: ${hotels.length}`);
  console.log(`   Max Review Pages: ${CONFIG.MAX_REVIEW_PAGES} per hotel (~${CONFIG.MAX_REVIEW_PAGES * 10} reviews)`);
  console.log(`   Keywords: ${CONFIG.CELEBRITY_KEYWORDS.join(', ')}`);
  console.log(`   Total hotels in list: ${allHotels.length}`);
  console.log(`   Completed hotels: ${allHotels.length - hotels.length}`);

  // Check progress directory for resumable hotels
  const pageProgress = {}; // Now each hotel has its own file

  // Start execution timer
  const startTime = Date.now();
  console.log(`\n📊 Processing ${hotels.length} incomplete hotel(s)\n`);
  console.log(`🔄 Each hotel gets a fresh browser connection\n`);
  console.log(`⏱️  Started at: ${new Date().toLocaleTimeString()}\n`);

  try {
    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];

      // Check if hotel has page progress (partial scrape) - show resume info
      const hotelProgress = loadHotelProgress(hotel.url);
      const hasPartialProgress = hotelProgress.lastCompletedPage > 0;

      if (hasPartialProgress) {
        console.log(`\n[${i + 1}/${hotels.length}] ${hotel.name}`);
        console.log(`  📂 Resuming from page ${hotelProgress.lastCompletedPage + 1} (${hotelProgress.reviews?.length || 0} reviews so far)`);
      }

      const result = await processHotelWithFreshBrowser(hotel, i, hotels.length, pageProgress);
      const { reviews, totalTime } = result;

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
        totalTimeMs: totalTime,
        totalTimeFormatted: formatTime(totalTime),
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

      console.log(`  ⏱️  Time: ${formatTime(totalTime)}`);
      console.log(`  ⭐ Mentions: ${totalMentions} in ${reviewsWithMentions.length} reviews`);
      if (Object.keys(mentionBreakdown).length > 0) {
        console.log(`  📊 ${JSON.stringify(mentionBreakdown)}`);
      }

      // Save individual hotel file
      saveHotelReviews(hotel, reviews, {
        reviewsWithMentions,
        totalMentions,
        mentionBreakdown
      });

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
    console.log('✅ HOTEL REVIEW EXTRACTION COMPLETED!');
    console.log('═'.repeat(60));
    console.log(`📊 Hotels processed this run: ${hotels.length}`);
    console.log(`📊 Total hotels completed: ${summary.totalHotelsScraped}/${allHotels.length}`);
    console.log(`📝 Total reviews: ${summary.totalReviewsScraped}`);
    console.log(`⭐ Celebrity mentions: ${summary.totalCelebrityMentions}`);
    console.log(`🏨 Hotels with mentions: ${summary.hotelsWithMentions}`);
    if (summary.topHotelsByMentions.length > 0) {
      console.log('\n🏆 Top 5 hotels by celebrity mentions:');
      summary.topHotelsByMentions.slice(0, 5).forEach((h, i) => {
        console.log(`   ${i + 1}. ${h.name} - ${h.mentions} mentions`);
      });
    }
    console.log(`\n⏱️  Execution Time:`);
    console.log(`   Total: ${hours}h ${minutes}m ${seconds}s`);
    console.log(`   Started: ${new Date(startTime).toLocaleTimeString()}`);
    console.log(`   Finished: ${new Date(endTime).toLocaleTimeString()}`);
    if (summary.totalHotelsScraped > 0) {
      console.log(`   Average: ${(totalSeconds / hotels.length).toFixed(1)}s per hotel (this run)`);
    }
    console.log(`\n📁 Results saved to:`);
    console.log(`   Combined: ./${CONFIG.RESULTS_DIR}/reviews-final.json`);
    console.log(`   Individual: ./${CONFIG.REVIEWS_DIR}/`);
    console.log(`   Summary: ./${CONFIG.RESULTS_DIR}/reviews-summary.json`);

    const remainingHotels = allHotels.length - summary.totalHotelsScraped;
    if (remainingHotels > 0) {
      console.log(`\n⏳ ${remainingHotels} hotel(s) remaining. Run again to continue.\n`);
    } else {
      console.log(`\n✅ All ${allHotels.length} hotels have been processed!\n`);
    }

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
  }
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

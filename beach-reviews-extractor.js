/**
 * Step 2: Extract Reviews from Beach List
 *
 * This script takes the beaches from beaches-list.json
 * and extracts ALL reviews from each beach, analyzing for keywords.
 *
 * Keywords analyzed: relaxing, hot, shells, litter, busy, crowded, peaceful,
 *                    clean, dirty, beautiful, paradise, pristine, etc.
 *
 * Usage:
 *   node beach-reviews-extractor.js                    # Process all beaches
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';
import path from 'path';

// Bright Data Scraping Browser credentials
const AUTH = 'brd-customer-hl_94d90749-zone-scraping_browser:7923gx0w4vyy';

const CONFIG = {
  MAX_BEACHES: 1,  // Process only ONE incomplete beach per run
  MAX_REVIEW_PAGES: 100,  // Max pages of reviews per beach (~1000 reviews)
  TARGET_REVIEWS: 1000,  // Target number of reviews per beach
  BEACH_KEYWORDS: [
    // Relaxation related
    'relaxing', 'relaxed', 'peaceful', 'tranquil', 'serene', 'calm', 'quiet',
    // Temperature/weather
    'hot', 'warm', 'sunny', 'scorching', 'cool', 'cold', 'windy',
    // Nature/beach features
    'shells', 'shell', 'seashells', 'coral', 'rocks', 'sand', 'white sand', 'golden sand',
    // Cleanliness
    'litter', 'trash', 'garbage', 'rubbish', 'clean', 'dirty', 'pristine', 'pollution',
    // Crowding
    'busy', 'crowded', 'packed', 'touristy', 'empty', 'secluded', 'private', 'quiet',
    // Beauty/quality
    'beautiful', 'stunning', 'gorgeous', 'paradise', 'heaven', 'amazing', 'breathtaking',
    // Water quality
    'clear water', 'crystal clear', 'turquoise', 'blue water', 'waves', 'calm water',
    // Activities
    'swimming', 'snorkeling', 'surfing', 'sunbathing', 'walking',
    // Facilities
    'parking', 'toilets', 'showers', 'restaurants', 'bars', 'umbrellas', 'sunbeds',
    // Safety
    'safe', 'dangerous', 'currents', 'lifeguard', 'jellyfish', 'sharks',
    // Family
    'family', 'kids', 'children', 'family-friendly'
  ],
  DELAY_BETWEEN_BEACHES: 100,
  DELAY_BETWEEN_PAGES: 100,
  PAGE_TIMEOUT: 2 * 60 * 1000,  // 2 minutes timeout per page
  MAX_PAGE_RETRIES: 3,
  RESULTS_DIR: './results/beaches',
  REVIEWS_DIR: './results/beaches/reviews',
  PROGRESS_DIR: './results/beaches/progress',
  BEACHES_FILE: './results/beaches/beaches-list.json',
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
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .substring(0, 100);
}

function saveBeachReviews(beach, reviews, keywordData) {
  if (!fs.existsSync(CONFIG.REVIEWS_DIR)) {
    fs.mkdirSync(CONFIG.REVIEWS_DIR, { recursive: true });
  }

  const sanitizedName = sanitizeFilename(beach.name);
  const filename = `beach-${beach.rank}-${sanitizedName}.json`;
  const filepath = path.join(CONFIG.REVIEWS_DIR, filename);

  const beachData = {
    rank: beach.rank,
    name: beach.name,
    url: beach.url,
    location: beach.location || '',
    totalReviews: reviews.length,
    reviewsWithKeywords: keywordData.reviewsWithKeywords.length,
    totalKeywordMentions: keywordData.totalMentions,
    keywordBreakdown: keywordData.keywordBreakdown,
    keywordCategories: keywordData.keywordCategories,
    reviews: reviews,
    reviewsWithKeywords: keywordData.reviewsWithKeywords
  };

  fs.writeFileSync(filepath, JSON.stringify(beachData, null, 2));
  console.log(`  💾 Saved to: ${filename}`);
}

// Generate a filename-safe ID from beach URL
function getBeachId(beachUrl) {
  // Extract attraction ID from URL like: Attraction_Review-g189413-d195373-Reviews-Elafonissi_Beach
  const match = beachUrl.match(/Attraction_Review-([^.]+)/);
  if (match) {
    return match[1].replace(/-Reviews.*$/, '');
  }
  return beachUrl.replace(/[^a-zA-Z0-9]/g, '_').substring(0, 50);
}

function getBeachProgressFile(beachUrl) {
  return path.join(CONFIG.PROGRESS_DIR, `${getBeachId(beachUrl)}.json`);
}

function loadBeachProgress(beachUrl) {
  const progressFile = getBeachProgressFile(beachUrl);
  if (fs.existsSync(progressFile)) {
    try {
      return JSON.parse(fs.readFileSync(progressFile, 'utf8'));
    } catch (e) {
      console.log(`⚠️ Could not load progress for beach: ${e.message}`);
    }
  }
  return { lastCompletedPage: 0, reviews: [], startTime: null, elapsedTime: 0, pageTimes: {} };
}

function saveBeachProgress(beachUrl, progress) {
  if (!fs.existsSync(CONFIG.PROGRESS_DIR)) {
    fs.mkdirSync(CONFIG.PROGRESS_DIR, { recursive: true });
  }
  const progressFile = getBeachProgressFile(beachUrl);
  fs.writeFileSync(progressFile, JSON.stringify(progress, null, 2));
}

function updateBeachPageProgress(beachUrl, pageNum, allReviewsSoFar, elapsedTime, pageTimeData) {
  let progress = loadBeachProgress(beachUrl);

  progress.beachUrl = beachUrl;
  progress.lastCompletedPage = pageNum;
  progress.reviews = allReviewsSoFar;
  progress.elapsedTime = elapsedTime;
  progress.elapsedMinutes = (elapsedTime / 1000 / 60).toFixed(2);
  progress.totalMinutes = (elapsedTime / 1000 / 60).toFixed(2);

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
  saveBeachProgress(beachUrl, progress);
}

function initBeachPageProgress(beachUrl) {
  const progressFile = getBeachProgressFile(beachUrl);
  console.log(`    📁 Progress file: ${progressFile}`);

  let progress = loadBeachProgress(beachUrl);
  console.log(`    📁 Loaded progress: lastCompletedPage=${progress.lastCompletedPage}, reviews=${progress.reviews?.length || 0}`);

  if (!progress.startTime) {
    progress = {
      beachUrl: beachUrl,
      lastCompletedPage: 0,
      reviews: [],
      startTime: Date.now(),
      elapsedTime: 0,
      pageTimes: {}
    };
    saveBeachProgress(beachUrl, progress);
  }
  return progress;
}

function clearBeachPageProgress(beachUrl) {
  const progressFile = getBeachProgressFile(beachUrl);
  if (fs.existsSync(progressFile)) {
    fs.unlinkSync(progressFile);
  }
}

function countKeywordMentions(text) {
  if (!text) return { total: 0, breakdown: {}, categories: {} };
  const lowerText = text.toLowerCase();
  const breakdown = {};
  let total = 0;

  // Categorize keywords
  const categories = {
    relaxation: ['relaxing', 'relaxed', 'peaceful', 'tranquil', 'serene', 'calm', 'quiet'],
    weather: ['hot', 'warm', 'sunny', 'scorching', 'cool', 'cold', 'windy'],
    nature: ['shells', 'shell', 'seashells', 'coral', 'rocks', 'sand', 'white sand', 'golden sand'],
    cleanliness: ['litter', 'trash', 'garbage', 'rubbish', 'clean', 'dirty', 'pristine', 'pollution'],
    crowding: ['busy', 'crowded', 'packed', 'touristy', 'empty', 'secluded', 'private'],
    beauty: ['beautiful', 'stunning', 'gorgeous', 'paradise', 'heaven', 'amazing', 'breathtaking'],
    water: ['clear water', 'crystal clear', 'turquoise', 'blue water', 'waves', 'calm water'],
    activities: ['swimming', 'snorkeling', 'surfing', 'sunbathing', 'walking'],
    facilities: ['parking', 'toilets', 'showers', 'restaurants', 'bars', 'umbrellas', 'sunbeds'],
    safety: ['safe', 'dangerous', 'currents', 'lifeguard', 'jellyfish', 'sharks'],
    family: ['family', 'kids', 'children', 'family-friendly']
  };

  const categoryTotals = {};

  CONFIG.BEACH_KEYWORDS.forEach(keyword => {
    const regex = new RegExp(`\\b${keyword.toLowerCase()}\\b`, 'gi');
    const matches = lowerText.match(regex);
    const count = matches ? matches.length : 0;
    if (count > 0) {
      breakdown[keyword] = count;
      total += count;

      // Find which category this keyword belongs to
      for (const [category, keywords] of Object.entries(categories)) {
        if (keywords.includes(keyword.toLowerCase())) {
          categoryTotals[category] = (categoryTotals[category] || 0) + count;
          break;
        }
      }
    }
  });

  return { total, breakdown, categories: categoryTotals };
}

function buildReviewPageUrl(baseUrl, pageNum) {
  // TripAdvisor uses -orX- for pagination where X is (pageNum - 1) * 10
  if (pageNum === 1) {
    return baseUrl;
  }

  const offset = (pageNum - 1) * 10;

  // For attractions: /Attraction_Review-g189413-d195373-Reviews-Elafonissi_Beach.html
  // becomes: /Attraction_Review-g189413-d195373-Reviews-or10-Elafonissi_Beach.html
  const urlParts = baseUrl.split('-Reviews-');
  if (urlParts.length === 2) {
    return `${urlParts[0]}-Reviews-or${offset}-${urlParts[1]}`;
  }

  return baseUrl;
}

async function extractSinglePageWithFreshBrowser(beachUrl, pageNum) {
  const browserWSEndpoint = `wss://${AUTH}@brd.superproxy.io:9222`;
  let browser;

  try {
    browser = await puppeteer.connect({
      browserWSEndpoint,
      timeout: 10000
    });

    const page = await browser.newPage();
    const client = await page.createCDPSession();

    const pageUrl = buildReviewPageUrl(beachUrl, pageNum);

    await page.goto(pageUrl, {
      timeout: 30000,
      waitUntil: 'domcontentloaded'
    });

    // Check for CAPTCHA
    try {
      const { status } = await client.send('Captcha.waitForSolve', {
        detectTimeout: 2000,
      });
      if (status !== 'none') {
        console.log(`    ✓ CAPTCHA ${status}`);
      }
    } catch (e) {
      // No CAPTCHA
    }

    await randomDelay(500, 1000);

    // Wait for reviews to load
    await page.waitForSelector('[class*="review"], div', { timeout: 5000 }).catch(() => {});
    await randomDelay(300, 500);

    // Extract reviews from current page
    const pageReviews = await page.evaluate(() => {
      // TripAdvisor attraction reviews use similar structure to hotels
      // Try multiple selectors
      let reviewCards = document.querySelectorAll('div[data-test-target="HR_CC_CARD"]');

      // Fallback selectors for attractions
      if (reviewCards.length === 0) {
        reviewCards = document.querySelectorAll('[data-automation="reviewCard"], [class*="reviewCard"]');
      }

      if (reviewCards.length === 0) {
        // Try finding reviews by common patterns
        reviewCards = document.querySelectorAll('[class*="review_"][class*="item"], [class*="Review__"]');
      }

      const reviews = [];

      reviewCards.forEach(card => {
        let title = '';
        // Try multiple title selectors
        const titleSelectors = [
          '[data-test-target="review-title"]',
          '[class*="title"]',
          'a[href*="ShowUserReviews"] span',
          'h5',
          '[class*="reviewTitle"]'
        ];
        for (const sel of titleSelectors) {
          const el = card.querySelector(sel);
          if (el) {
            title = el.textContent?.trim() || '';
            if (title) break;
          }
        }

        let text = '';
        // Try multiple text selectors
        const textSelectors = [
          '[data-test-target="review-text"]',
          '[class*="reviewText"]',
          '[class*="partial_entry"]',
          'q',
          'p[class*="text"]'
        ];
        for (const sel of textSelectors) {
          const el = card.querySelector(sel);
          if (el) {
            text = el.textContent?.trim() || '';
            if (text && text.length > 50) break;
          }
        }

        // Fallback: look for substantial text
        if (!text || text.length < 50) {
          const allSpans = card.querySelectorAll('span, p, div');
          for (const span of allSpans) {
            const spanText = span.textContent?.trim() || '';
            if (spanText.length > 100 && spanText.length < 5000 &&
                !spanText.includes('Helpful') && !spanText.includes('Share')) {
              text = spanText;
              break;
            }
          }
        }

        let rating = 0;
        const ratingEl = card.querySelector('[class*="bubble_rating"], [class*="rating"]');
        if (ratingEl) {
          const match = ratingEl.className.match(/bubble_(\d+)/);
          if (match) rating = parseInt(match[1]) / 10;
        }

        let date = '';
        const dateEl = card.querySelector('[data-test-target="review-date"], time, [class*="date"]');
        if (dateEl) date = dateEl.textContent?.trim() || '';

        let reviewer = '';
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

async function extractReviewsWithFreshBrowser(beachUrl, startPage, maxPages) {
  const beachProgress = initBeachPageProgress(beachUrl);
  let allReviews = beachProgress.reviews || [];
  const resumeFromPage = beachProgress.lastCompletedPage + 1;
  const previousElapsedTime = beachProgress.elapsedTime || 0;

  const sessionStartTime = Date.now();

  const actualStartPage = resumeFromPage > startPage ? resumeFromPage : startPage;
  const endPage = startPage + maxPages - 1;

  if (actualStartPage > startPage) {
    const prevTimeStr = formatTime(previousElapsedTime);
    console.log(`    📂 Resuming from page ${actualStartPage} (${allReviews.length} reviews, ${prevTimeStr} elapsed)`);
  }

  let consecutiveEmptyPages = 0;
  const MAX_EMPTY_PAGES = 3;

  for (let currentPage = actualStartPage; currentPage <= endPage; currentPage++) {
    console.log(`    Page ${currentPage}...`);

    let pageReviews = [];
    let pageSuccess = false;
    let retryCount = 0;

    while (retryCount < CONFIG.MAX_PAGE_RETRIES && !pageSuccess) {
      const pageStartTime = Date.now();

      try {
        pageReviews = await withTimeout(
          extractSinglePageWithFreshBrowser(beachUrl, currentPage),
          CONFIG.PAGE_TIMEOUT,
          `Page ${currentPage} timed out after 2 minutes`
        );

        const pageEndTime = Date.now();

        console.log(`    ✓ ${pageReviews.length} reviews`);
        allReviews = allReviews.concat(pageReviews);

        const currentSessionTime = Date.now() - sessionStartTime;
        const totalElapsedTime = previousElapsedTime + currentSessionTime;

        const pageTimeData = {
          startTime: new Date(pageStartTime).toISOString(),
          endTime: new Date(pageEndTime).toISOString(),
          durationMs: pageEndTime - pageStartTime
        };

        updateBeachPageProgress(beachUrl, currentPage, allReviews, totalElapsedTime, pageTimeData);
        console.log(`    💾 Progress saved (page ${currentPage}, ${allReviews.length} reviews, ${formatTime(totalElapsedTime)} total)`);

        pageSuccess = true;

        if (allReviews.length >= CONFIG.TARGET_REVIEWS) {
          console.log(`    ✅ Reached target of ${CONFIG.TARGET_REVIEWS} reviews (${allReviews.length} collected)`);
          break;
        }

        if (pageReviews.length === 0) {
          consecutiveEmptyPages++;
          console.log(`    ⚠️ No reviews found (${consecutiveEmptyPages}/${MAX_EMPTY_PAGES} empty pages)`);

          if (consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
            console.log(`    ⚠️ ${MAX_EMPTY_PAGES} consecutive pages with no reviews, stopping pagination`);
            break;
          }
        } else {
          consecutiveEmptyPages = 0;
        }

      } catch (error) {
        retryCount++;
        console.log(`    ⚠️ ${error.message} (attempt ${retryCount}/${CONFIG.MAX_PAGE_RETRIES})`);

        if (retryCount < CONFIG.MAX_PAGE_RETRIES) {
          console.log(`    🔄 Retrying page ${currentPage}...`);
          await delay(2000);
        }
      }
    }

    if (!pageSuccess) {
      console.log(`    ⏭️ Skipping page ${currentPage} after ${CONFIG.MAX_PAGE_RETRIES} failed attempts`);
      consecutiveEmptyPages++;

      if (consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
        console.log(`    ⚠️ ${MAX_EMPTY_PAGES} consecutive failures, stopping pagination`);
        break;
      }
      continue;
    }

    if (currentPage < endPage) {
      await randomDelay(CONFIG.DELAY_BETWEEN_PAGES, CONFIG.DELAY_BETWEEN_PAGES + 2000);
    }
  }

  const finalSessionTime = Date.now() - sessionStartTime;
  const totalTime = previousElapsedTime + finalSessionTime;

  console.log(`    ✓ Session complete: ${allReviews.length} reviews extracted in ${formatTime(totalTime)}`);
  return { reviews: allReviews, totalTime };
}

async function processBeachWithFreshBrowser(beach, beachIndex, totalBeaches) {
  console.log(`\n[${beachIndex + 1}/${totalBeaches}] ${beach.name}`);
  console.log(`  📖 Extracting up to ${CONFIG.MAX_REVIEW_PAGES} pages (~${CONFIG.MAX_REVIEW_PAGES * 10} reviews)`);
  console.log(`  🔄 Using fresh browser for EACH page\n`);

  try {
    const result = await extractReviewsWithFreshBrowser(beach.url, 1, CONFIG.MAX_REVIEW_PAGES);
    const { reviews: allReviews, totalTime } = result;
    console.log(`  ✅ Total: ${allReviews.length} reviews extracted in ${formatTime(totalTime)}`);

    clearBeachPageProgress(beach.url);

    return { reviews: allReviews, totalTime };

  } catch (error) {
    console.error(`  ❌ Error processing beach: ${error.message}`);
    return { reviews: [], totalTime: 0 };
  }
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  Beach Review Extractor - TripAdvisor                  ║');
  console.log('║  Analyzing for relaxing, hot, shells, litter, busy... ║');
  console.log('║  (Bright Data Scraping Browser)                        ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  // Load beach list
  if (!fs.existsSync(CONFIG.BEACHES_FILE)) {
    console.error(`❌ Beach list not found: ${CONFIG.BEACHES_FILE}`);
    console.error('   Run beach-scraper.js first to extract beach list!\n');
    process.exit(1);
  }

  const allBeaches = JSON.parse(fs.readFileSync(CONFIG.BEACHES_FILE, 'utf8'));
  console.log(`✓ Loaded ${allBeaches.length} beaches from ${CONFIG.BEACHES_FILE}\n`);

  // Load existing results
  let results = [];
  const progressFile = path.join(CONFIG.RESULTS_DIR, 'beach-reviews-progress.json');
  if (fs.existsSync(progressFile)) {
    try {
      results = JSON.parse(fs.readFileSync(progressFile, 'utf8'));
      console.log(`✓ Loaded ${results.length} existing results\n`);
    } catch (e) {
      console.log(`⚠️ Could not load existing results: ${e.message}\n`);
    }
  }

  // Find incomplete beaches
  let beaches = [];
  for (const beach of allBeaches) {
    const beachProgress = loadBeachProgress(beach.url);
    const hasPartialProgress = beachProgress.lastCompletedPage > 0 && beachProgress.lastCompletedPage < CONFIG.MAX_REVIEW_PAGES;

    const existingResult = results.find(r => r.url === beach.url);
    const reachedTargetReviews = existingResult && existingResult.totalReviews >= CONFIG.TARGET_REVIEWS;
    const isFullyCompleted = existingResult && existingResult.totalReviews > 0 && !hasPartialProgress;

    if (reachedTargetReviews || isFullyCompleted) {
      continue;
    }

    beaches.push(beach);
    if (beaches.length >= CONFIG.MAX_BEACHES) {
      break;
    }
  }

  if (beaches.length === 0) {
    console.log('✅ All beaches have been fully processed!\n');
    process.exit(0);
  }

  console.log(`📋 Found ${beaches.length} incomplete beach(es) to process\n`);

  console.log('📋 Config:');
  console.log(`   Beaches to process: ${beaches.length}`);
  console.log(`   Max Review Pages: ${CONFIG.MAX_REVIEW_PAGES} per beach (~${CONFIG.MAX_REVIEW_PAGES * 10} reviews)`);
  console.log(`   Keywords: ${CONFIG.BEACH_KEYWORDS.slice(0, 10).join(', ')}...`);
  console.log(`   Total beaches in list: ${allBeaches.length}`);
  console.log(`   Completed beaches: ${allBeaches.length - beaches.length}`);

  const startTime = Date.now();
  console.log(`\n📊 Processing ${beaches.length} incomplete beach(es)\n`);
  console.log(`🔄 Each beach gets a fresh browser connection\n`);
  console.log(`⏱️  Started at: ${new Date().toLocaleTimeString()}\n`);

  try {
    for (let i = 0; i < beaches.length; i++) {
      const beach = beaches[i];

      const beachProgress = loadBeachProgress(beach.url);
      const hasPartialProgress = beachProgress.lastCompletedPage > 0;

      if (hasPartialProgress) {
        console.log(`\n[${i + 1}/${beaches.length}] ${beach.name}`);
        console.log(`  📂 Resuming from page ${beachProgress.lastCompletedPage + 1} (${beachProgress.reviews?.length || 0} reviews so far)`);
      }

      const result = await processBeachWithFreshBrowser(beach, i, beaches.length);
      const { reviews, totalTime } = result;

      let totalMentions = 0;
      const keywordBreakdown = {};
      const keywordCategories = {};
      const reviewsWithKeywords = [];

      reviews.forEach(review => {
        const fullText = `${review.title} ${review.text}`;
        const mentions = countKeywordMentions(fullText);

        if (mentions.total > 0) {
          totalMentions += mentions.total;
          reviewsWithKeywords.push({ ...review, keywordMentions: mentions });

          Object.keys(mentions.breakdown).forEach(keyword => {
            keywordBreakdown[keyword] = (keywordBreakdown[keyword] || 0) + mentions.breakdown[keyword];
          });

          Object.keys(mentions.categories).forEach(category => {
            keywordCategories[category] = (keywordCategories[category] || 0) + mentions.categories[category];
          });
        }
      });

      const beachResult = {
        rank: beach.rank,
        name: beach.name,
        url: beach.url,
        location: beach.location || '',
        totalReviews: reviews.length,
        totalTimeMs: totalTime,
        totalTimeFormatted: formatTime(totalTime),
        reviewsWithKeywords: reviewsWithKeywords.length,
        totalKeywordMentions: totalMentions,
        keywordBreakdown: keywordBreakdown,
        keywordCategories: keywordCategories,
        topKeywords: Object.entries(keywordBreakdown)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 20)
          .map(([keyword, count]) => ({ keyword, count })),
        allReviews: reviews
      };

      const existingIndex = results.findIndex(r => r.url === beach.url);
      if (existingIndex >= 0) {
        results[existingIndex] = beachResult;
      } else {
        results.push(beachResult);
      }

      console.log(`  ⏱️  Time: ${formatTime(totalTime)}`);
      console.log(`  🔍 Keywords: ${totalMentions} mentions in ${reviewsWithKeywords.length} reviews`);

      if (Object.keys(keywordCategories).length > 0) {
        console.log(`  📊 Categories:`);
        Object.entries(keywordCategories)
          .sort((a, b) => b[1] - a[1])
          .slice(0, 5)
          .forEach(([cat, count]) => {
            console.log(`      ${cat}: ${count}`);
          });
      }

      saveBeachReviews(beach, reviews, {
        reviewsWithKeywords,
        totalMentions,
        keywordBreakdown,
        keywordCategories
      });

      saveResults(results, 'beach-reviews-progress.json');

      if (i < beaches.length - 1) {
        console.log(`  ⏳ Waiting ${CONFIG.DELAY_BETWEEN_BEACHES / 1000}s...`);
        await randomDelay(CONFIG.DELAY_BETWEEN_BEACHES, CONFIG.DELAY_BETWEEN_BEACHES + 2000);
      }
    }

    const summary = {
      totalBeachesScraped: results.length,
      totalReviewsScraped: results.reduce((sum, b) => sum + b.totalReviews, 0),
      totalKeywordMentions: results.reduce((sum, b) => sum + b.totalKeywordMentions, 0),
      beachesWithKeywords: results.filter(b => b.totalKeywordMentions > 0).length,
      aggregateKeywordBreakdown: {},
      aggregateCategories: {},
      topBeachesByKeywords: results
        .sort((a, b) => b.totalKeywordMentions - a.totalKeywordMentions)
        .slice(0, 10)
        .map(b => ({
          rank: b.rank,
          name: b.name,
          totalMentions: b.totalKeywordMentions,
          topKeywords: b.topKeywords?.slice(0, 5)
        }))
    };

    // Aggregate keywords across all beaches
    results.forEach(beach => {
      if (beach.keywordBreakdown) {
        Object.entries(beach.keywordBreakdown).forEach(([keyword, count]) => {
          summary.aggregateKeywordBreakdown[keyword] = (summary.aggregateKeywordBreakdown[keyword] || 0) + count;
        });
      }
      if (beach.keywordCategories) {
        Object.entries(beach.keywordCategories).forEach(([category, count]) => {
          summary.aggregateCategories[category] = (summary.aggregateCategories[category] || 0) + count;
        });
      }
    });

    saveResults(results, 'beach-reviews-final.json');
    saveResults(summary, 'beach-reviews-summary.json');

    const endTime = Date.now();
    const totalSeconds = Math.floor((endTime - startTime) / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;

    console.log('\n' + '═'.repeat(60));
    console.log('✅ BEACH REVIEW EXTRACTION COMPLETED!');
    console.log('═'.repeat(60));
    console.log(`🏖️  Beaches processed this run: ${beaches.length}`);
    console.log(`📊 Total beaches completed: ${summary.totalBeachesScraped}/${allBeaches.length}`);
    console.log(`📝 Total reviews: ${summary.totalReviewsScraped}`);
    console.log(`🔍 Keyword mentions: ${summary.totalKeywordMentions}`);
    console.log(`🏖️  Beaches with keywords: ${summary.beachesWithKeywords}`);

    if (Object.keys(summary.aggregateCategories).length > 0) {
      console.log('\n📊 Top keyword categories across all beaches:');
      Object.entries(summary.aggregateCategories)
        .sort((a, b) => b[1] - a[1])
        .slice(0, 8)
        .forEach(([cat, count], i) => {
          console.log(`   ${i + 1}. ${cat}: ${count} mentions`);
        });
    }

    if (summary.topBeachesByKeywords.length > 0) {
      console.log('\n🏆 Top 5 beaches by keyword mentions:');
      summary.topBeachesByKeywords.slice(0, 5).forEach((b, i) => {
        console.log(`   ${i + 1}. ${b.name} - ${b.totalMentions} mentions`);
      });
    }

    console.log(`\n⏱️  Execution Time:`);
    console.log(`   Total: ${hours}h ${minutes}m ${seconds}s`);
    console.log(`   Started: ${new Date(startTime).toLocaleTimeString()}`);
    console.log(`   Finished: ${new Date(endTime).toLocaleTimeString()}`);

    console.log(`\n📁 Results saved to:`);
    console.log(`   Combined: ./${CONFIG.RESULTS_DIR}/beach-reviews-final.json`);
    console.log(`   Individual: ./${CONFIG.REVIEWS_DIR}/`);
    console.log(`   Summary: ./${CONFIG.RESULTS_DIR}/beach-reviews-summary.json`);

    const remainingBeaches = allBeaches.length - summary.totalBeachesScraped;
    if (remainingBeaches > 0) {
      console.log(`\n⏳ ${remainingBeaches} beach(es) remaining. Run again to continue.\n`);
    } else {
      console.log(`\n✅ All ${allBeaches.length} beaches have been processed!\n`);
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

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
  MAX_BEACHES: 25,  // Process all beaches in one run
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
  MAX_PAGE_RETRIES: 5,  // More retries to handle timeouts
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

async function dismissCookieConsent(page) {
  try {
    // Try clicking "I Accept" button using Puppeteer's click for real browser events
    // The cookie consent button has id="onetrust-accept-btn-handler" on many sites
    // or text "I Accept" / "Accept All"
    const selectors = [
      '#onetrust-accept-btn-handler',
      'button[id*="accept"]',
      'button[title="I Accept"]',
      'button[title="Accept All"]',
    ];
    for (const sel of selectors) {
      const btn = await page.$(sel);
      if (btn) {
        await page.click(sel);
        console.log(`    🍪 Dismissed cookie consent via: ${sel}`);
        await delay(2000);
        return;
      }
    }
    // Fallback: find by text and mark with attribute for page.click()
    const found = await page.evaluate(() => {
      const buttons = Array.from(document.querySelectorAll('button'));
      for (const btn of buttons) {
        const text = btn.textContent?.trim() || '';
        if (text === 'I Accept' || text === 'Accept All' || text === 'Accept all') {
          btn.setAttribute('data-cookie-accept', 'true');
          return text;
        }
      }
      return null;
    });
    if (found) {
      await page.click('button[data-cookie-accept="true"]');
      console.log(`    🍪 Dismissed cookie consent: ${found}`);
      await delay(2000);
    }
  } catch (e) {
    // No cookie dialog, continue
  }
}

async function dismissInterstitial(page) {
  try {
    const btn = await page.$('[data-automation="interstitialClose"] button');
    if (btn) {
      await page.click('[data-automation="interstitialClose"] button');
      console.log('    ✖️ Dismissed interstitial popup');
      await delay(1500);
    }
  } catch (e) {
    // No interstitial, continue
  }
}

async function setLanguageFilterToAll(page) {
  try {
    // Dismiss cookie consent if present (blocks all other clicks)
    await dismissCookieConsent(page);
    await dismissInterstitial(page);

    // Step 1: Open the Filters modal
    await page.waitForSelector('button[aria-label="Click to open the filter"]', { timeout: 10000 });
    const screenshotDir = './results/beaches/debug-screenshots';
    if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

    await page.screenshot({ path: `${screenshotDir}/01-before-filter-click.png`, fullPage: false });

    // Step 1: Click Filters button
    await page.waitForSelector('button[aria-label="Click to open the filter"]', { timeout: 10000 });
    await page.evaluate(() => {
      const btn = document.querySelector('button[aria-label="Click to open the filter"]');
      const span = btn.querySelector('span.biGQs');
      if (span) span.click();
      else btn.click();
    });
    console.log('    🌐 Opened filters modal');
    await delay(4000);
    await page.screenshot({ path: `${screenshotDir}/02-modal-opened.png`, fullPage: false });

    // Step 2: Scroll to Language and click dropdown
    const hasLangFilter = await page.$('[data-automation="ugcLanguageFilter"] button');
    console.log(`    🔍 Language filter button found: ${!!hasLangFilter}`);

    if (!hasLangFilter) {
      // Dump modal HTML for debugging
      const modalHTML = await page.evaluate(() => {
        const dialog = document.querySelector('[role="dialog"]');
        return dialog ? dialog.innerHTML.substring(0, 2000) : 'NO DIALOG FOUND';
      });
      console.log(`    🔍 Modal HTML: ${modalHTML.substring(0, 500)}`);
      await page.screenshot({ path: `${screenshotDir}/02b-no-lang-filter.png`, fullPage: false });
      return false;
    }

    await page.evaluate(() => {
      const langFilter = document.querySelector('[data-automation="ugcLanguageFilter"] button');
      langFilter.scrollIntoView({ behavior: 'instant', block: 'center' });
    });
    await delay(1000);
    await page.evaluate(() => {
      document.querySelector('[data-automation="ugcLanguageFilter"] button').click();
    });
    console.log('    🌐 Opened language dropdown');
    await delay(3000);
    await page.screenshot({ path: `${screenshotDir}/03-dropdown-opened.png`, fullPage: false });

    // Step 3: Select "All languages" using keyboard navigation
    // The listbox is open with focus. Press Home to go to first item, then Enter to select.
    await page.keyboard.press('Home');
    await delay(300);
    await page.keyboard.press('Enter');
    await delay(500);

    // Verify selection changed
    const selectedLang = await page.evaluate(() => {
      const langBtn = document.querySelector('[data-automation="ugcLanguageFilter"] button');
      return langBtn ? langBtn.textContent?.trim() : 'unknown';
    });
    console.log(`    🌐 Language after selection: ${selectedLang}`);

    if (!selectedLang.includes('All languages')) {
      // Home+Enter didn't work, try ArrowUp repeatedly to reach first item
      console.log('    🔍 Retrying with ArrowUp...');
      // Re-open dropdown
      await page.click('[data-automation="ugcLanguageFilter"] button');
      await delay(1500);
      // Press ArrowUp many times to get to the top
      for (let i = 0; i < 30; i++) {
        await page.keyboard.press('ArrowUp');
        await delay(50);
      }
      await page.keyboard.press('Enter');
      await delay(500);

      const retryLang = await page.evaluate(() => {
        const langBtn = document.querySelector('[data-automation="ugcLanguageFilter"] button');
        return langBtn ? langBtn.textContent?.trim() : 'unknown';
      });
      console.log(`    🌐 Language after retry: ${retryLang}`);
    }

    const allLangClicked = true;
    await delay(1500);
    await page.screenshot({ path: `${screenshotDir}/04-alllang-selected.png`, fullPage: false });

    // Step 4: Click Apply using page.click()
    const applyBtn = await page.$('[data-button-type="primary"] button.rmyCe');
    if (applyBtn) {
      await page.click('[data-button-type="primary"] button.rmyCe');
    } else {
      // Fallback
      await page.click('button.rmyCe');
    }
    console.log('    🌐 Applied language filter');
    await delay(5000);
    await page.screenshot({ path: `${screenshotDir}/05-after-apply.png`, fullPage: false });

    return true;
  } catch (e) {
    console.log(`    ⚠️ Language filter error: ${e.message}`);
    return false;
  }
}

async function extractPageReviews(page) {
  // Debug: Log what we find on the page
  const debugInfo = await page.evaluate(() => {
    return {
      url: window.location.href,
      title: document.title,
      hasReviewCards: document.querySelectorAll('[data-automation="reviewCard"]').length,
      hasProfileLinks: document.querySelectorAll('a[href*="/Profile/"]').length,
      hasSvgs: document.querySelectorAll('svg').length,
      hasH3: document.querySelectorAll('h3').length,
      bodyLength: document.body?.innerHTML?.length || 0,
      sampleText: document.body?.textContent?.substring(0, 500) || ''
    };
  });
  console.log(`    🔍 Debug: URL=${debugInfo.url}`);
  console.log(`    🔍 Debug: reviewCards=${debugInfo.hasReviewCards}, profiles=${debugInfo.hasProfileLinks}, svgs=${debugInfo.hasSvgs}, h3s=${debugInfo.hasH3}`);
  console.log(`    🔍 Debug: bodyLength=${debugInfo.bodyLength}`);

  // Try scrolling to trigger lazy loading
  await page.evaluate(() => window.scrollTo(0, 500));
  await randomDelay(1000, 1500);
  await page.evaluate(() => window.scrollTo(0, 1000));
  await randomDelay(1000, 1500);

  // Extract reviews from current page
  const pageReviews = await page.evaluate(() => {
    const reviews = [];
    const seenTexts = new Set();
    const debug = [];

    // Method 1: Find review cards using data-automation attribute
    let reviewCards = Array.from(document.querySelectorAll('[data-automation="reviewCard"]'));
    debug.push(`Method1: ${reviewCards.length} cards`);

    // Method 2: Try _c class which wraps review cards
    if (reviewCards.length === 0) {
      reviewCards = Array.from(document.querySelectorAll('div._c[data-automation="reviewCard"], div[class*="_c"]')).filter(el => {
        return el.querySelector('a[href*="/Profile/"]') && el.querySelector('svg');
      });
      debug.push(`Method2: ${reviewCards.length} cards`);
    }

    // Method 3: Find by profile links and walk up
    if (reviewCards.length === 0) {
      const profileLinks = document.querySelectorAll('a[href*="/Profile/"]');
      debug.push(`Found ${profileLinks.length} profile links`);
      const cardSet = new Set();
      profileLinks.forEach(link => {
        let parent = link.parentElement;
        for (let i = 0; i < 10 && parent; i++) {
          if (parent.querySelector('h3') && parent.querySelector('svg')) {
            cardSet.add(parent);
            break;
          }
          parent = parent.parentElement;
        }
      });
      reviewCards = Array.from(cardSet);
      debug.push(`Method3: ${reviewCards.length} cards`);
    }

    console.log('DEBUG:', debug.join(', '));

    reviewCards.forEach(card => {
      let title = '';
      const h3 = card.querySelector('h3');
      if (h3) {
        title = h3.textContent?.trim() || '';
      }
      if (!title) {
        const titleLink = card.querySelector('a[href*="ShowUserReviews"]');
        if (titleLink) title = titleLink.textContent?.trim() || '';
      }

      let text = '';
      const allSpans = card.querySelectorAll('span');
      let longestText = '';

      allSpans.forEach(span => {
        const t = span.textContent?.trim() || '';
        if (t.length > longestText.length &&
            t.length > 30 &&
            t.length < 5000 &&
            t !== title &&
            !t.includes('contribution') &&
            !t.includes('Helpful') &&
            !t.includes('Read more') &&
            !t.includes('Tripadvisor LLC') &&
            !t.match(/^\d+$/) &&
            !t.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+\d{4}$/)) {
          longestText = t;
        }
      });
      text = longestText;

      let rating = 0;
      const svg = card.querySelector('svg');
      if (svg) {
        const svgTitle = svg.querySelector('title');
        if (svgTitle) {
          const match = svgTitle.textContent?.match(/(\d+(?:\.\d+)?)\s*of\s*5/i);
          if (match) rating = parseFloat(match[1]);
        }
        if (!rating) {
          const labelId = svg.getAttribute('aria-labelledby');
          if (labelId) {
            const label = document.getElementById(labelId);
            if (label) {
              const match = label.textContent?.match(/(\d+(?:\.\d+)?)\s*of\s*5/i);
              if (match) rating = parseFloat(match[1]);
            }
          }
        }
      }

      let date = '';
      const cardText = card.textContent || '';
      const dateMatch = cardText.match(/Written\s+(\d{1,2}\s+\w+\s+\d{4})/i);
      if (dateMatch) {
        date = dateMatch[1];
      } else {
        const altDateMatch = cardText.match(/((?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\w*\s+\d{4})/i);
        if (altDateMatch) date = altDateMatch[1];
      }

      let reviewer = '';
      const profileLink = card.querySelector('a[href*="/Profile/"]');
      if (profileLink) {
        const spans = profileLink.querySelectorAll('span');
        if (spans.length > 0) {
          reviewer = spans[0].textContent?.trim() || '';
        }
        if (!reviewer) {
          reviewer = profileLink.textContent?.trim() || '';
        }
        reviewer = reviewer.split(/\d+ contribution/)[0].trim();
        reviewer = reviewer.split('\n')[0].trim();
      }

      if (text && text.length > 20) {
        const textKey = text.substring(0, 50).toLowerCase();
        if (!seenTexts.has(textKey)) {
          seenTexts.add(textKey);
          reviews.push({ title, text, rating, date, reviewer });
        }
      }
    });

    return reviews;
  });

  return pageReviews;
}

async function extractReviewsWithSharedBrowser(beachUrl, startPage, maxPages) {
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

  const browserWSEndpoint = `wss://${AUTH}@brd.superproxy.io:9222`;
  let browser;

  try {
    browser = await puppeteer.connect({
      browserWSEndpoint,
      timeout: 15000
    });

    const page = await browser.newPage();
    const client = await page.createCDPSession();

    // Navigate to page 1 first
    const firstPageUrl = buildReviewPageUrl(beachUrl, actualStartPage);
    await page.goto(firstPageUrl, {
      timeout: 60000,
      waitUntil: 'domcontentloaded'
    });

    // Check for CAPTCHA
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

    await randomDelay(3000, 4000);

    // Scroll bottom to top to trigger any lazy popups
    await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
    await delay(1500);
    await page.evaluate(() => window.scrollTo(0, 0));
    await delay(2000);

    // Dismiss popups that block interaction
    await dismissCookieConsent(page);
    await dismissInterstitial(page);

    // Click outside any remaining overlay (click on the page body area)
    await page.mouse.click(100, 100);
    await delay(1000);

    // Dismiss again in case clicking revealed more popups
    await dismissCookieConsent(page);
    await dismissInterstitial(page);

    // Set language filter to "All languages" via modal
    await setLanguageFilterToAll(page);

    let consecutiveEmptyPages = 0;
    const MAX_EMPTY_PAGES = 3;
    let shouldStopPagination = false;

    for (let currentPage = actualStartPage; currentPage <= endPage && !shouldStopPagination; currentPage++) {
      console.log(`    Page ${currentPage}...`);

      let pageReviews = [];
      let pageSuccess = false;
      let retryCount = 0;

      while (retryCount < CONFIG.MAX_PAGE_RETRIES && !pageSuccess) {
        const pageStartTime = Date.now();

        try {
          // Click the "Next page" arrow to go to the next page
          if (currentPage !== actualStartPage || retryCount > 0) {
            // Mark the next arrow then use page.click() for real browser events
            const nextExists = await page.evaluate(() => {
              const nextBtn = document.querySelector('a[data-smoke-attr="pagination-next-arrow"]');
              return !!nextBtn;
            });

            if (!nextExists) {
              console.log('    ⚠️ No "Next page" button found, stopping pagination');
              shouldStopPagination = true;
              break;
            }

            // Click next page and wait for content to load
            await page.click('a[data-smoke-attr="pagination-next-arrow"]');
            // Wait for navigation — catch timeout since it may be SPA-style
            await page.waitForNavigation({ timeout: 10000, waitUntil: 'domcontentloaded' }).catch(() => {});
            await randomDelay(3000, 4000);

            // Check for CAPTCHA
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

            await randomDelay(1000, 2000);
          }

          // Log pagination counter ("Showing results X-Y of Z")
          const paginationInfo = await page.evaluate(() => {
            const el = document.querySelector('div.Ci');
            return el ? el.textContent.trim() : 'pagination not found';
          });
          console.log(`    📄 ${paginationInfo}`);

          pageReviews = await withTimeout(
            extractPageReviews(page),
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
            shouldStopPagination = true;
            break;
          }

          if (pageReviews.length === 0) {
            consecutiveEmptyPages++;
            console.log(`    ⚠️ No reviews found (${consecutiveEmptyPages}/${MAX_EMPTY_PAGES} empty pages)`);

            if (consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
              console.log(`    ⚠️ ${MAX_EMPTY_PAGES} consecutive pages with no reviews, stopping pagination`);
              shouldStopPagination = true;
              break;
            }
          } else {
            consecutiveEmptyPages = 0;
          }

        } catch (error) {
          retryCount++;
          console.log(`    ⚠️ ${error.message} (attempt ${retryCount}/${CONFIG.MAX_PAGE_RETRIES})`);

          if (retryCount < CONFIG.MAX_PAGE_RETRIES) {
            const waitTime = error.message.includes('timeout') ? 5000 : 2000;
            console.log(`    🔄 Retrying page ${currentPage} in ${waitTime/1000}s...`);
            await delay(waitTime);
          }
        }
      }

      if (shouldStopPagination) {
        break;
      }

      if (!pageSuccess) {
        console.log(`    ⏭️ Skipping page ${currentPage} after ${CONFIG.MAX_PAGE_RETRIES} failed attempts`);
        consecutiveEmptyPages++;

        if (consecutiveEmptyPages >= MAX_EMPTY_PAGES) {
          console.log(`    ⚠️ ${MAX_EMPTY_PAGES} consecutive failures, stopping pagination`);
          shouldStopPagination = true;
          break;
        }
        continue;
      }

      if (currentPage < endPage && !shouldStopPagination) {
        await randomDelay(CONFIG.DELAY_BETWEEN_PAGES, CONFIG.DELAY_BETWEEN_PAGES + 2000);
      }
    }

    await browser.close();

  } catch (error) {
    console.error(`    ❌ Browser error: ${error.message}`);
    if (browser) {
      try { await browser.close(); } catch (e) { /* ignore */ }
      await delay(1000);
    }
  }

  const finalSessionTime = Date.now() - sessionStartTime;
  const totalTime = previousElapsedTime + finalSessionTime;

  console.log(`    ✓ Session complete: ${allReviews.length} reviews extracted in ${formatTime(totalTime)}`);
  return { reviews: allReviews, totalTime };
}

async function processBeach(beach, beachIndex, totalBeaches) {
  console.log(`\n[${beachIndex + 1}/${totalBeaches}] ${beach.name}`);
  console.log(`  📖 Extracting up to ${CONFIG.MAX_REVIEW_PAGES} pages (~${CONFIG.MAX_REVIEW_PAGES * 10} reviews)`);
  console.log(`  🔄 Using shared browser session per beach\n`);

  try {
    const result = await extractReviewsWithSharedBrowser(beach.url, 1, CONFIG.MAX_REVIEW_PAGES);
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

  // Find incomplete beaches - skip if review file already exists
  let beaches = [];
  for (const beach of allBeaches) {
    // Check if individual review file already exists (beach-{rank}-{name}.json)
    const sanitizedName = sanitizeFilename(beach.name);
    const reviewFile = path.join(CONFIG.REVIEWS_DIR, `beach-${beach.rank}-${sanitizedName}.json`);
    if (fs.existsSync(reviewFile)) {
      const existingData = JSON.parse(fs.readFileSync(reviewFile, 'utf8'));
      if (existingData.totalReviews > 0) {
        console.log(`  ✓ Skipping #${beach.rank} ${beach.name} (${existingData.totalReviews} reviews already saved)`);
        continue;
      }
    }

    // Also check progress file for partial scrapes
    const beachProgress = loadBeachProgress(beach.url);
    const hasPartialProgress = beachProgress.lastCompletedPage > 0 && beachProgress.lastCompletedPage < CONFIG.MAX_REVIEW_PAGES;

    const existingResult = results.find(r => r.url === beach.url);
    const reachedTargetReviews = existingResult && existingResult.totalReviews >= CONFIG.TARGET_REVIEWS;
    const isFullyCompleted = existingResult && existingResult.totalReviews > 0 && !hasPartialProgress;

    if (reachedTargetReviews || isFullyCompleted) {
      console.log(`  ✓ Skipping #${beach.rank} ${beach.name} (already completed)`);
      continue;
    }

    beaches.push(beach);
    if (beaches.length >= CONFIG.MAX_BEACHES) {
      break;
    }
  }

  // Load all existing review files into results for final/progress/summary rebuild
  console.log('\n📂 Loading existing review files...');
  if (fs.existsSync(CONFIG.REVIEWS_DIR)) {
    const reviewFiles = fs.readdirSync(CONFIG.REVIEWS_DIR).filter(f => f.endsWith('.json'));
    for (const file of reviewFiles) {
      const filepath = path.join(CONFIG.REVIEWS_DIR, file);
      try {
        const data = JSON.parse(fs.readFileSync(filepath, 'utf8'));
        if (data.totalReviews > 0) {
          const existingIndex = results.findIndex(r => r.url === data.url);
          if (existingIndex >= 0) {
            results[existingIndex] = data;
          } else {
            results.push(data);
          }
        }
      } catch (e) {
        console.log(`  ⚠️ Could not load ${file}: ${e.message}`);
      }
    }
    console.log(`  ✓ Loaded ${results.length} existing beach results\n`);
  }

  if (beaches.length === 0) {
    console.log('✅ All beaches already scraped, rebuilding final/progress/summary...\n');
  } else {
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

    for (let i = 0; i < beaches.length; i++) {
      const beach = beaches[i];

      const beachProgress = loadBeachProgress(beach.url);
      const hasPartialProgress = beachProgress.lastCompletedPage > 0;

      if (hasPartialProgress) {
        console.log(`\n[${i + 1}/${beaches.length}] ${beach.name}`);
        console.log(`  📂 Resuming from page ${beachProgress.lastCompletedPage + 1} (${beachProgress.reviews?.length || 0} reviews so far)`);
      }

      const result = await processBeach(beach, i, beaches.length);
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
  }

  try {
    // Always rebuild final/progress/summary from all results
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

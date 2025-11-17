import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

// Use stealth plugin with all evasions
puppeteer.use(StealthPlugin());

const CONFIG = {
  BASE_URL: 'https://www.tripadvisor.co.uk',
  START_URL: 'https://www.tripadvisor.co.uk/Hotels-g45963-a_travelersChoice.1-Las_Vegas_Nevada-Hotels.html',
  MAX_HOTELS: 50,
  CELEBRITY_KEYWORDS: ['celeb spotting', 'celeb sighting', 'celebrities'],
  DELAY_BETWEEN_HOTELS: 5000, // 5 seconds - slower
  DELAY_BETWEEN_PAGES: 3000, // 3 seconds - slower
  HEADLESS: true, // Set to false to see browser and solve CAPTCHAs manually
  RESULTS_DIR: './results'
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Random delay to appear more human
const randomDelay = (min, max) => {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  return delay(ms);
};

// Simulate human-like mouse movements
async function simulateHumanBehavior(page) {
  await randomDelay(500, 1500);

  // Random scroll
  await page.evaluate(() => {
    window.scrollBy({
      top: Math.random() * 300,
      left: 0,
      behavior: 'smooth'
    });
  });

  await randomDelay(300, 800);
}

function saveResults(data, filename) {
  if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
    fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
  }
  const filepath = path.join(CONFIG.RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`✓ Results saved to ${filepath}`);
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
  console.log('Extracting hotel list from main page...');
  console.log('⚠️  If you see a CAPTCHA, please solve it manually in the browser window...\n');

  await page.goto(CONFIG.START_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });

  // Wait for potential CAPTCHA or page load
  await delay(5000);

  // Simulate human behavior
  await simulateHumanBehavior(page);

  // Check if CAPTCHA is present
  const hasCaptcha = await page.evaluate(() => {
    return document.body.textContent.includes('unusual activity') ||
           document.body.textContent.includes('CAPTCHA') ||
           document.querySelector('iframe[title*="CAPTCHA"]') !== null;
  });

  if (hasCaptcha) {
    console.log('⚠️  CAPTCHA detected! Please solve it in the browser window.');
    console.log('⏳ Waiting 60 seconds for you to solve it...\n');
    await delay(60000);
  }

  // Wait for page to fully load
  await page.waitForFunction(
    () => document.readyState === 'complete',
    { timeout: 30000 }
  );

  await randomDelay(2000, 4000);

  // Try multiple selectors
  const selectors = [
    'a[href*="/Hotel_Review-"]',
    'a[href*="Hotel"]',
    '[data-automation="hotel-card"]',
    '.listing',
    'div[class*="card"]'
  ];

  let loaded = false;
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 10000 });
      console.log(`✓ Found hotels using selector: ${selector}`);
      loaded = true;
      break;
    } catch (e) {
      console.log(`  Selector ${selector} not found, trying next...`);
    }
  }

  if (!loaded) {
    // Take screenshot for debugging
    await page.screenshot({ path: './results/error-screenshot.png' });
    const html = await page.content();
    fs.writeFileSync('./results/error-page.html', html);
    throw new Error('Could not find hotel listings. Screenshot saved to ./results/error-screenshot.png');
  }

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
        const titleEl = link.querySelector('[class*="title"]') ||
                       link.querySelector('div') ||
                       link.querySelector('span');
        if (titleEl) {
          name = titleEl.textContent?.trim();
        }
      }

      if (name && name.length > 2 && url.includes('/Hotel_Review-')) {
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

  console.log(`✓ Found ${hotels.length} hotels\n`);
  return hotels;
}

async function extractHotelReviews(page, hotelUrl, hotelName) {
  console.log(`Scraping reviews for: ${hotelName}`);

  try {
    await page.goto(hotelUrl, {
      waitUntil: 'domcontentloaded',
      timeout: 90000
    });

    await randomDelay(3000, 5000);
    await simulateHumanBehavior(page);

    let allReviews = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages && currentPage <= 20) {
      console.log(`  Page ${currentPage}...`);

      try {
        // Wait for reviews with multiple selectors
        let reviewsLoaded = false;
        const reviewSelectors = [
          '[data-automation="reviewCard"]',
          '[data-test="review"]',
          'div[data-reviewid]',
          'div[class*="review"]'
        ];

        for (const selector of reviewSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 8000 });
            reviewsLoaded = true;
            break;
          } catch (e) {
            // Try next
          }
        }

        if (!reviewsLoaded) {
          console.log('    No reviews found');
          break;
        }

        await randomDelay(1000, 2000);

        const pageReviews = await page.evaluate(() => {
          let reviewCards = document.querySelectorAll('[data-automation="reviewCard"]');

          if (reviewCards.length === 0) {
            reviewCards = document.querySelectorAll('[data-test="review"], div[data-reviewid]');
          }

          if (reviewCards.length === 0) {
            reviewCards = Array.from(document.querySelectorAll('div')).filter(div => {
              const text = div.textContent || '';
              return text.length > 100 && text.length < 5000 &&
                     (div.className.includes('review') || div.getAttribute('data-reviewid'));
            });
          }

          const reviews = [];

          reviewCards.forEach(card => {
            let title = '';
            const titleSelectors = ['[data-automation="reviewTitle"]', '[class*="title"]', 'div[class*="Title"]'];
            for (const sel of titleSelectors) {
              const el = card.querySelector(sel);
              if (el && el.textContent.trim()) {
                title = el.textContent.trim();
                break;
              }
            }

            let text = '';
            const textSelectors = ['[data-automation="reviewText"]', '[class*="review-text"]', '[class*="reviewText"]'];
            for (const sel of textSelectors) {
              const el = card.querySelector(sel);
              if (el && el.textContent.trim().length > 50) {
                text = el.textContent.trim();
                break;
              }
            }

            if (!text && card.textContent && card.textContent.trim().length > 100) {
              text = card.textContent.trim();
            }

            const ratingElement = card.querySelector('[class*="bubble"], [class*="rating"]');
            let rating = 0;
            if (ratingElement) {
              const match = ratingElement.className.match(/bubble[_-]?(\d+)|rating[_-]?(\d+)/i);
              if (match) rating = parseInt(match[1] || match[2]) / 10;
            }

            let date = '';
            const dateSelectors = ['[data-automation="review-date"]', '[class*="date"]', 'time'];
            for (const sel of dateSelectors) {
              const el = card.querySelector(sel);
              if (el && el.textContent.trim()) {
                date = el.textContent.trim();
                break;
              }
            }

            let reviewer = '';
            const nameSelectors = ['[class*="reviewer-name"]', '[class*="username"]', '[class*="author"]'];
            for (const sel of nameSelectors) {
              const el = card.querySelector(sel);
              if (el && el.textContent.trim()) {
                reviewer = el.textContent.trim();
                break;
              }
            }

            if (text && text.length > 20) {
              reviews.push({ title, text, rating, date, reviewer });
            }
          });

          return reviews;
        });

        console.log(`    Found ${pageReviews.length} reviews`);
        allReviews = allReviews.concat(pageReviews);

        // Check for next page
        await simulateHumanBehavior(page);

        const nextButton = await page.$('[data-automation="pagination-next"], a.next, a[aria-label*="Next"]');

        if (nextButton) {
          const isDisabled = await page.evaluate(btn => {
            return btn.disabled ||
                   btn.classList.contains('disabled') ||
                   btn.getAttribute('aria-disabled') === 'true';
          }, nextButton);

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
        console.log(`    Error: ${error.message}`);
        hasMorePages = false;
      }
    }

    console.log(`  ✓ Total: ${allReviews.length} reviews\n`);
    return allReviews;

  } catch (error) {
    console.error(`  ✗ Error: ${error.message}\n`);
    return [];
  }
}

async function scrapeTripadvisor() {
  console.log('🚀 Starting TripAdvisor Celebrity Mentions Scraper');
  console.log('📋 Configuration:');
  console.log(`   - Max hotels: ${CONFIG.MAX_HOTELS}`);
  console.log(`   - Keywords: ${CONFIG.CELEBRITY_KEYWORDS.join(', ')}`);
  console.log(`   - Headless: ${CONFIG.HEADLESS}`);
  console.log('\n⚠️  IMPORTANT: If you see a CAPTCHA, solve it manually in the browser!\n');
  console.log('=' .repeat(60) + '\n');

  let browser;
  try {
    browser = await puppeteer.launch({
      headless: CONFIG.HEADLESS,
      args: [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-dev-shm-usage',
        '--disable-blink-features=AutomationControlled',
        '--disable-features=IsolateOrigins,site-per-process',
        '--window-size=1920,1080'
      ],
      defaultViewport: {
        width: 1920,
        height: 1080
      },
      ignoreHTTPSErrors: true
    });

    console.log('✓ Browser launched\n');

    const page = await browser.newPage();

    // Enhanced stealth
    await page.evaluateOnNewDocument(() => {
      // Remove webdriver property
      Object.defineProperty(navigator, 'webdriver', { get: () => undefined });

      // Mock plugins
      Object.defineProperty(navigator, 'plugins', {
        get: () => [1, 2, 3, 4, 5]
      });

      // Mock languages
      Object.defineProperty(navigator, 'languages', {
        get: () => ['en-US', 'en']
      });
    });

    // Set realistic user agent
    await page.setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36'
    );

    // Set extra headers
    await page.setExtraHTTPHeaders({
      'Accept-Language': 'en-US,en;q=0.9',
      'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/webp,*/*;q=0.8',
      'Accept-Encoding': 'gzip, deflate, br',
      'DNT': '1',
      'Connection': 'keep-alive',
      'Upgrade-Insecure-Requests': '1'
    });

    // Extract hotel list
    const hotels = await extractHotelList(page);

    if (hotels.length === 0) {
      console.error('❌ No hotels found. Please check if CAPTCHA was solved.\n');
      await page.screenshot({ path: './results/no-hotels-screenshot.png' });
      await browser.close();
      return;
    }

    saveResults(hotels, 'hotels-list.json');

    // Scrape reviews
    const results = [];

    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];
      console.log(`[${i + 1}/${hotels.length}] ${hotel.name}`);

      const reviews = await extractHotelReviews(page, hotel.url, hotel.name);

      let totalMentions = 0;
      const mentionBreakdown = {};
      const reviewsWithMentions = [];

      reviews.forEach(review => {
        const fullText = `${review.title} ${review.text}`;
        const mentions = countCelebrityMentions(fullText);

        if (mentions.total > 0) {
          totalMentions += mentions.total;
          reviewsWithMentions.push({
            ...review,
            celebrityMentions: mentions
          });

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

      console.log(`  📊 Celebrity mentions: ${totalMentions} in ${reviewsWithMentions.length} reviews`);
      if (Object.keys(mentionBreakdown).length > 0) {
        console.log(`  📈 Breakdown:`, mentionBreakdown);
      }
      console.log('');

      saveResults(results, 'scraping-progress.json');

      if (i < hotels.length - 1) {
        console.log(`  ⏳ Waiting ${CONFIG.DELAY_BETWEEN_HOTELS / 1000}s...\n`);
        await randomDelay(CONFIG.DELAY_BETWEEN_HOTELS, CONFIG.DELAY_BETWEEN_HOTELS + 2000);
      }
    }

    // Summary
    const summary = {
      totalHotelsScraped: results.length,
      totalReviewsScraped: results.reduce((sum, h) => sum + h.totalReviews, 0),
      totalCelebrityMentions: results.reduce((sum, h) => sum + h.totalCelebrityMentions, 0),
      hotelsWithMentions: results.filter(h => h.totalCelebrityMentions > 0).length,
      topHotelsByMentions: results
        .sort((a, b) => b.totalCelebrityMentions - a.totalCelebrityMentions)
        .slice(0, 10)
        .map(h => ({
          rank: h.rank,
          name: h.name,
          mentions: h.totalCelebrityMentions,
          breakdown: h.mentionBreakdown
        }))
    };

    saveResults(results, 'final-results.json');
    saveResults(summary, 'summary-report.json');

    console.log('=' .repeat(60));
    console.log('✅ SCRAPING COMPLETED!');
    console.log('=' .repeat(60));
    console.log(`📊 Total hotels: ${summary.totalHotelsScraped}`);
    console.log(`📝 Total reviews: ${summary.totalReviewsScraped}`);
    console.log(`⭐ Celebrity mentions: ${summary.totalCelebrityMentions}`);
    console.log(`🏨 Hotels with mentions: ${summary.hotelsWithMentions}`);
    console.log('\n🏆 Top 5 hotels by celebrity mentions:');
    summary.topHotelsByMentions.slice(0, 5).forEach((hotel, idx) => {
      console.log(`   ${idx + 1}. ${hotel.name} - ${hotel.mentions} mentions`);
    });
    console.log(`\n📁 Results saved to ./${CONFIG.RESULTS_DIR}/`);

  } catch (error) {
    console.error('❌ Fatal error:', error);
    if (browser) {
      const page = (await browser.pages())[0];
      if (page) {
        await page.screenshot({ path: './results/fatal-error-screenshot.png' });
      }
    }
  } finally {
    if (browser) {
      console.log('\nClosing browser in 5 seconds...');
      await delay(5000);
      await browser.close();
    }
  }
}

scrapeTripadvisor().catch(console.error);

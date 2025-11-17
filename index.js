import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

// Add stealth plugin to avoid detection
puppeteer.use(StealthPlugin());

const CONFIG = {
  BASE_URL: 'https://www.tripadvisor.co.uk',
  START_URL: 'https://www.tripadvisor.co.uk/Hotels-g45963-a_travelersChoice.1-Las_Vegas_Nevada-Hotels.html',
  MAX_HOTELS: 50,
  CELEBRITY_KEYWORDS: ['celeb spotting', 'celeb sighting', 'celebrities'],
  DELAY_BETWEEN_HOTELS: 3000, // 3 seconds
  DELAY_BETWEEN_PAGES: 2000, // 2 seconds
  HEADLESS: true, // Use 'new' for new headless mode, false to see browser, true for old headless
  RESULTS_DIR: './results'
};

// Utility function to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Utility function to save results
function saveResults(data, filename) {
  if (!fs.existsSync(CONFIG.RESULTS_DIR)) {
    fs.mkdirSync(CONFIG.RESULTS_DIR, { recursive: true });
  }
  const filepath = path.join(CONFIG.RESULTS_DIR, filename);
  fs.writeFileSync(filepath, JSON.stringify(data, null, 2));
  console.log(`✓ Results saved to ${filepath}`);
}

// Extract hotel list from main page
async function extractHotelList(page) {
  console.log('Extracting hotel list from main page...');

  await page.goto(CONFIG.START_URL, {
    waitUntil: 'networkidle2',
    timeout: 60000
  });

  // Wait for page to load - try multiple selectors
  const selectors = [
    'a[href*="/Hotel_Review"]',
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
    throw new Error('Could not find hotel listings on page');
  }

  const hotels = await page.evaluate((maxHotels) => {
    // Try to find hotel links - TripAdvisor uses /Hotel_Review- in URLs
    const hotelLinks = document.querySelectorAll('a[href*="/Hotel_Review-"]');
    const hotelList = [];
    const seen = new Set();

    for (const link of hotelLinks) {
      if (hotelList.length >= maxHotels) break;

      const url = link.href;
      // Avoid duplicates
      if (seen.has(url)) continue;

      // Try to get hotel name from link text or nearby elements
      let name = link.textContent?.trim();

      // If link text is empty or too short, try to find a better name
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

  console.log(`✓ Found ${hotels.length} hotels`);
  return hotels;
}

// Count celebrity mentions in text
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

// Extract all reviews from a hotel page
async function extractHotelReviews(page, hotelUrl, hotelName) {
  console.log(`\nScraping reviews for: ${hotelName}`);

  try {
    await page.goto(hotelUrl, {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    await delay(2000);

    // Click on "All reviews" or reviews tab if available
    try {
      const reviewsTabSelector = '[data-automation="tab-link-reviews"], a[href*="Reviews"]';
      const reviewsTab = await page.$(reviewsTabSelector);

      if (reviewsTab) {
        await reviewsTab.click();
        await delay(2000);
      }
    } catch (e) {
      console.log('Reviews tab not found or already on reviews page');
    }

    let allReviews = [];
    let currentPage = 1;
    let hasMorePages = true;

    while (hasMorePages && currentPage <= 20) { // Limit to 20 pages per hotel
      console.log(`  Extracting page ${currentPage}...`);

      try {
        // Wait for reviews to load - try multiple selectors
        let reviewsLoaded = false;
        const reviewSelectors = [
          '[data-automation="reviewCard"]',
          '[data-test="review"]',
          'div[data-reviewid]',
          '[class*="review"]'
        ];

        for (const selector of reviewSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 5000 });
            reviewsLoaded = true;
            break;
          } catch (e) {
            // Try next selector
          }
        }

        if (!reviewsLoaded) {
          console.log('    No reviews found on this page');
          hasMorePages = false;
          break;
        }

        // Extract reviews from current page
        const pageReviews = await page.evaluate(() => {
          // Try to find review containers with various selectors
          let reviewCards = document.querySelectorAll('[data-automation="reviewCard"]');

          if (reviewCards.length === 0) {
            reviewCards = document.querySelectorAll('[data-test="review"], div[data-reviewid]');
          }

          if (reviewCards.length === 0) {
            // Last resort: find divs that look like reviews
            reviewCards = Array.from(document.querySelectorAll('div')).filter(div => {
              const text = div.textContent || '';
              return text.length > 100 && text.length < 5000 &&
                     (div.className.includes('review') || div.getAttribute('data-reviewid'));
            });
          }

          const reviews = [];

          reviewCards.forEach(card => {
            // Get review title - try multiple selectors
            let title = '';
            const titleSelectors = [
              '[data-automation="reviewTitle"]',
              '[class*="title"]',
              'div[class*="Title"]',
              'span[class*="title"]'
            ];

            for (const selector of titleSelectors) {
              const el = card.querySelector(selector);
              if (el && el.textContent.trim()) {
                title = el.textContent.trim();
                break;
              }
            }

            // Get review text - try multiple selectors
            let text = '';
            const textSelectors = [
              '[data-automation="reviewText"]',
              '[class*="review-text"]',
              '[class*="reviewText"]',
              'div[class*="Text"]',
              'span[class*="text"]'
            ];

            for (const selector of textSelectors) {
              const el = card.querySelector(selector);
              if (el && el.textContent.trim().length > 50) {
                text = el.textContent.trim();
                break;
              }
            }

            // If still no text, get all text from card (last resort)
            if (!text && card.textContent) {
              const cardText = card.textContent.trim();
              if (cardText.length > 100) {
                text = cardText;
              }
            }

            // Get rating
            const ratingElement = card.querySelector('[class*="bubble"], [class*="rating"], [class*="Rating"]');
            let rating = 0;
            if (ratingElement) {
              const ratingClass = ratingElement.className;
              const match = ratingClass.match(/bubble[_-]?(\d+)|rating[_-]?(\d+)/i);
              if (match) {
                rating = parseInt(match[1] || match[2]) / 10;
              }
            }

            // Get date
            let date = '';
            const dateSelectors = [
              '[data-automation="review-date"]',
              '[class*="date"]',
              'time',
              '[datetime]'
            ];

            for (const selector of dateSelectors) {
              const el = card.querySelector(selector);
              if (el && el.textContent.trim()) {
                date = el.textContent.trim();
                break;
              }
            }

            // Get reviewer name
            let reviewer = '';
            const nameSelectors = [
              '[class*="reviewer-name"]',
              '[class*="username"]',
              '[class*="userName"]',
              '[class*="author"]'
            ];

            for (const selector of nameSelectors) {
              const el = card.querySelector(selector);
              if (el && el.textContent.trim()) {
                reviewer = el.textContent.trim();
                break;
              }
            }

            if (text && text.length > 20) {
              reviews.push({
                title,
                text,
                rating,
                date,
                reviewer
              });
            }
          });

          return reviews;
        });

        console.log(`    Found ${pageReviews.length} reviews on page ${currentPage}`);
        allReviews = allReviews.concat(pageReviews);

        // Try to find and click "Next" button
        const nextButton = await page.$('[data-automation="pagination-next"], a.next');

        if (nextButton) {
          const isDisabled = await page.evaluate(btn => {
            return btn.disabled ||
                   btn.classList.contains('disabled') ||
                   btn.getAttribute('aria-disabled') === 'true';
          }, nextButton);

          if (!isDisabled) {
            await nextButton.click();
            await delay(CONFIG.DELAY_BETWEEN_PAGES);
            currentPage++;
          } else {
            hasMorePages = false;
          }
        } else {
          hasMorePages = false;
        }

      } catch (error) {
        console.log(`    Error on page ${currentPage}: ${error.message}`);
        hasMorePages = false;
      }
    }

    console.log(`  ✓ Total reviews extracted: ${allReviews.length}`);
    return allReviews;

  } catch (error) {
    console.error(`  ✗ Error scraping ${hotelName}: ${error.message}`);
    return [];
  }
}

// Main scraper function
async function scrapeTripadvisor() {
  console.log('Starting TripAdvisor Celebrity Mentions Scraper...\n');

  let browser;
  try {
    browser = await puppeteer.launch({
    headless: CONFIG.HEADLESS,
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
      '--disable-accelerated-2d-canvas',
      '--disable-gpu',
      '--window-size=1920x1080',
      '--disable-blink-features=AutomationControlled'
    ],
    protocolTimeout: 240000,
    ignoreHTTPSErrors: true,
    dumpio: false,
    timeout: 60000
  });

    console.log('✓ Browser launched successfully');
  } catch (launchError) {
    console.error('Failed to launch browser:', launchError.message);
    console.error('Try running with HEADLESS: true or check if Chrome is installed');
    return;
  }

  try {
    const page = await browser.newPage();
    await page.setViewport({ width: 1920, height: 1080 });

    // Set user agent to avoid detection
    await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36');

    // Extract hotel list
    const hotels = await extractHotelList(page);

    if (hotels.length === 0) {
      console.error('No hotels found. Exiting...');
      await browser.close();
      return;
    }

    // Save hotel list
    saveResults(hotels, 'hotels-list.json');

    // Scrape reviews for each hotel
    const results = [];

    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];
      console.log(`\n[${i + 1}/${hotels.length}] Processing: ${hotel.name}`);

      const reviews = await extractHotelReviews(page, hotel.url, hotel.name);

      // Analyze celebrity mentions
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

          // Aggregate breakdown
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

      console.log(`  Celebrity mentions found: ${totalMentions} across ${reviewsWithMentions.length} reviews`);
      if (Object.keys(mentionBreakdown).length > 0) {
        console.log(`  Breakdown:`, mentionBreakdown);
      }

      // Save progress after each hotel
      saveResults(results, 'scraping-progress.json');

      // Delay between hotels to avoid rate limiting
      if (i < hotels.length - 1) {
        console.log(`  Waiting ${CONFIG.DELAY_BETWEEN_HOTELS / 1000}s before next hotel...`);
        await delay(CONFIG.DELAY_BETWEEN_HOTELS);
      }
    }

    // Generate summary report
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

    // Save final results
    saveResults(results, 'final-results.json');
    saveResults(summary, 'summary-report.json');

    console.log('\n========================================');
    console.log('SCRAPING COMPLETED!');
    console.log('========================================');
    console.log(`Total hotels scraped: ${summary.totalHotelsScraped}`);
    console.log(`Total reviews scraped: ${summary.totalReviewsScraped}`);
    console.log(`Total celebrity mentions: ${summary.totalCelebrityMentions}`);
    console.log(`Hotels with mentions: ${summary.hotelsWithMentions}`);
    console.log('\nTop 5 hotels by celebrity mentions:');
    summary.topHotelsByMentions.slice(0, 5).forEach((hotel, idx) => {
      console.log(`  ${idx + 1}. ${hotel.name} - ${hotel.mentions} mentions`);
    });
    console.log('\nResults saved to ./results/ directory');

  } catch (error) {
    console.error('Fatal error:', error);
  } finally {
    if (browser) {
      await browser.close();
    }
  }
}

// Run the scraper
scrapeTripadvisor().catch(console.error);

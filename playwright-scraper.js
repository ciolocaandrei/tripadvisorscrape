import { chromium } from 'playwright';
import fs from 'fs';
import path from 'path';

const CONFIG = {
  START_URL: 'https://www.tripadvisor.co.uk/Hotels-g45963-a_travelersChoice.1-Las_Vegas_Nevada-Hotels.html',
  MAX_HOTELS: 50,
  CELEBRITY_KEYWORDS: ['celeb spotting', 'celeb sighting', 'celebrities'],
  DELAY_BETWEEN_HOTELS: 5000,
  DELAY_BETWEEN_PAGES: 3000,
  RESULTS_DIR: './results',
  HEADLESS: false, // Set to false to see browser and solve CAPTCHA manually
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const randomDelay = (min, max) => {
  const ms = Math.floor(Math.random() * (max - min + 1) + min);
  return delay(ms);
};

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

async function waitForCaptchaSolution(page) {
  console.log('\n⚠️  CAPTCHA DETECTED!');
  console.log('🔍 Checking page content...');

  const bodyText = await page.textContent('body');

  if (bodyText.includes('unusual activity') || bodyText.includes('CAPTCHA')) {
    console.log('❗ Please solve the CAPTCHA in the browser window that should be open.');
    console.log('⏳ Waiting up to 2 minutes for you to solve it...\n');

    // Wait for CAPTCHA to be solved - check every 5 seconds for up to 2 minutes
    for (let i = 0; i < 24; i++) {
      await delay(5000);

      try {
        const currentBodyText = await page.textContent('body');
        const hasLinks = await page.evaluate(() => {
          return document.querySelectorAll('a[href*="Hotel"]').length > 0;
        });

        if (!currentBodyText.includes('unusual activity') && hasLinks) {
          console.log('✅ CAPTCHA appears to be solved! Continuing...\n');
          await delay(3000);
          return true;
        }

        if (i % 3 === 0) {
          console.log(`   Still waiting... (${(i + 1) * 5} seconds elapsed)`);
        }
      } catch (e) {
        // Continue waiting
      }
    }

    console.log('⏱️  Timeout waiting for CAPTCHA. Taking screenshot for debugging...');
    await page.screenshot({ path: './results/captcha-timeout.png' });
    return false;
  }

  return true;
}

async function extractHotelList(page) {
  console.log('📍 Navigating to TripAdvisor...');

  await page.goto(CONFIG.START_URL, {
    waitUntil: 'domcontentloaded',
    timeout: 90000
  });

  await delay(3000);

  // Check for CAPTCHA
  const captchaSolved = await waitForCaptchaSolution(page);
  if (!captchaSolved) {
    throw new Error('CAPTCHA not solved in time');
  }

  console.log('🔍 Looking for hotels...');

  // Wait for content to load
  await randomDelay(2000, 4000);

  // Try multiple selectors
  const selectors = [
    'a[href*="/Hotel_Review-"]',
    'a[href*="Hotel"]',
    '[class*="hotel"]'
  ];

  let foundSelector = null;
  for (const selector of selectors) {
    try {
      await page.waitForSelector(selector, { timeout: 10000 });
      foundSelector = selector;
      console.log(`✓ Found hotels using: ${selector}`);
      break;
    } catch (e) {
      console.log(`  ${selector} - not found`);
    }
  }

  if (!foundSelector) {
    await page.screenshot({ path: './results/no-hotels-found.png' });
    throw new Error('Could not find hotels. Screenshot saved.');
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
        const titleEl = link.querySelector('[class*="title"], div, span');
        if (titleEl) name = titleEl.textContent?.trim();
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

  console.log(`✅ Found ${hotels.length} hotels\n`);
  return hotels;
}

async function extractHotelReviews(page, hotelUrl, hotelName) {
  console.log(`\n📖 Scraping: ${hotelName}`);

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
      console.log(`  📄 Page ${currentPage}...`);

      try {
        // Wait for reviews
        let reviewsFound = false;
        const reviewSelectors = [
          '[data-automation="reviewCard"]',
          '[class*="review"]',
          'div[data-reviewid]'
        ];

        for (const selector of reviewSelectors) {
          try {
            await page.waitForSelector(selector, { timeout: 8000 });
            reviewsFound = true;
            break;
          } catch (e) {
            // Try next
          }
        }

        if (!reviewsFound) {
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
              return text.length > 100 && text.length < 5000;
            });
          }

          const reviews = [];

          reviewCards.forEach(card => {
            let title = '';
            const titleSelectors = ['[data-automation="reviewTitle"]', '[class*="title"]'];
            for (const sel of titleSelectors) {
              const el = card.querySelector(sel);
              if (el?.textContent?.trim()) {
                title = el.textContent.trim();
                break;
              }
            }

            let text = '';
            const textSelectors = ['[data-automation="reviewText"]', '[class*="review-text"]'];
            for (const sel of textSelectors) {
              const el = card.querySelector(sel);
              if (el?.textContent?.trim().length > 50) {
                text = el.textContent.trim();
                break;
              }
            }

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
            const dateSelectors = ['[data-automation="review-date"]', '[class*="date"]', 'time'];
            for (const sel of dateSelectors) {
              const el = card.querySelector(sel);
              if (el?.textContent?.trim()) {
                date = el.textContent.trim();
                break;
              }
            }

            let reviewer = '';
            const nameSelectors = ['[class*="reviewer-name"]', '[class*="username"]'];
            for (const sel of nameSelectors) {
              const el = card.querySelector(sel);
              if (el?.textContent?.trim()) {
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

        console.log(`    ✓ ${pageReviews.length} reviews`);
        allReviews = allReviews.concat(pageReviews);

        // Check for next page
        const nextButton = await page.$('[data-automation="pagination-next"], a.next, a[aria-label*="Next"]');

        if (nextButton) {
          const isDisabled = await nextButton.evaluate(btn => {
            return btn.disabled || btn.classList.contains('disabled') || btn.getAttribute('aria-disabled') === 'true';
          });

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
        console.log(`    ⚠️  Error: ${error.message}`);
        hasMorePages = false;
      }
    }

    console.log(`  ✅ Total: ${allReviews.length} reviews`);
    return allReviews;

  } catch (error) {
    console.error(`  ❌ Error: ${error.message}`);
    return [];
  }
}

async function main() {
  console.log('🚀 TripAdvisor Celebrity Mentions Scraper (Playwright)');
  console.log('=' .repeat(60));
  console.log(`📊 Config: ${CONFIG.MAX_HOTELS} hotels, Keywords: ${CONFIG.CELEBRITY_KEYWORDS.join(', ')}`);
  console.log(`🖥️  Headless: ${CONFIG.HEADLESS}`);
  console.log('=' .repeat(60) + '\n');

  const browser = await chromium.launch({
    headless: CONFIG.HEADLESS,
    args: ['--disable-blink-features=AutomationControlled']
  });

  const context = await browser.newContext({
    viewport: { width: 1920, height: 1080 },
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/121.0.0.0 Safari/537.36',
    locale: 'en-US',
    timezoneId: 'America/New_York',
  });

  const page = await context.newPage();

  try {
    const hotels = await extractHotelList(page);

    if (hotels.length === 0) {
      console.error('❌ No hotels found');
      await page.screenshot({ path: './results/error.png' });
      await browser.close();
      return;
    }

    saveResults(hotels, 'hotels-list.json');

    const results = [];

    for (let i = 0; i < hotels.length; i++) {
      const hotel = hotels[i];
      console.log(`\n[${ i + 1}/${hotels.length}] ${hotel.name}`);

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

      console.log(`  ⭐ Celebrity mentions: ${totalMentions} in ${reviewsWithMentions.length} reviews`);
      if (Object.keys(mentionBreakdown).length > 0) {
        console.log(`  📊 Breakdown:`, mentionBreakdown);
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

    console.log('\n' + '=' .repeat(60));
    console.log('✅ SCRAPING COMPLETED!');
    console.log('=' .repeat(60));
    console.log(`📊 Hotels scraped: ${summary.totalHotelsScraped}`);
    console.log(`📝 Reviews scraped: ${summary.totalReviewsScraped}`);
    console.log(`⭐ Celebrity mentions: ${summary.totalCelebrityMentions}`);
    console.log(`🏨 Hotels with mentions: ${summary.hotelsWithMentions}`);
    console.log('\n🏆 Top 5 by mentions:');
    summary.topHotelsByMentions.slice(0, 5).forEach((h, i) => {
      console.log(`   ${i + 1}. ${h.name} - ${h.mentions} mentions`);
    });
    console.log(`\n📁 Results: ./${CONFIG.RESULTS_DIR}/\n`);

  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    await page.screenshot({ path: './results/fatal-error.png' });
  } finally {
    await browser.close();
  }
}

main().catch(console.error);

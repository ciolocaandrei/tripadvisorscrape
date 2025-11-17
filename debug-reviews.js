/**
 * Debug script to inspect actual TripAdvisor review page structure
 */

import puppeteer from 'puppeteer-core';
import fs from 'fs';

const AUTH = 'brd-customer-hl_94d90749-zone-scraping_browser:7923gx0w4vyy';

async function main() {
  console.log('🔍 Debugging TripAdvisor review page structure...\n');

  const browserWSEndpoint = `wss://${AUTH}@brd.superproxy.io:9222`;

  const browser = await puppeteer.connect({
    browserWSEndpoint,
    timeout: 60000
  });

  console.log('✓ Connected to Scraping Browser\n');

  const page = await browser.newPage();
  const client = await page.createCDPSession();

  // Use first hotel from the list
  const hotels = JSON.parse(fs.readFileSync('./results/hotels-list.json', 'utf8'));
  const testHotel = hotels[0];

  console.log(`Testing with: ${testHotel.name}`);
  console.log(`URL: ${testHotel.url}\n`);

  await page.goto(testHotel.url, {
    timeout: 120000,
    waitUntil: 'domcontentloaded'
  });

  // Wait for CAPTCHA
  try {
    const { status } = await client.send('Captcha.waitForSolve', {
      detectTimeout: 10000,
    });
    console.log(`CAPTCHA status: ${status}\n`);
  } catch (e) {
    console.log('No CAPTCHA\n');
  }

  await new Promise(resolve => setTimeout(resolve, 5000));

  // Take screenshot
  await page.screenshot({ path: './results/debug-page.png', fullPage: true });
  console.log('✓ Screenshot saved to: ./results/debug-page.png\n');

  // Get HTML snapshot
  const html = await page.content();
  fs.writeFileSync('./results/debug-page.html', html);
  console.log('✓ HTML saved to: ./results/debug-page.html\n');

  // Test all possible selectors
  const debug = await page.evaluate(() => {
    const results = {
      selectors: {},
      sampleHTML: {},
      counts: {}
    };

    // Test each selector
    const selectorsToTest = [
      '[data-automation="reviewCard"]',
      'div[data-test-target="review-card"]',
      'div[data-reviewid]',
      'div[class*="review"][class*="card"]',
      'div[class*="Review"]',
      '[data-test="review"]',
      'article',
      'div[data-test-target="HR_CC_CARD"]',
      '.review-container',
      '.reviewSelector'
    ];

    selectorsToTest.forEach(selector => {
      const elements = document.querySelectorAll(selector);
      results.counts[selector] = elements.length;

      if (elements.length > 0) {
        // Get first element's HTML (truncated)
        const firstEl = elements[0];
        results.sampleHTML[selector] = firstEl.outerHTML.substring(0, 500);

        // Try to extract review data
        results.selectors[selector] = {
          count: elements.length,
          sample: {
            hasTitle: !!firstEl.querySelector('[data-automation="reviewTitle"]'),
            hasText: !!firstEl.querySelector('[data-automation="reviewText"]'),
            hasRating: !!firstEl.querySelector('[class*="bubble"]'),
            classNames: firstEl.className,
            textLength: firstEl.textContent?.length || 0
          }
        };
      }
    });

    // Get all divs with data- attributes
    const allDataDivs = document.querySelectorAll('div[data-test], div[data-automation], div[data-reviewid]');
    results.dataAttributes = Array.from(allDataDivs).slice(0, 10).map(el => ({
      dataTest: el.getAttribute('data-test'),
      dataAutomation: el.getAttribute('data-automation'),
      dataReviewId: el.getAttribute('data-reviewid'),
      classes: el.className
    }));

    // Find elements that look like reviews (have substantial text)
    const allDivs = document.querySelectorAll('div');
    const likelyReviews = Array.from(allDivs).filter(div => {
      const text = div.textContent || '';
      return text.length > 100 && text.length < 2000;
    }).slice(0, 5);

    results.likelyReviews = likelyReviews.map(div => ({
      textLength: div.textContent.length,
      className: div.className,
      id: div.id,
      dataAttributes: Array.from(div.attributes).filter(a => a.name.startsWith('data-')).map(a => `${a.name}="${a.value}"`),
      firstText: div.textContent.substring(0, 200)
    }));

    return results;
  });

  console.log('📊 Selector Test Results:\n');
  console.log('Counts by selector:');
  Object.entries(debug.counts).forEach(([selector, count]) => {
    console.log(`  ${selector}: ${count} elements`);
  });

  console.log('\n🎯 Selectors with matches:');
  Object.entries(debug.selectors).forEach(([selector, info]) => {
    console.log(`\n  ${selector}:`);
    console.log(`    Count: ${info.count}`);
    console.log(`    Sample:`, info.sample);
  });

  console.log('\n📝 Data attributes found:');
  debug.dataAttributes.forEach((attr, i) => {
    console.log(`  ${i + 1}.`, attr);
  });

  console.log('\n💡 Likely review elements (by text length):');
  debug.likelyReviews.forEach((review, i) => {
    console.log(`\n  ${i + 1}.`);
    console.log(`    Text length: ${review.textLength}`);
    console.log(`    Class: ${review.className}`);
    console.log(`    ID: ${review.id}`);
    console.log(`    Data attrs: ${review.dataAttributes.join(', ')}`);
    console.log(`    Preview: ${review.firstText.substring(0, 100)}...`);
  });

  // Save full debug info
  fs.writeFileSync('./results/debug-selectors.json', JSON.stringify(debug, null, 2));
  console.log('\n✓ Full debug info saved to: ./results/debug-selectors.json\n');

  await browser.close();
  console.log('✓ Done!\n');
}

main().catch(console.error);

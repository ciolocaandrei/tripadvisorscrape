import puppeteer from 'puppeteer-extra';
import StealthPlugin from 'puppeteer-extra-plugin-stealth';
import fs from 'fs';
import path from 'path';

puppeteer.use(StealthPlugin());

const PROMPT = 'top 10 reliable cars on planet';

// Helper function for delays (replaces page.waitForTimeout)
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

async function searchChatGPT() {
  console.log('Launching browser...');

  const browser = await puppeteer.launch({
    headless: true, // Set to true for headless mode
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
      '--window-size=1920,1080'

    ],
    defaultViewport: { width: 1920, height: 1080 }
  });

  const page = await browser.newPage();

  // Set user agent
  await page.setUserAgent('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127.0.0.0 Safari/537.36');

  // Set extra HTTP headers including client hints
  await page.setExtraHTTPHeaders({
    'sec-ch-ua': '" Not;A Brand";v="99", "Google Chrome";v="127", "Chromium";v="127"',
    'sec-ch-ua-mobile': '?0',
    'sec-ch-ua-platform': '"macOS"',
    'sec-fetch-dest': 'document',
    'sec-fetch-mode': 'navigate',
    'sec-fetch-site': 'none',
    'sec-fetch-user': '?1',
    'upgrade-insecure-requests': '1',
    'accept-language': 'en-US,en;q=0.9'
  });

  try {
    console.log('Navigating to ChatGPT...');
    await page.goto('https://chatgpt.com', {
      waitUntil: 'networkidle2',
      timeout: 60000
    });

    // Wait for page to fully load
    await delay(6000);

    // Wait for the prompt input
    console.log('Waiting for prompt input...');
    await page.waitForSelector('#prompt-textarea, [data-testid="prompt-textarea"]', {
      timeout: 30000
    });

    // STEP 1: Type the prompt first
    console.log(`Typing prompt: "${PROMPT}"`);
    const textarea = await page.$('#prompt-textarea');
    await textarea.click();
    await delay(500);
    await page.keyboard.type(PROMPT, { delay: 50 });
    await delay(1000);

    // STEP 2: Enable web search after typing
    console.log('Looking for web search toggle...');

    try {
      const searchBtnHandle = await page.$('button[data-testid="composer-button-search"]');

      if (searchBtnHandle) {
        const boundingBox = await searchBtnHandle.boundingBox();

        if (boundingBox) {
          console.log('Search button found');

          const isPressed = await page.evaluate(
            el => el.getAttribute('aria-pressed'),
            searchBtnHandle
          );
          console.log('Current aria-pressed:', isPressed);

          if (isPressed !== 'true') {
            // Click the search button
            const x = boundingBox.x + boundingBox.width / 2;
            const y = boundingBox.y + boundingBox.height / 2;

            console.log('Clicking search button...');
            await page.mouse.move(x, y);
            await delay(300);
            await page.mouse.click(x, y);
            await delay(1500);

            // Verify
            const newState = await page.evaluate(
              el => el.getAttribute('aria-pressed'),
              searchBtnHandle
            );
            console.log('After click aria-pressed:', newState);

            if (newState !== 'true') {
              // Try keyboard
              console.log('Trying keyboard Space...');
              await searchBtnHandle.focus();
              await delay(200);
              await page.keyboard.press('Space');
              await delay(1000);
            }
          } else {
            console.log('Web search already enabled!');
          }
        }
      } else {
        console.log('Could not find web search button.');
      }
    } catch (e) {
      console.log('Could not enable web search:', e.message);
    }

    // Verify search is enabled
    const searchState = await page.evaluate(() => {
      const btn = document.querySelector('button[data-testid="composer-button-search"]');
      return btn ? btn.getAttribute('aria-pressed') : null;
    });
    console.log('Search enabled:', searchState === 'true');

    // STEP 3: Submit the prompt
    console.log('Submitting prompt...');
    await delay(500);

    const sendBtn = await page.$('button[data-testid="send-button"], button#composer-submit-button, button[aria-label="Send prompt"]');

    if (sendBtn) {
      await sendBtn.click();
      console.log('Prompt sent!');
    } else {
      await page.keyboard.press('Enter');
      console.log('Prompt sent via Enter key!');
    }

    // Wait for response to generate
    console.log('Waiting for ChatGPT response...');
    await delay(5000);

    // Wait for response to complete - look for the stop generating button to disappear
    let responseComplete = false;
    let attempts = 0;
    const maxAttempts = 60; // 60 seconds max

    while (!responseComplete && attempts < maxAttempts) {
      await delay(1000);
      attempts++;

      // Check if still generating
      const stopButton = await page.$('button[aria-label*="Stop"]');
      const regenerateBtn = await page.$('button[aria-label*="Regenerate"]');

      if (!stopButton || regenerateBtn) {
        responseComplete = true;
        console.log('Response completed!');
      } else {
        console.log(`Waiting for response... (${attempts}s)`);
      }
    }

    // Additional wait for content to render
    await delay(2000);

    // Extract the response text
    console.log('Extracting response...');

    const result = await page.evaluate(() => {
      // Find all message elements
      const messages = document.querySelectorAll('[data-message-author-role="assistant"]');
      const lastMessage = messages[messages.length - 1];

      if (!lastMessage) {
        // Try alternative selectors
        const altMessages = document.querySelectorAll('.agent-turn, .markdown');
        if (altMessages.length > 0) {
          const lastAlt = altMessages[altMessages.length - 1];
          return {
            text: lastAlt.innerText || lastAlt.textContent,
            sources: []
          };
        }
        return { text: 'No response found', sources: [] };
      }

      // Get the response text
      const responseText = lastMessage.innerText || lastMessage.textContent;

      // Try to find sources/citations
      const sources = [];

      // Look for citation elements
      const citations = document.querySelectorAll('a[href*="http"], [data-testid*="citation"], .citation');
      citations.forEach(citation => {
        const href = citation.href || citation.getAttribute('href');
        const title = citation.innerText || citation.title || '';
        if (href && href.startsWith('http')) {
          sources.push({ title: title.trim(), url: href });
        }
      });

      // Also look for source cards
      const sourceCards = document.querySelectorAll('[data-testid*="source"], .source-card');
      sourceCards.forEach(card => {
        const link = card.querySelector('a');
        if (link) {
          sources.push({
            title: link.innerText || card.innerText,
            url: link.href
          });
        }
      });

      return { text: responseText, sources };
    });

    console.log('\n' + '='.repeat(80));
    console.log('CHATGPT RESPONSE:');
    console.log('='.repeat(80) + '\n');
    console.log(result.text);

    if (result.sources && result.sources.length > 0) {
      console.log('\n' + '-'.repeat(80));
      console.log('SOURCES:');
      console.log('-'.repeat(80));
      result.sources.forEach((source, i) => {
        console.log(`${i + 1}. ${source.title || 'Source'}: ${source.url}`);
      });
    }

    console.log('\n' + '='.repeat(80));

    // Save results to file
    const outputDir = './gpt-results';
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }

    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(outputDir, `chatgpt-response-${timestamp}.json`);
    const textFile = path.join(outputDir, `chatgpt-response-${timestamp}.txt`);

    // Save as JSON (structured data)
    const jsonOutput = {
      prompt: PROMPT,
      timestamp: new Date().toISOString(),
      response: result.text,
      sources: result.sources
    };
    fs.writeFileSync(outputFile, JSON.stringify(jsonOutput, null, 2));
    console.log(`\nJSON saved to: ${outputFile}`);

    // Save as readable text file
    let textOutput = `CHATGPT WEB SEARCH RESULTS\n`;
    textOutput += `${'='.repeat(80)}\n\n`;
    textOutput += `Prompt: ${PROMPT}\n`;
    textOutput += `Date: ${new Date().toISOString()}\n\n`;
    textOutput += `${'='.repeat(80)}\n`;
    textOutput += `RESPONSE:\n`;
    textOutput += `${'='.repeat(80)}\n\n`;
    textOutput += result.text;
    textOutput += `\n\n${'='.repeat(80)}\n`;
    textOutput += `SOURCES:\n`;
    textOutput += `${'-'.repeat(80)}\n`;

    if (result.sources && result.sources.length > 0) {
      result.sources.forEach((source, i) => {
        textOutput += `${i + 1}. ${source.title || 'Source'}\n`;
        textOutput += `   URL: ${source.url}\n\n`;
      });
    } else {
      textOutput += `No sources found.\n`;
    }

    fs.writeFileSync(textFile, textOutput);
    console.log(`Text saved to: ${textFile}`);

    // Return the result
    return result;

  } catch (error) {
    console.error('Error:', error.message);
    throw error;
  } finally {
    // Keep browser open for manual inspection (comment out to auto-close)
    console.log('\nBrowser will remain open. Press Ctrl+C to exit.');
    // await browser.close();
  }
}

// Run the script
searchChatGPT()
  .then(result => {
    console.log('\nScript completed successfully!');
  })
  .catch(error => {
    console.error('Script failed:', error);
    process.exit(1);
  });

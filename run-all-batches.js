/**
 * Batch Runner for TripAdvisor Scraper
 *
 * This script runs the scraper in batches to work within
 * Bright Data Scraping Browser page navigation limits.
 *
 * Usage: node run-all-batches.js
 */

import { spawn } from 'child_process';
import fs from 'fs';

const CONFIG = {
  TOTAL_HOTELS: 50,
  BATCH_SIZE: 5,
  DELAY_BETWEEN_BATCHES: 60000, // 1 minute between batches
};

function runBatch(batchStart) {
  return new Promise((resolve, reject) => {
    console.log(`\n${'═'.repeat(60)}`);
    console.log(`🚀 Starting batch ${batchStart + 1}-${Math.min(batchStart + CONFIG.BATCH_SIZE, CONFIG.TOTAL_HOTELS)}`);
    console.log(`${'═'.repeat(60)}\n`);

    const process = spawn('node', ['scraping-browser.js'], {
      env: { ...process.env, BATCH_START: batchStart.toString() },
      stdio: 'inherit'
    });

    process.on('close', (code) => {
      if (code === 0) {
        console.log(`\n✅ Batch ${batchStart + 1}-${Math.min(batchStart + CONFIG.BATCH_SIZE, CONFIG.TOTAL_HOTELS)} completed successfully\n`);
        resolve();
      } else {
        console.error(`\n❌ Batch ${batchStart + 1}-${Math.min(batchStart + CONFIG.BATCH_SIZE, CONFIG.TOTAL_HOTELS)} failed with code ${code}\n`);
        reject(new Error(`Batch failed with code ${code}`));
      }
    });

    process.on('error', (err) => {
      console.error(`\n❌ Failed to start batch: ${err.message}\n`);
      reject(err);
    });
  });
}

async function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║          Batch Runner - TripAdvisor Scraper           ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log(`📋 Configuration:`);
  console.log(`   Total Hotels: ${CONFIG.TOTAL_HOTELS}`);
  console.log(`   Batch Size: ${CONFIG.BATCH_SIZE}`);
  console.log(`   Total Batches: ${Math.ceil(CONFIG.TOTAL_HOTELS / CONFIG.BATCH_SIZE)}`);
  console.log(`   Delay Between Batches: ${CONFIG.DELAY_BETWEEN_BATCHES / 1000}s\n`);

  const batches = [];
  for (let i = 0; i < CONFIG.TOTAL_HOTELS; i += CONFIG.BATCH_SIZE) {
    batches.push(i);
  }

  console.log(`🎯 Batches to run: ${batches.length}\n`);

  let completedBatches = 0;
  let failedBatches = 0;

  for (let i = 0; i < batches.length; i++) {
    const batchStart = batches[i];

    try {
      await runBatch(batchStart);
      completedBatches++;

      // Add delay between batches (except after the last one)
      if (i < batches.length - 1) {
        console.log(`⏳ Waiting ${CONFIG.DELAY_BETWEEN_BATCHES / 1000}s before next batch...\n`);
        await delay(CONFIG.DELAY_BETWEEN_BATCHES);
      }
    } catch (error) {
      failedBatches++;
      console.error(`❌ Batch ${i + 1} failed. Continuing with next batch...\n`);
    }
  }

  console.log('\n' + '═'.repeat(60));
  console.log('🎉 ALL BATCHES COMPLETED!');
  console.log('═'.repeat(60));
  console.log(`✅ Successful batches: ${completedBatches}/${batches.length}`);
  console.log(`❌ Failed batches: ${failedBatches}/${batches.length}`);

  // Load and display final summary
  const resultsPath = './results/summary-report.json';
  if (fs.existsSync(resultsPath)) {
    const summary = JSON.parse(fs.readFileSync(resultsPath, 'utf8'));
    console.log(`\n📊 Final Statistics:`);
    console.log(`   Hotels Scraped: ${summary.totalHotelsScraped}`);
    console.log(`   Reviews Scraped: ${summary.totalReviewsScraped}`);
    console.log(`   Celebrity Mentions: ${summary.totalCelebrityMentions}`);
    console.log(`   Hotels with Mentions: ${summary.hotelsWithMentions}`);

    if (summary.topHotelsByMentions && summary.topHotelsByMentions.length > 0) {
      console.log(`\n🏆 Top 5 Hotels by Celebrity Mentions:`);
      summary.topHotelsByMentions.slice(0, 5).forEach((h, i) => {
        console.log(`   ${i + 1}. ${h.name} - ${h.mentions} mentions`);
      });
    }
  }

  console.log(`\n📁 Results saved to: ./results/\n`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

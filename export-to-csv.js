/**
 * Export Reviews to CSV
 *
 * Reads individual hotel review files from results/reviews/
 * and exports them to a CSV file
 */

import fs from 'fs';
import path from 'path';

const CONFIG = {
  RESULTS_DIR: './results',
  REVIEWS_DIR: './results/reviews',
  OUTPUT_FILE: './results/reviews-export.csv',
  CELEBRITY_KEYWORDS: ['celeb spotting', 'celeb sighting', 'celebrities'],
};

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  // Escape double quotes by doubling them
  const escaped = stringValue.replace(/"/g, '""');
  // Wrap in quotes if contains comma, newline, or quotes
  if (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')) {
    return `"${escaped}"`;
  }
  return escaped;
}

function convertToCSV(data) {
  const rows = [];

  // CSV Headers
  const headers = [
    'Hotel Rank',
    'Hotel Name',
    'Hotel URL',
    'Total Reviews',
    'Reviews with Celebrity Mentions',
    'Total Celebrity Mentions',
    'Celeb Spotting Count',
    'Celeb Sighting Count',
    'Celebrities Count',
    'Celebrity Mention Details'
  ];
  rows.push(headers.join(','));

  // Process each hotel
  data.forEach(hotel => {
    const mentionBreakdown = hotel.mentionBreakdown || {};

    const row = [
      escapeCSV(hotel.rank),
      escapeCSV(hotel.name),
      escapeCSV(hotel.url),
      escapeCSV(hotel.totalReviews || 0),
      escapeCSV(hotel.reviewsWithCelebrityMentions || 0),
      escapeCSV(hotel.totalCelebrityMentions || 0),
      escapeCSV(mentionBreakdown['celeb spotting'] || 0),
      escapeCSV(mentionBreakdown['celeb sighting'] || 0),
      escapeCSV(mentionBreakdown['celebrities'] || 0),
      escapeCSV(JSON.stringify(mentionBreakdown))
    ];
    rows.push(row.join(','));
  });

  return rows.join('\n');
}

function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  Export Celebrity Mentions to CSV                     ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('🔍 Celebrity Keywords:');
  CONFIG.CELEBRITY_KEYWORDS.forEach(keyword => {
    console.log(`   - "${keyword}"`);
  });
  console.log();

  // Check if reviews directory exists
  if (!fs.existsSync(CONFIG.REVIEWS_DIR)) {
    console.error(`❌ Reviews directory not found: ${CONFIG.REVIEWS_DIR}`);
    console.error('   Run the scraper first to extract reviews!\n');
    process.exit(1);
  }

  console.log(`📖 Reading hotel review files from: ${CONFIG.REVIEWS_DIR}`);

  // Read all JSON files from reviews directory
  const files = fs.readdirSync(CONFIG.REVIEWS_DIR)
    .filter(file => file.endsWith('.json'))
    .sort(); // Sort by filename to maintain rank order

  if (files.length === 0) {
    console.error(`❌ No review files found in: ${CONFIG.REVIEWS_DIR}`);
    console.error('   Run the scraper first to extract reviews!\n');
    process.exit(1);
  }

  console.log(`✓ Found ${files.length} hotel review files`);

  // Load all hotel data from individual files
  const data = [];
  for (const file of files) {
    const filepath = path.join(CONFIG.REVIEWS_DIR, file);
    const hotelData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    data.push(hotelData);
  }

  // Sort by rank to ensure correct order
  data.sort((a, b) => a.rank - b.rank);

  console.log(`✓ Loaded ${data.length} hotels\n`);

  // Count total reviews and celebrity mentions
  const totalReviews = data.reduce((sum, hotel) => sum + (hotel.totalReviews || 0), 0);
  const totalCelebrityMentions = data.reduce((sum, hotel) => sum + (hotel.totalCelebrityMentions || 0), 0);
  const hotelsWithMentions = data.filter(h => h.totalCelebrityMentions > 0).length;

  console.log(`📊 Statistics:`);
  console.log(`   Total reviews: ${totalReviews}`);
  console.log(`   Hotels with celebrity mentions: ${hotelsWithMentions}/${data.length}`);
  console.log(`   Total celebrity mentions found: ${totalCelebrityMentions}\n`);

  // Convert to CSV
  console.log('🔄 Converting to CSV...');
  const csv = convertToCSV(data);

  // Save CSV file
  console.log(`💾 Saving to: ${CONFIG.OUTPUT_FILE}`);
  fs.writeFileSync(CONFIG.OUTPUT_FILE, csv, 'utf8');

  // Get file size
  const stats = fs.statSync(CONFIG.OUTPUT_FILE);
  const fileSizeKB = (stats.size / 1024).toFixed(2);

  console.log('\n' + '═'.repeat(60));
  console.log('✅ CSV EXPORT COMPLETED!');
  console.log('═'.repeat(60));
  console.log(`📊 Hotels: ${data.length}`);
  console.log(`📝 Reviews: ${totalReviews}`);
  console.log(`⭐ Celebrity Mentions: ${totalCelebrityMentions}`);
  console.log(`📁 Output: ${CONFIG.OUTPUT_FILE}`);
  console.log(`💾 File size: ${fileSizeKB} KB\n`);
}

main();

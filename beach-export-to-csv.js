/**
 * Export Beach Reviews to CSV
 *
 * Reads individual beach review files from results/beaches/reviews/
 * and exports them to a CSV file with keyword analysis
 */

import fs from 'fs';
import path from 'path';

const CONFIG = {
  RESULTS_DIR: './results/beaches',
  REVIEWS_DIR: './results/beaches/reviews',
  OUTPUT_FILE: './results/beaches/beach-reviews-export.csv',
  KEYWORD_CATEGORIES: [
    'relaxation', 'weather', 'nature', 'cleanliness', 'crowding',
    'beauty', 'water', 'activities', 'facilities', 'safety', 'family'
  ],
  TOP_KEYWORDS: [
    'relaxing', 'hot', 'shells', 'litter', 'busy', 'crowded', 'peaceful',
    'clean', 'dirty', 'beautiful', 'paradise', 'pristine', 'crystal clear',
    'turquoise', 'white sand', 'calm', 'waves', 'swimming', 'snorkeling'
  ]
};

function escapeCSV(value) {
  if (value === null || value === undefined) return '';
  const stringValue = String(value);
  const escaped = stringValue.replace(/"/g, '""');
  if (escaped.includes(',') || escaped.includes('\n') || escaped.includes('"')) {
    return `"${escaped}"`;
  }
  return escaped;
}

function convertToCSV(data) {
  const rows = [];

  // CSV Headers
  const headers = [
    'Rank',
    'Beach Name',
    'Location',
    'URL',
    'Total Reviews',
    'Reviews with Keywords',
    'Total Keyword Mentions',
    // Category columns
    ...CONFIG.KEYWORD_CATEGORIES.map(cat => `${cat.charAt(0).toUpperCase() + cat.slice(1)} Mentions`),
    // Top keyword columns
    ...CONFIG.TOP_KEYWORDS.map(kw => `"${kw}" Count`),
    'Top 5 Keywords',
    'Full Keyword Breakdown'
  ];
  rows.push(headers.join(','));

  // Process each beach
  data.forEach(beach => {
    const keywordBreakdown = beach.keywordBreakdown || {};
    const keywordCategories = beach.keywordCategories || {};

    const row = [
      escapeCSV(beach.rank),
      escapeCSV(beach.name),
      escapeCSV(beach.location || ''),
      escapeCSV(beach.url),
      escapeCSV(beach.totalReviews || 0),
      escapeCSV(beach.reviewsWithKeywords || 0),
      escapeCSV(beach.totalKeywordMentions || 0),
      // Category counts
      ...CONFIG.KEYWORD_CATEGORIES.map(cat => escapeCSV(keywordCategories[cat] || 0)),
      // Individual keyword counts
      ...CONFIG.TOP_KEYWORDS.map(kw => escapeCSV(keywordBreakdown[kw] || 0)),
      // Top 5 keywords summary
      escapeCSV((beach.topKeywords || []).slice(0, 5).map(k => `${k.keyword}(${k.count})`).join('; ')),
      // Full breakdown as JSON
      escapeCSV(JSON.stringify(keywordBreakdown))
    ];
    rows.push(row.join(','));
  });

  return rows.join('\n');
}

function convertReviewsToCSV(data) {
  const rows = [];

  // Headers for detailed review export
  const headers = [
    'Beach Rank',
    'Beach Name',
    'Location',
    'Review Title',
    'Review Text',
    'Rating',
    'Date',
    'Reviewer',
    'Has Keywords',
    'Keyword Count',
    'Keywords Found'
  ];
  rows.push(headers.join(','));

  data.forEach(beach => {
    const reviews = beach.reviews || beach.allReviews || [];

    reviews.forEach(review => {
      // Check if this review has keywords
      const reviewWithKeywords = (beach.reviewsWithKeywords || [])
        .find(r => r.title === review.title && r.text === review.text);

      const hasKeywords = !!reviewWithKeywords;
      const keywordCount = reviewWithKeywords?.keywordMentions?.total || 0;
      const keywordsFound = reviewWithKeywords?.keywordMentions?.breakdown
        ? Object.entries(reviewWithKeywords.keywordMentions.breakdown)
            .map(([k, v]) => `${k}(${v})`)
            .join('; ')
        : '';

      const row = [
        escapeCSV(beach.rank),
        escapeCSV(beach.name),
        escapeCSV(beach.location || ''),
        escapeCSV(review.title || ''),
        escapeCSV(review.text || ''),
        escapeCSV(review.rating || 0),
        escapeCSV(review.date || ''),
        escapeCSV(review.reviewer || ''),
        escapeCSV(hasKeywords ? 'Yes' : 'No'),
        escapeCSV(keywordCount),
        escapeCSV(keywordsFound)
      ];
      rows.push(row.join(','));
    });
  });

  return rows.join('\n');
}

function main() {
  console.log('╔════════════════════════════════════════════════════════╗');
  console.log('║  Export Beach Reviews to CSV                           ║');
  console.log('║  Keywords: relaxing, hot, shells, litter, busy, etc.   ║');
  console.log('╚════════════════════════════════════════════════════════╝\n');

  console.log('🔍 Keywords being tracked:');
  CONFIG.TOP_KEYWORDS.forEach(keyword => {
    console.log(`   - "${keyword}"`);
  });
  console.log();

  // Check if reviews directory exists
  if (!fs.existsSync(CONFIG.REVIEWS_DIR)) {
    console.error(`❌ Reviews directory not found: ${CONFIG.REVIEWS_DIR}`);
    console.error('   Run beach-reviews-extractor.js first!\n');
    process.exit(1);
  }

  console.log(`📖 Reading beach review files from: ${CONFIG.REVIEWS_DIR}`);

  // Read all JSON files from reviews directory
  const files = fs.readdirSync(CONFIG.REVIEWS_DIR)
    .filter(file => file.endsWith('.json'))
    .sort();

  if (files.length === 0) {
    console.error(`❌ No review files found in: ${CONFIG.REVIEWS_DIR}`);
    console.error('   Run beach-reviews-extractor.js first!\n');
    process.exit(1);
  }

  console.log(`✓ Found ${files.length} beach review files`);

  // Load all beach data
  const data = [];
  for (const file of files) {
    const filepath = path.join(CONFIG.REVIEWS_DIR, file);
    const beachData = JSON.parse(fs.readFileSync(filepath, 'utf8'));
    data.push(beachData);
  }

  // Sort by rank
  data.sort((a, b) => a.rank - b.rank);

  console.log(`✓ Loaded ${data.length} beaches\n`);

  // Calculate statistics
  const totalReviews = data.reduce((sum, beach) => sum + (beach.totalReviews || 0), 0);
  const totalKeywordMentions = data.reduce((sum, beach) => sum + (beach.totalKeywordMentions || 0), 0);
  const beachesWithKeywords = data.filter(b => b.totalKeywordMentions > 0).length;

  // Aggregate categories
  const aggregateCategories = {};
  data.forEach(beach => {
    if (beach.keywordCategories) {
      Object.entries(beach.keywordCategories).forEach(([cat, count]) => {
        aggregateCategories[cat] = (aggregateCategories[cat] || 0) + count;
      });
    }
  });

  console.log(`📊 Statistics:`);
  console.log(`   Total reviews: ${totalReviews}`);
  console.log(`   Beaches with keyword mentions: ${beachesWithKeywords}/${data.length}`);
  console.log(`   Total keyword mentions: ${totalKeywordMentions}\n`);

  if (Object.keys(aggregateCategories).length > 0) {
    console.log(`📊 Keyword categories across all beaches:`);
    Object.entries(aggregateCategories)
      .sort((a, b) => b[1] - a[1])
      .forEach(([cat, count]) => {
        console.log(`   ${cat}: ${count} mentions`);
      });
    console.log();
  }

  // Export summary CSV
  console.log('🔄 Converting summary to CSV...');
  const summaryCSV = convertToCSV(data);
  const summaryFile = CONFIG.OUTPUT_FILE;
  console.log(`💾 Saving summary to: ${summaryFile}`);
  fs.writeFileSync(summaryFile, summaryCSV, 'utf8');

  // Export detailed reviews CSV
  console.log('🔄 Converting detailed reviews to CSV...');
  const reviewsCSV = convertReviewsToCSV(data);
  const reviewsFile = CONFIG.OUTPUT_FILE.replace('.csv', '-detailed.csv');
  console.log(`💾 Saving detailed reviews to: ${reviewsFile}`);
  fs.writeFileSync(reviewsFile, reviewsCSV, 'utf8');

  // Get file sizes
  const summaryStats = fs.statSync(summaryFile);
  const reviewsStats = fs.statSync(reviewsFile);

  console.log('\n' + '═'.repeat(60));
  console.log('✅ CSV EXPORT COMPLETED!');
  console.log('═'.repeat(60));
  console.log(`🏖️  Beaches: ${data.length}`);
  console.log(`📝 Reviews: ${totalReviews}`);
  console.log(`🔍 Keyword Mentions: ${totalKeywordMentions}`);
  console.log(`\n📁 Output files:`);
  console.log(`   Summary: ${summaryFile} (${(summaryStats.size / 1024).toFixed(2)} KB)`);
  console.log(`   Detailed: ${reviewsFile} (${(reviewsStats.size / 1024).toFixed(2)} KB)\n`);

  // Show top beaches
  console.log('🏆 Top 5 beaches by keyword mentions:');
  data
    .sort((a, b) => b.totalKeywordMentions - a.totalKeywordMentions)
    .slice(0, 5)
    .forEach((beach, i) => {
      const topKws = (beach.topKeywords || []).slice(0, 3).map(k => k.keyword).join(', ');
      console.log(`   ${i + 1}. ${beach.name} - ${beach.totalKeywordMentions} mentions (${topKws})`);
    });
  console.log();
}

main();

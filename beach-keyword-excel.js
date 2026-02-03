/**
 * Beach Keyword Excel Export
 *
 * Creates an Excel workbook with one sheet per keyword,
 * each ranking beaches from most to fewest mentions.
 */

import fs from 'fs';
import path from 'path';
import XLSX from 'xlsx';

const REVIEWS_DIR = './results/beaches/reviews';
const OUTPUT_FILE = './results/beaches/beach-keywords-ranking.xlsx';

// Each tab keyword groups related terms together for counting
const TAB_KEYWORDS = {
  'Relaxing':      ['relaxing', 'relaxed', 'peaceful', 'tranquil', 'serene', 'calm'],
  'Hot':           ['hot', 'warm', 'sunny', 'scorching'],
  'Shells':        ['shells', 'shell', 'seashells', 'coral'],
  'Litter':        ['litter', 'trash', 'garbage', 'rubbish', 'dirty', 'pollution'],
  'Busy':          ['busy', 'crowded', 'packed', 'touristy'],
  'Beautiful':     ['beautiful', 'stunning', 'gorgeous', 'paradise', 'breathtaking', 'amazing'],
  'Crystal Clear': ['crystal clear', 'clear water', 'turquoise', 'blue water'],
  'Family':        ['family', 'kids', 'children', 'family-friendly'],
  'Clean':         ['clean', 'pristine'],
};

function countKeyword(text, keyword) {
  if (!text) return 0;
  const regex = new RegExp(`\\b${keyword.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
  return (text.match(regex) || []).length;
}

function main() {
  console.log('Reading beach review files...');

  const files = fs.readdirSync(REVIEWS_DIR).filter(f => f.endsWith('.json')).sort();
  console.log(`Found ${files.length} files`);

  // Load all beaches and count keywords from review text
  const beaches = files.map(file => {
    const data = JSON.parse(fs.readFileSync(path.join(REVIEWS_DIR, file), 'utf8'));
    const reviews = data.reviews || data.allReviews || [];
    const allText = reviews.map(r => `${r.title || ''} ${r.text || ''}`).join(' ');

    const tabCounts = {};
    for (const [tab, words] of Object.entries(TAB_KEYWORDS)) {
      tabCounts[tab] = words.reduce((sum, kw) => sum + countKeyword(allText, kw), 0);
    }

    return { name: data.name, rank: data.rank, location: data.location || '', totalReviews: reviews.length, tabCounts };
  });

  console.log(`Loaded ${beaches.length} beaches, generating Excel...`);

  const wb = XLSX.utils.book_new();
  const tabNames = Object.keys(TAB_KEYWORDS);

  // Summary sheet first
  const summaryRows = tabNames.map(tab => {
    const total = beaches.reduce((sum, b) => sum + b.tabCounts[tab], 0);
    const topBeach = beaches.reduce((best, b) => b.tabCounts[tab] > (best?.count || 0) ? { name: b.name, count: b.tabCounts[tab] } : best, { name: '', count: 0 });
    return { Keyword: tab, 'Related Terms': TAB_KEYWORDS[tab].join(', '), 'Total Mentions': total, 'Top Beach': topBeach.name, 'Top Beach Count': topBeach.count };
  }).sort((a, b) => b['Total Mentions'] - a['Total Mentions']);

  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(summaryRows), 'Summary');

  // Overall ranking: aggregate all keyword mentions per beach
  const overallRows = [...beaches]
    .map(b => {
      const totalMentions = tabNames.reduce((sum, tab) => sum + b.tabCounts[tab], 0);
      const breakdown = tabNames.map(tab => ({ tab, count: b.tabCounts[tab] })).sort((a, b) => b.count - a.count);
      const row = { Beach: b.name, Location: b.location, 'Total Reviews': b.totalReviews, 'Total Keyword Mentions': totalMentions };
      for (const tab of tabNames) row[tab] = b.tabCounts[tab];
      row['Top Keyword'] = breakdown[0].count > 0 ? breakdown[0].tab : 'N/A';
      return row;
    })
    .sort((a, b) => b['Total Keyword Mentions'] - a['Total Keyword Mentions']);
  overallRows.forEach((row, i) => { row['#'] = i + 1; });
  // Reorder columns so # is first
  const orderedOverall = overallRows.map(r => ({ '#': r['#'], ...r }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(orderedOverall), 'Overall Ranking');

  // One sheet per keyword group
  for (const tab of tabNames) {
    const sorted = [...beaches]
      .map((b, i) => ({ '#': i + 1, Beach: b.name, Location: b.location, 'Total Reviews': b.totalReviews, Mentions: b.tabCounts[tab] }))
      .sort((a, b) => b.Mentions - a.Mentions)
      .map((row, i) => ({ '#': i + 1, ...row }));
    // Fix rank after sort
    sorted.forEach((row, i) => { row['#'] = i + 1; });

    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(sorted), tab);
  }

  // Methodology sheet
  const methodologyRows = [
    { Step: '1. Data Collection', Description: 'Scraped approximately the latest 1,000 reviews per beach from TripAdvisor.' },
    { Step: '2. Local Storage', Description: 'Saved the raw review data as JSON files in the local results directory.' },
    { Step: '3. Keyword Search', Description: 'Searched each review text for predefined keyword groups (e.g. Relaxing, Beautiful, Clean) using exact word matching.' },
    { Step: '4. Excel Generation', Description: 'Aggregated keyword mention counts per beach and exported the results into this Excel workbook, with one tab per keyword group ranked by number of mentions.' },
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(methodologyRows), 'Methodology');

  fs.mkdirSync(path.dirname(OUTPUT_FILE), { recursive: true });
  XLSX.writeFile(wb, OUTPUT_FILE);
  console.log(`Done! Excel saved to: ${OUTPUT_FILE}`);
  console.log(`Sheets: ${wb.SheetNames.length} (1 Summary + ${tabNames.length} keyword tabs: ${tabNames.join(', ')})`);
}

main();

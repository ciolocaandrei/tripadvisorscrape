/**
 * Rightmove Commercial Property Scraper
 * Uses direct API calls - no browser needed
 * Saves rent and buy properties to separate CSV files per city
 */

import fs from 'fs';
import path from 'path';

const CONFIG = {
  LINKS_FILE: './links/links.csv',
  RESULTS_DIR_RENT: './results/rightmove/rent',
  RESULTS_DIR_BUY: './results/rightmove/buy',
  PAGE_SIZE: 24,
  DELAY_BETWEEN_PAGES: 2000,  // 2 seconds between page requests
  DELAY_BETWEEN_CITIES: 3000, // 3 seconds between cities
};

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

// Parse the CSV file to extract city-URL pairs
function parseLinksCSV() {
  const content = fs.readFileSync(CONFIG.LINKS_FILE, 'utf-8');
  const lines = content.split('\n').filter(line => line.trim());

  const rentLinks = [];
  const buyLinks = [];

  for (const line of lines) {
    if (line.startsWith('Links')) continue;
    if (!line.includes("'city'")) continue;

    // Find all dict-like patterns in the line
    const matches = line.matchAll(/\{'city':\s*'([^']+)',\s*'url':\s*'([^']+)'\}/g);

    for (const match of matches) {
      const city = match[1];
      const url = match[2];

      if (city.includes('Buy') || url.includes('for-sale')) {
        buyLinks.push({
          city: city.replace(' Buy', ''),
          url: url
        });
      } else {
        rentLinks.push({
          city: city,
          url: url
        });
      }
    }
  }

  return { rentLinks, buyLinks };
}

// Extract locationIdentifier from URL
function extractLocationIdentifier(url) {
  const match = url.match(/locationIdentifier=([^&]+)/);
  return match ? decodeURIComponent(match[1]) : null;
}

// Build API URL for Rightmove
function buildApiUrl(locationIdentifier, index = 0, isRent = true) {
  const channel = isRent ? 'COMMERCIAL_RENT' : 'COMMERCIAL_BUY';

  const params = new URLSearchParams({
    locationIdentifier: locationIdentifier,
    numberOfPropertiesPerPage: CONFIG.PAGE_SIZE.toString(),
    radius: '0.0',
    sortType: '6',
    index: index.toString(),
    viewType: 'LIST',
    channel: channel,
    areaSizeUnit: 'sqft',
    currencyCode: 'GBP',
    isFetching: 'false',
  });

  return `https://www.rightmove.co.uk/api/_search?${params.toString()}`;
}

// Fetch API data
async function fetchApiData(url) {
  try {
    const response = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json',
        'Accept-Language': 'en-GB,en;q=0.9',
        'Referer': 'https://www.rightmove.co.uk/',
      }
    });

    if (!response.ok) {
      throw new Error(`HTTP ${response.status}`);
    }

    return await response.json();
  } catch (error) {
    console.error(`   Fetch error: ${error.message}`);
    return null;
  }
}

// Extract property data from API response
function extractPropertyData(apiResponse, city) {
  const properties = [];

  if (!apiResponse || !apiResponse.properties) {
    return properties;
  }

  for (const prop of apiResponse.properties) {
    properties.push({
      id: prop.id,
      city: city,
      propertyType: prop.propertySubType || prop.propertyType,
      displayAddress: prop.displayAddress,
      price: prop.price?.displayPrices?.[0]?.displayPrice || prop.price?.amount || '',
      priceQualifier: prop.price?.displayPrices?.[0]?.displayPriceQualifier || '',
      bedrooms: prop.bedrooms || '',
      bathrooms: prop.bathrooms || '',
      summary: prop.summary || '',
      propertyUrl: prop.propertyUrl ? `https://www.rightmove.co.uk${prop.propertyUrl}` : '',
      firstVisibleDate: prop.firstVisibleDate || '',
      addedOrReduced: prop.addedOrReduced || '',
      listingUpdate: prop.listingUpdate?.listingUpdateReason || '',
      formattedBranchName: prop.formattedBranchName || '',
      branchDisplayName: prop.branchDisplayName || '',
      latitude: prop.location?.latitude || '',
      longitude: prop.location?.longitude || '',
      propertyImages: prop.propertyImages?.images?.map(img => img.srcUrl).join('; ') || '',
    });
  }

  return properties;
}

// Convert properties to CSV format
function propertiesToCSV(properties) {
  if (!properties || properties.length === 0) return '';

  const headers = [
    'id', 'city', 'propertyType', 'displayAddress', 'price', 'priceQualifier',
    'bedrooms', 'bathrooms', 'summary', 'propertyUrl', 'firstVisibleDate',
    'addedOrReduced', 'listingUpdate', 'formattedBranchName', 'branchDisplayName',
    'latitude', 'longitude', 'propertyImages'
  ];

  const headerRow = headers.join(',');

  const rows = properties.map(prop => {
    return headers.map(header => {
      let value = prop[header];
      if (value === undefined || value === null) return '""';
      value = String(value).replace(/"/g, '""').replace(/\n/g, ' ');
      return `"${value}"`;
    }).join(',');
  });

  return [headerRow, ...rows].join('\n');
}

// Save properties to CSV file
function saveToCSV(properties, city, type) {
  const dir = type === 'rent' ? CONFIG.RESULTS_DIR_RENT : CONFIG.RESULTS_DIR_BUY;

  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  const safeCityName = city.replace(/[^a-zA-Z0-9]/g, '_');
  const filepath = path.join(dir, `${safeCityName}.csv`);

  const csv = propertiesToCSV(properties);
  fs.writeFileSync(filepath, csv);
  console.log(`   Saved: ${filepath} (${properties.length} properties)`);
}

// Scrape a single city
async function scrapeCity(cityData, type) {
  const isRent = type === 'rent';
  const locationIdentifier = extractLocationIdentifier(cityData.url);

  if (!locationIdentifier) {
    console.log(`   Could not extract locationIdentifier from URL`);
    return 0;
  }

  console.log(`\n[${type.toUpperCase()}] ${cityData.city}`);

  let allProperties = [];
  let index = 0;
  let hasMorePages = true;
  let pageNum = 1;

  while (hasMorePages) {
    const apiUrl = buildApiUrl(locationIdentifier, index, isRent);
    const data = await fetchApiData(apiUrl);

    if (!data) {
      console.log(`   Page ${pageNum}: Failed to fetch`);
      break;
    }

    const properties = extractPropertyData(data, cityData.city);
    allProperties.push(...properties);

    // Handle resultCount that might be a string with commas like "1,241"
    let totalResults = data.resultCount || 0;
    if (typeof totalResults === 'string') {
      totalResults = parseInt(totalResults.replace(/,/g, ''), 10) || 0;
    }
    const totalPages = Math.ceil(totalResults / CONFIG.PAGE_SIZE);

    console.log(`   Page ${pageNum}/${totalPages}: ${properties.length} properties (Total: ${allProperties.length}/${totalResults})`);

    // Continue if there are more results to fetch (use <= to ensure last page is captured)
    hasMorePages = index + CONFIG.PAGE_SIZE <= totalResults && properties.length > 0;
    index += CONFIG.PAGE_SIZE;
    pageNum++;

    if (hasMorePages) {
      await delay(CONFIG.DELAY_BETWEEN_PAGES);
    }
  }

  // Save results
  if (allProperties.length > 0) {
    saveToCSV(allProperties, cityData.city, type);
  } else {
    console.log(`   No properties found for ${cityData.city}`);
  }

  return allProperties.length;
}

async function main() {
  console.log('');
  console.log('='.repeat(60));
  console.log('  Rightmove Commercial Property Scraper');
  console.log('  Direct API Method');
  console.log('='.repeat(60));
  console.log('');

  // Parse links
  const { rentLinks, buyLinks } = parseLinksCSV();
  console.log(`Found ${rentLinks.length} rent links and ${buyLinks.length} buy links`);

  // Create output directories
  if (!fs.existsSync(CONFIG.RESULTS_DIR_RENT)) {
    fs.mkdirSync(CONFIG.RESULTS_DIR_RENT, { recursive: true });
  }
  if (!fs.existsSync(CONFIG.RESULTS_DIR_BUY)) {
    fs.mkdirSync(CONFIG.RESULTS_DIR_BUY, { recursive: true });
  }

  let totalRentProperties = 0;
  let totalBuyProperties = 0;

  // Process RENT links
  console.log('\n' + '='.repeat(60));
  console.log('PROCESSING RENT PROPERTIES');
  console.log('='.repeat(60));

  for (let i = 0; i < rentLinks.length; i++) {
    console.log(`\n[${i + 1}/${rentLinks.length}]`);
    const count = await scrapeCity(rentLinks[i], 'rent');
    totalRentProperties += count;
    await delay(CONFIG.DELAY_BETWEEN_CITIES);
  }

  // Process BUY links
  console.log('\n' + '='.repeat(60));
  console.log('PROCESSING BUY PROPERTIES');
  console.log('='.repeat(60));

  for (let i = 0; i < buyLinks.length; i++) {
    console.log(`\n[${i + 1}/${buyLinks.length}]`);
    const count = await scrapeCity(buyLinks[i], 'buy');
    totalBuyProperties += count;
    await delay(CONFIG.DELAY_BETWEEN_CITIES);
  }

  // Summary
  console.log('\n' + '='.repeat(60));
  console.log('SCRAPING COMPLETE');
  console.log('='.repeat(60));
  console.log(`Total RENT properties: ${totalRentProperties}`);
  console.log(`Total BUY properties: ${totalBuyProperties}`);
  console.log(`Results saved to:`);
  console.log(`  - ${CONFIG.RESULTS_DIR_RENT}/`);
  console.log(`  - ${CONFIG.RESULTS_DIR_BUY}/`);
}

main().catch(error => {
  console.error('Fatal error:', error);
  process.exit(1);
});

# TripAdvisor Celebrity Mentions Scraper

A web scraper built with Puppeteer to extract reviews from TripAdvisor's top 50 Las Vegas hotels and analyze celebrity-related mentions.

## ⚠️ Important: Anti-Bot Protection

TripAdvisor uses **DataDome CAPTCHA** to prevent automated scraping. This scraper includes:
- Stealth mode to evade basic detection
- Human-like behavior simulation
- Manual CAPTCHA solving support (browser stays open)
- Random delays and mouse movements

**You will need to manually solve CAPTCHAs when they appear.**

## Features

- Scrapes top 50 hotels from TripAdvisor's Travelers' Choice list
- Extracts ALL reviews from each hotel (up to 20 pages per hotel)
- Detects celebrity mentions with keywords: "celeb spotting", "celeb sighting", "celebrities", "celebrity", "celebs"
- Generates comprehensive reports with statistics and breakdowns
- Uses stealth mode to avoid detection
- Implements rate limiting and error handling
- Saves progress incrementally to prevent data loss

## Installation

```bash
npm install
```

## Usage

### Run the stealth scraper (RECOMMENDED):

```bash
npm start
```

This will:
1. Open a browser window (non-headless mode)
2. Navigate to TripAdvisor
3. **Wait for you to solve any CAPTCHA that appears**
4. Extract hotels and reviews
5. Analyze celebrity mentions
6. Save results to `./results/`

### Alternative commands:

```bash
npm test          # Test page loading only
npm run debug     # Debug mode with screenshots
node index.js     # Run basic scraper (may be blocked)

```

### Configuration

Edit the `CONFIG` object in `stealth-scraper.js` to customize:

```javascript
const CONFIG = {
  MAX_HOTELS: 50,              // Number of hotels to scrape
  CELEBRITY_KEYWORDS: [...],   // Keywords to search for
  DELAY_BETWEEN_HOTELS: 3000,  // Delay in ms (3 seconds)
  DELAY_BETWEEN_PAGES: 2000,   // Delay in ms (2 seconds)
  HEADLESS: false,             // MUST be false to solve CAPTCHAs manually
};
```

## Output

All results are saved in the `./results/` directory:

### 1. `hotels-list.json`
List of all hotels found with their URLs and rankings.

### 2. `scraping-progress.json`
Real-time progress (updated after each hotel is scraped).

### 3. `final-results.json`
Complete results for all hotels including:
- Total reviews count
- Reviews with celebrity mentions
- Total celebrity mentions
- Breakdown by keyword
- All review data

### 4. `summary-report.json`
Summary statistics including:
- Total hotels/reviews scraped
- Total celebrity mentions
- Hotels with mentions
- Top hotels ranked by mentions

## Data Structure

### Hotel Result Object
```json
{
  "rank": 1,
  "name": "Hotel Name",
  "url": "https://...",
  "totalReviews": 500,
  "reviewsWithCelebrityMentions": 15,
  "totalCelebrityMentions": 20,
  "mentionBreakdown": {
    "celebrity": 10,
    "celebrities": 8,
    "celeb spotting": 2
  },
  "reviewsWithMentions": [...],
  "allReviews": [...]
}
```

### Review Object
```json
{
  "title": "Review Title",
  "text": "Review text content...",
  "rating": 5,
  "date": "November 2024",
  "reviewer": "John D",
  "celebrityMentions": {
    "total": 2,
    "breakdown": {
      "celebrity": 1,
      "celebrities": 1
    }
  }
}
```

## Performance

- Each hotel takes approximately 1-5 minutes depending on review count
- Total scraping time for 50 hotels: 1-4 hours
- Implements delays to avoid rate limiting
- Saves progress after each hotel to prevent data loss

## Tips

- Start with `HEADLESS: false` to watch the scraper and debug issues
- Set `HEADLESS: true` for production runs
- Adjust delays if you encounter rate limiting
- The scraper handles pagination automatically
- Results are saved incrementally so you can stop/resume

## Troubleshooting

**TripAdvisor blocks the scraper:**
- Increase delays between requests
- Use a VPN or proxy
- Run during off-peak hours

**Selectors not working:**
- TripAdvisor may have changed their HTML structure
- Check the browser console for errors
- Update selectors in the code

**Missing reviews:**
- Some hotels limit review access
- TripAdvisor may require login for full review access
- The scraper gets publicly available reviews only

## Legal Notice

This scraper is for educational purposes only. Make sure to:
- Respect TripAdvisor's Terms of Service
- Implement appropriate rate limiting
- Not use scraped data for commercial purposes without permission
- Check robots.txt and comply with website policies

## License

MIT
# tripadvisorscrape

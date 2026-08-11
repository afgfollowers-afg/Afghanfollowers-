// Helper: discover new SMM panels via Google Custom Search API.
// Requires GOOGLE_CSE_API_KEY and GOOGLE_CSE_ID env vars; returns [] if absent.
async function discoverPanelsViaSearch() {
  const apiKey = process.env.GOOGLE_CSE_API_KEY;
  const cseId = process.env.GOOGLE_CSE_ID;
  if (!apiKey || !cseId) return [];
  const queries = [
    'SMM panel reseller API wholesale followers likes services cheapest',
    'best smm panel api v2 instagram tiktok youtube followers reseller'
  ];
  const domains = new Set();
  for (const q of queries) {
    try {
      const r = await fetch(
        'https://www.googleapis.com/customsearch/v1?key=' + encodeURIComponent(apiKey) +
        '&cx=' + encodeURIComponent(cseId) + '&q=' + encodeURIComponent(q) + '&num=10',
        { signal: AbortSignal.timeout ? AbortSignal.timeout(8000) : undefined }
      );
      if (!r.ok) continue;
      const data = await r.json();
      (data.items || []).forEach(item => {
        try {
          const host = new URL(item.link).hostname.replace(/^www\./, '');
          const skip = ['google.', 'youtube.', 'facebook.', 'twitter.', 'reddit.', 'wikipedia.', 'instagram.', 'tiktok.'];
          if (host && !skip.some(s => host.includes(s))) domains.add(host);
        } catch (e) {}
      });
    } catch (e) {}
  }
  return Array.from(domains).map(h => ({ name: h, url: 'https://' + h + '/api/v2' }));
}

module.exports = { discoverPanelsViaSearch };

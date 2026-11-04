// GET /api/trends: the trending topics the AI scanner works from (see _trends.js). CDN cached for 10 minutes.
const { trends } = require('./_trends');

module.exports = async (req, res) => {
  try {
    const data = await trends();
    res.setHeader('content-type', 'application/json');
    res.setHeader('cache-control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600');
    res.end(JSON.stringify(data));
  } catch (e) {
    res.statusCode = 503; res.setHeader('content-type', 'application/json'); res.setHeader('cache-control', 'no-store');
    res.end(JSON.stringify({ error: e.message }));
  }
};

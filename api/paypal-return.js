// Vercel Serverless Function — Accepts PayPal's Auto Return callback
// (which can be a POST request) and redirects the browser to the panel.
// Static .html files on Vercel only accept GET/HEAD, so PayPal's POST-based
// return was failing with 405. This function accepts ANY method and issues
// a proper redirect that the browser follows with a normal GET.

module.exports = async (req, res) => {
  const params = req.query || {};
  const qs = new URLSearchParams();
  qs.set('pp', 'done');
  Object.keys(params).forEach((k) => {
    if (k !== 'pp') qs.set(k, params[k]);
  });
  res.writeHead(302, { Location: '/smm-panel.html?' + qs.toString() });
  res.end();
};

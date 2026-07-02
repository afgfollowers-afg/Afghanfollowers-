// Vercel Serverless Function — Accepts PayPal's cancel return (POST or GET)
// and redirects to the panel with pp=cancel.

module.exports = async (req, res) => {
  res.writeHead(302, { Location: '/smm-panel.html?pp=cancel' });
  res.end();
};

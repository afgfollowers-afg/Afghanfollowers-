module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Content-Type', 'application/json');
  
  const BIN_ID = process.env.JSONBIN_BIN_ID;
  const API_KEY = process.env.JSONBIN_API_KEY;

  console.log('🔍 Test JSONBin Connection');
  console.log('BIN_ID:', BIN_ID ? '✅ SET' : '❌ MISSING');
  console.log('API_KEY:', API_KEY ? '✅ SET' : '❌ MISSING');

  if (!BIN_ID || !API_KEY) {
    return res.status(500).json({
      error: 'JSONBin not configured',
      binId: !!BIN_ID,
      apiKey: !!API_KEY
    });
  }

  try {
    const response = await fetch(`https://api.jsonbin.io/v3/b/${BIN_ID}`, {
      method: 'GET',
      headers: {
        'X-Master-Key': API_KEY,
        'Content-Type': 'application/json'
      },
      timeout: 5000
    });

    console.log('Response status:', response.status);
    const text = await response.text();
    console.log('Response size:', text.length);

    return res.status(200).json({
      success: response.ok,
      status: response.status,
      message: response.ok ? 'JSONBin connection successful' : 'JSONBin returned error',
      bodySize: text.length,
      preview: text.slice(0, 100)
    });
  } catch (err) {
    console.error('Error:', err.message);
    return res.status(500).json({
      error: err.message,
      code: err.code
    });
  }
};

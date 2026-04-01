const https = require('https');

const SUPA_URL = process.env.SUPABASE_URL || 'https://reppeednqlrrbjlbujhq.supabase.co';
const SUPA_KEY = process.env.SUPABASE_KEY;

function supabaseRpc(fnName, params) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(params);
    const url = new URL(`${SUPA_URL}/rest/v1/rpc/${fnName}`);
    const req = https.request(url, {
      method: 'POST',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(body));
        resolve(JSON.parse(body));
      });
    });
    req.on('error', reject);
    req.write(data);
    req.end();
  });
}

function supabaseGet(table, query) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${SUPA_URL}/rest/v1/${table}?${query}`);
    const req = https.request(url, {
      method: 'GET',
      headers: {
        'apikey': SUPA_KEY,
        'Authorization': `Bearer ${SUPA_KEY}`,
      },
    }, (res) => {
      let body = '';
      res.on('data', (c) => body += c);
      res.on('end', () => {
        if (res.statusCode >= 400) return reject(new Error(body));
        resolve(JSON.parse(body));
      });
    });
    req.on('error', reject);
    req.end();
  });
}

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    return res.status(405).json({ success: false, error: 'Method not allowed' });
  }

  const { q, year } = req.query;

  if (!q || q.trim().length < 2) {
    return res.status(400).json({ success: false, error: 'Параметр q обов\'язковий (мінімум 2 символи)' });
  }

  try {
    const params = { search_query: q.trim() };
    if (year && year !== 'all') params.year_filter = year;

    const results = await supabaseRpc('search_households', params);

    // Fetch members for each household
    const householdIds = [...new Set(results.map(r => r.household_id))];
    let members = [];
    if (householdIds.length > 0) {
      members = await supabaseGet('household_members',
        `household_id=in.(${householdIds.join(',')})&select=household_id,full_name,birth_year,relation`
      );
    }

    const membersByHousehold = {};
    for (const m of members) {
      if (!membersByHousehold[m.household_id]) membersByHousehold[m.household_id] = [];
      membersByHousehold[m.household_id].push(m);
    }

    const enriched = results.map(r => ({
      ...r,
      members: membersByHousehold[r.household_id] || [],
    }));

    res.json({ success: true, count: enriched.length, results: enriched });
  } catch (err) {
    res.status(500).json({ success: false, error: err.message });
  }
};

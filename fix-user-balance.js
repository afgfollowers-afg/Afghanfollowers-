#!/usr/bin/env node
// One-off balance repair for a user whose transactions array was wiped.
// Usage:
//   JSONBIN_BIN_ID=xxx JSONBIN_API_KEY=xxx AUTH_JWT_SECRET=xxx \
//   node fix-user-balance.js [--dry-run]
//
// With --dry-run it only prints what it would do, without writing anything.
// Without --dry-run it writes the corrected user record to the database.

const crypto = require('crypto');
const TARGET_USER_ID = '1785229396421';  // Julian J — boekoeeee@gmail.com

const BIN_ID  = process.env.JSONBIN_BIN_ID;
const API_KEY = process.env.JSONBIN_API_KEY;
const SECRET  = process.env.AUTH_JWT_SECRET;
const DRY_RUN = process.argv.includes('--dry-run');

if (!BIN_ID || !API_KEY || !SECRET) {
  console.error('Missing env vars. Set JSONBIN_BIN_ID, JSONBIN_API_KEY, AUTH_JWT_SECRET.');
  process.exit(1);
}

const BASE = 'https://api.jsonbin.io/v3/b/';

async function readBin() {
  const r = await fetch(BASE + BIN_ID + '/latest?_=' + Date.now(), {
    headers: { 'X-Master-Key': API_KEY, 'Cache-Control': 'no-cache' }
  });
  const j = await r.json();
  if (!r.ok || !j.record) throw new Error('readBin failed: ' + JSON.stringify(j).slice(0,200));
  return j.record;
}

async function writeBin(record) {
  const r = await fetch(BASE + BIN_ID, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'X-Master-Key': API_KEY },
    body: JSON.stringify(record)
  });
  if (!r.ok) throw new Error('writeBin failed: ' + (await r.text()).slice(0,200));
}

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g,'-').replace(/\//g,'_').replace(/=+$/,'');
}

function signAdminToken() {
  const now = Math.floor(Date.now()/1000);
  const header = base64url(JSON.stringify({alg:'HS256',typ:'JWT'}));
  const payload = base64url(JSON.stringify({sub:'fix-script',role:'admin',iat:now,exp:now+300}));
  const sig = crypto.createHmac('sha256', SECRET).update(header+'.'+payload).digest();
  return header + '.' + payload + '.' + base64url(sig);
}

(async () => {
  console.log('Reading database…');
  const db = await readBin();

  const user = (db.smm_users||[]).find(u => String(u.id) === TARGET_USER_ID);
  if (!user) { console.error('User not found in database!'); process.exit(1); }

  console.log('\n── Current user record ──────────────────────────────');
  console.log(`  Name:         ${user.fname} ${user.lname}`);
  console.log(`  Email:        ${user.email}`);
  console.log(`  Balance:      $${parseFloat(user.balance||0).toFixed(2)}`);
  console.log(`  Transactions: ${(user.transactions||[]).length} entries`);
  console.log(`  Orders:       ${user.orders||0}`);

  // Find all orders for this user
  const orders = (db.smm_orders||[])
    .filter(o => String(o.userId||o.user_id) === TARGET_USER_ID)
    .sort((a,b) => (a.date||a.id) < (b.date||b.id) ? -1 : 1);

  console.log('\n── Orders for this user ─────────────────────────────');
  let totalSpent = 0;
  if (!orders.length) {
    console.log('  (no orders found)');
  } else {
    orders.forEach((o,i) => {
      const cost = parseFloat(o.cost||o.totalCost||0);
      totalSpent += cost;
      console.log(`  ${i+1}. [${o.date||o.id}] ${o.svcName||o.service} × ${o.qty}  → $${cost.toFixed(4)}  status:${o.status}`);
    });
    console.log(`  Total spent: $${totalSpent.toFixed(4)}`);
  }

  // Reconstruct from existing transactions (might be empty)
  const txns = user.transactions||[];
  let creditFromTx = 0, debitFromTx = 0;
  txns.forEach(t => {
    const amt = parseFloat(t.amount||0);
    if (['deposit','admin_credit','bonus','refund'].includes(t.type) && t.status==='approved') creditFromTx += amt;
    if (['spend','withdrawal','admin_debit'].includes(t.type)) debitFromTx += amt;
  });

  console.log('\n── Analysis ─────────────────────────────────────────');
  console.log(`  Credits from transactions:  $${creditFromTx.toFixed(2)}`);
  console.log(`  Debits  from transactions:  $${debitFromTx.toFixed(2)}`);
  console.log(`  Total spent on orders:      $${totalSpent.toFixed(4)}`);
  console.log(`  Current balance on server:  $${parseFloat(user.balance||0).toFixed(2)}`);

  if (txns.length === 0 && orders.length === user.orders) {
    console.log('\n  ⚠️  Transactions array is empty — history was wiped.');
    console.log(`  ⚠️  User placed ${orders.length} orders totalling $${totalSpent.toFixed(4)}.`);
    console.log('  ⚠️  To restore balance we need to know the original deposit amount.');
    console.log('       Check Telegram notifications for this user\'s deposit.');
    console.log('       Then rerun with: DEPOSIT_AMOUNT=<amount> node fix-user-balance.js');
  }

  // If DEPOSIT_AMOUNT env var is set, apply the fix
  const depositAmt = parseFloat(process.env.DEPOSIT_AMOUNT||0);
  if (!depositAmt) {
    console.log('\n  Set DEPOSIT_AMOUNT=<number> to apply the fix (e.g. DEPOSIT_AMOUNT=20).');
    return;
  }

  const correctBalance = parseFloat((depositAmt - totalSpent).toFixed(4));
  console.log(`\n── Fix to apply ─────────────────────────────────────`);
  console.log(`  Deposit:          $${depositAmt.toFixed(2)}`);
  console.log(`  Spent on orders:  $${totalSpent.toFixed(4)}`);
  console.log(`  Correct balance:  $${correctBalance.toFixed(2)}`);

  if (correctBalance < 0) {
    console.error('\n  ❌ Correct balance is negative — check DEPOSIT_AMOUNT.');
    process.exit(1);
  }

  if (DRY_RUN) {
    console.log('\n  [DRY RUN] Would write corrected user with:');
    console.log(`    balance: ${correctBalance}`);
    console.log('    transactions: [admin_credit for deposit + spend entries for each order]');
    return;
  }

  // Build restored transactions
  const now = Date.now();
  const restoredTx = [
    {
      id: parseInt(user.id) + 1,
      type: 'admin_credit',
      amount: depositAmt,
      credit: depositAmt,
      desc: 'Balance restore (deposit record reconstructed from order history)',
      date: user.joined || new Date().toISOString(),
      status: 'approved'
    },
    ...orders.map((o,i) => ({
      id: parseInt(user.id) + 10 + i,
      type: 'spend',
      amount: parseFloat(o.cost||o.totalCost||0),
      desc: 'Order: ' + (o.svcName||o.service||'service'),
      date: o.date || new Date().toISOString(),
      status: 'approved'
    }))
  ];

  const fixedUser = Object.assign({}, user, {
    balance: correctBalance,
    transactions: restoredTx
  });

  // Write back — replace the user in smm_users array
  db.smm_users = (db.smm_users||[]).map(u => String(u.id) === TARGET_USER_ID ? fixedUser : u);
  db.smm_ts = Date.now();

  console.log('\n  Writing to database…');
  await writeBin(db);
  console.log('  ✅ Done. User balance set to $' + correctBalance.toFixed(2));
  console.log('     Reconstructed ' + restoredTx.length + ' transactions.');
})().catch(e => { console.error('Error:', e.message); process.exit(1); });

const { createHash } = require('crypto');
const { resolveOrderProvider } = require('./_order-provider');

function dispatchFingerprint(order, snapshot = {}) {
  const services = snapshot.svcList || [];
  const row = order.svcId && order.provId
    ? services.find(s => String(s[1]) === String(order.svcId) && String(s[5]) === String(order.provId))
    : services.find(s => s[2] === order.svcName || s[2] === order.svc || s[3] === order.svcName);
  const provider = resolveOrderProvider(snapshot.providers || [], order.provId || (row && row[5]));
  // Only dispatch inputs participate. Balance refreshes, unrelated providers
  // and error timestamps must not restart a permanently rejected order.
  const inputs = [order.svcId, order.provId, order.svcName, order.svc, order.link, order.qty,
    row || null, provider ? [provider.id, provider.url, provider.key] : null];
  return createHash('sha256').update(JSON.stringify(inputs)).digest('hex');
}

function isPermanentDispatchError(message) {
  return /^(Service not found in catalog|Provider config not found)$/i.test(String(message))
    || /quantity.*(?:less than|minim|more than|maxim|invalid|too (?:low|high))/i.test(String(message))
    || /invalid quantity/i.test(String(message));
}

function sameFailure(previous, message, fingerprint) {
  return !!previous && previous.message === message && previous.fingerprint === fingerprint;
}
function dispatchAlertKey(message, incident) {
  return 'smm_dispatch_alert_v1:' + createHash('sha256')
    .update(JSON.stringify(['dispatch', message, incident])).digest('hex');
}
module.exports = { dispatchFingerprint, isPermanentDispatchError, sameFailure, dispatchAlertKey };

// Provider order IDs are scoped to a provider, never globally unique.
function resolveOrderProvider(providers, providerId) {
  const configured = Array.isArray(providers) ? providers : [];
  const hasId = providerId !== undefined && providerId !== null && String(providerId) !== '';
  if (hasId) return configured.find(p => String(p.id) === String(providerId)) || null;
  // Legacy orders without an ID are unambiguous only with one provider.
  return configured.length === 1 ? configured[0] : null;
}
module.exports = { resolveOrderProvider };

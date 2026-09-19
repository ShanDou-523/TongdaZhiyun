// Future order module contract. No payment or order endpoint is enabled yet.
const TRANSITIONS = Object.freeze({
  draft: ['submitted', 'cancelled'],
  submitted: ['accepted', 'cancelled'],
  accepted: ['in_service', 'cancelled'],
  in_service: ['completed'],
  completed: [],
  cancelled: []
});
function validateOrderDraft(input) {
  if (!input || !['laundry', 'housekeeping'].includes(input.category)) throw new Error('Invalid service category');
  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 50) throw new Error('Invalid items');
  for (const item of input.items) {
    if (typeof item.serviceId !== 'string' || !item.serviceId || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99) throw new Error('Invalid service item');
  }
  // Client may submit quantities, never authoritative prices or order status.
  return { category: input.category, items: input.items.map(({ serviceId, quantity }) => ({ serviceId, quantity })) };
}
function canTransition(from, to) { return (TRANSITIONS[from] || []).includes(to); }
module.exports = { TRANSITIONS, validateOrderDraft, canTransition };

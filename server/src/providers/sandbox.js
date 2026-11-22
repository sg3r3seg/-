'use strict';
const config = require('../config');
// Development/test provider. No money moves. Refused in production by config.js.
module.exports = {
  name: 'sandbox',
  isConfigured: () => !config.production,
  async createCheckout(order) {
    return { checkoutUrl: `${config.publicUrl}/checkout-sandbox.html#order=${encodeURIComponent(order.id)}`, providerRef: `sbx_${order.id}` };
  },
};

'use strict';
const config = require('../config');
// Payment providers. Licenses are only ever created from a server-side
// confirmation (provider webhook / API), never from a client redirect.
const providers = {
  sandbox: require('./sandbox'),
  stripe: require('./stripe'),
};
function active() {
  const p = providers[config.payments.provider];
  if (!p) throw new Error(`Unknown PAYMENT_PROVIDER ${config.payments.provider}`);
  return p;
}
module.exports = { active, providers };

'use strict';
const express = require('express');
const fs = require('node:fs');
const path = require('node:path');
const config = require('../config');
const { h } = require('../http');

const r = express.Router();
const cmp = (a, b) => {
  const pa = String(a).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  const pb = String(b).split(/[.-]/).map((x) => parseInt(x, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) if ((pa[i] || 0) !== (pb[i] || 0)) return (pa[i] || 0) - (pb[i] || 0);
  return 0;
};

// Returns the signed release manifest produced by scripts/publish-release.js.
r.get('/latest', h(async (req, res) => {
  const file = path.join(config.releasesDir, 'latest.json');
  if (!fs.existsSync(file)) return res.json({ available: false, reason: 'NO_RELEASE_PUBLISHED' });
  const rel = JSON.parse(fs.readFileSync(file, 'utf8'));
  const current = String(req.query.current || '0.0.0');
  res.json({ available: cmp(rel.manifest.version, current) > 0, ...rel });
}));

r.use('/files', express.static(path.join(config.releasesDir, 'files'), { fallthrough: false, index: false, dotfiles: 'deny' }));
module.exports = r;

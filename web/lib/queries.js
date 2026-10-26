const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const read = name => readFileSync(join(__dirname, '../sql', name), 'utf8');
const base = read('demand-base.sql');
module.exports = { demand: base + read('dog-demand.sql'), accessibility: base + read('dog-accessibility.sql'), schema: read('map-aggregates-schema.sql') };

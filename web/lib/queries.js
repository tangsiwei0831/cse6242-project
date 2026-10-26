const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const read = name => readFileSync(join(__dirname, '../sql', name), 'utf8');
const base = read('demand-base.sql');
const accessBase = base + read('accessibility-base.sql');
const accessOutput = read('dog-accessibility.sql').trim().replace(/;$/, '');
module.exports = {
  demand: base + read('dog-demand.sql'),
  accessibility: accessBase + accessOutput + ';',
  candidates: accessBase + ', accessibility_payload AS (\n' + accessOutput + '\n)\n' + read('candidate-parks.sql'),
  schema: read('map-aggregates-schema.sql')
};

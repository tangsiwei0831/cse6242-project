const { test } = require('node:test');
const assert = require('node:assert/strict');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const vm = require('node:vm');

test('switching map layers preserves demand metrics and distinguishes zero from missing', async () => {
  const d3 = await import('d3');
  // Exercise rendering with real D3 scales and a small DOM adapter. Browser
  // layout, pointer delivery, and zoom behavior still require a browser smoke test.
  const element = () => ({ hidden: false, style: {}, children: [], textContent: '',
    append(child) { this.children.push(child); },
    replaceChildren() { this.children = []; },
    offsetWidth: 250, offsetHeight: 150,
    getBoundingClientRect: () => ({ left: 0, top: 0, width: 800, height: 600 }) });
  const nodes = new Map(['demand-tooltip','demand-toggle','map-layer','demand-metric-control',
    'accessibility-note','demand-metric','demand-legend','demand-status','demand-quality'].map(id => ['#' + id, element()]));
  nodes.set('.map-panel', element());
  nodes.get('#demand-toggle').checked = true;
  nodes.get('#map-layer').value = 'demand';
  nodes.get('#demand-metric').value = 'demandPer1000Units';
  const ntas = [
    { id: 'A', estimatedDemand: 500, demandPer1000Units: 50, accessibilityTotalDemand: 500,
      coveredDemand: 400, uncoveredDemand: 100, coveragePercentage: 80, flags: {} },
    { id: 'Z', estimatedDemand: 0, demandPer1000Units: 0, accessibilityTotalDemand: 0,
      coveredDemand: 0, uncoveredDemand: 0, coveragePercentage: null, flags: {} },
    { id: 'M', estimatedDemand: null, demandPer1000Units: null, accessibilityTotalDemand: null,
      coveredDemand: null, uncoveredDemand: null, coveragePercentage: null, flags: {} }
  ];
  let fills;
  const context = vm.createContext({ d3, Intl,
    document: { querySelector: id => nodes.get(id), createElement: element },
    demandData: { ntas, summary: {} }, demandByNta: new Map(ntas.map(n => [n.id, n])),
    accessibilityData: { ntas, summary: {}, accessibilitySummary: {} },
    accessibilityByNta: new Map(ntas.map(n => [n.id, n])),
    layerStatus: { demand: 'Ready', accessibility: 'Ready' }, layerRequests: { demand: 0, accessibility: 0 },
    neighborhoodLayer: { selectAll: () => ({ style: (_, fill) => { fills = ntas.map(fill); } }) }
  });
  const source = readFileSync(join(__dirname, '../public/app.js'), 'utf8');
  vm.runInContext(source.slice(source.indexOf('const demandFormat'), source.indexOf('async function loadDemand')), context);
  const render = () => vm.runInContext('renderDemand()', context);
  render();
  assert.equal(nodes.get('#demand-metric-control').hidden, false);
  const demandFill = fills[0];
  assert.deepEqual(fills.slice(1), ['#fffdf8', '#c4c8cc']);
  nodes.get('#map-layer').value = 'accessibility';
  render();
  assert.equal(nodes.get('#demand-metric-control').hidden, true);
  assert.equal(nodes.get('#accessibility-note').hidden, false);
  assert.equal(fills[0], demandFill); // Both are at the maximum of their own scale.
  assert.deepEqual(fills.slice(1), ['#fffdf8', '#c4c8cc']);
  assert.match(nodes.get('#demand-legend').children[1].textContent, /800m.*not walking/);
  vm.runInContext("showDemandTooltip({clientX:100,clientY:100}, {id:'A',properties:{name:'Alpha'}})", context);
  assert.match(nodes.get('#demand-tooltip').textContent, /Covered \(≤800m\): 400/);
  assert.match(nodes.get('#demand-tooltip').textContent, /Uncovered \(>800m\): 100/);
  assert.match(nodes.get('#demand-tooltip').textContent, /coverage: 80%/);
  vm.runInContext("showDemandTooltip({clientX:100,clientY:100}, {id:'Z',properties:{name:'Zero'}})", context);
  assert.match(nodes.get('#demand-tooltip').textContent, /N\/A \(zero or missing demand\)/);
  nodes.get('#demand-toggle').checked = false;
  render();
  assert.ok(fills.every(fill => fill === null));
  assert.equal(nodes.get('#demand-legend').hidden, true);
  assert.equal(nodes.get('#demand-tooltip').hidden, true);
  nodes.get('#demand-toggle').checked = true;
  nodes.get('#map-layer').value = 'demand';
  render();
  assert.equal(nodes.get('#demand-metric').value, 'demandPer1000Units');
  assert.equal(nodes.get('#demand-metric-control').hidden, false);
  let resolveAccess;
  context.fetch = async url => url.includes('accessibility') ? new Promise(resolve => { resolveAccess = resolve; }) :
    { ok: true, json: async () => ({ ntas, summary: {}, metadata: { computedAt: '2026-01-01T00:00:00Z' } }) };
  const pending = vm.runInContext("loadLayer('accessibility', '/api/dog-accessibility')", context);
  await vm.runInContext("loadLayer('demand', '/api/dog-demand')", context);
  assert.match(nodes.get('#demand-status').textContent, /Prepared/);
  assert.ok(fills[0]); // Demand renders while access is pending.
  resolveAccess({ ok: false, json: async () => ({ status: 'stale' }) });
  await pending;
  assert.match(nodes.get('#demand-status').textContent, /Prepared/);
  nodes.get('#map-layer').value = 'accessibility';
  render();
  assert.match(nodes.get('#demand-status').textContent, /Source data changed/);
  assert.equal(nodes.get('#demand-legend').hidden, true);
  nodes.get('#map-layer').value = 'demand';
  render();
  assert.equal(nodes.get('#demand-legend').hidden, false);
});

test('existing dog-run borough and name/ZIP filters remain independent of choropleth layers', () => {
  const source = readFileSync(join(__dirname, '../public/app.js'), 'utf8');
  const state = { borough: 'ALL', query: '', runs: [
    { properties: { borough: 'M', name: 'Alpha Run', zipcode: '10001' } },
    { properties: { borough: 'Q', name: 'Beta Run', zipcode: '11375' } }
  ] };
  const context = vm.createContext({ state });
  vm.runInContext(source.slice(source.indexOf('function filteredRuns()'), source.indexOf('function renderFilters()')), context);
  const count = () => vm.runInContext('filteredRuns().length', context);
  assert.equal(count(), 2);
  state.borough = 'M';
  assert.equal(count(), 1);
  state.query = '11375';
  assert.equal(count(), 0);
  state.borough = 'ALL';
  assert.equal(count(), 1);
  state.query = '  ALPHA  ';
  assert.equal(count(), 1);
});

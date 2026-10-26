const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { readFileSync } = require('node:fs');
const { join } = require('node:path');
const source = readFileSync(join(__dirname,'../public/candidates.js'),'utf8');

test('candidate selection shows rank/gain/warnings and keeps global ranks under borough filtering', async () => {
  const d3 = await import('d3');
  const elements = new Map();
  const element = () => ({ hidden:true, textContent:'', children:[], replaceChildren(){this.children=[];},append(c){this.children.push(c);} });
  const document = { querySelector(id) { if(!elements.has(id))elements.set(id,element());return elements.get(id);}, createElement:element };
  const candidates = Array.from({length:12},(_,i)=>({id:'P'+i,rank:i+1,name:'Park '+i,borough:i%2?'Queens':'Brooklyn',
    incrementalDemand:100-i,longitude:-74,latitude:40,flags:{hypothetical:true,geometryRepaired:i===0,uncertainSpatialOverlap:i===0}}));
  const context = vm.createContext({ document,d3,Intl,
    candidateNumber:new Intl.NumberFormat('en-US',{maximumFractionDigits:1}),
    candidateState:{ data:{candidates}, selected:null },
    state:{borough:'ALL',selected:95},boroughNames:{B:'Brooklyn',Q:'Queens'},detail:{hidden:false},
    render:()=>{},projection:([x,y])=>[x,y]
  });
  vm.runInContext(source.slice(source.indexOf('function candidateWarnings'),source.indexOf('function renderCandidates')),context);
  vm.runInContext(source.slice(source.indexOf('function selectCandidate'),source.indexOf('async function loadCandidates')),context);
  assert.equal(vm.runInContext('filteredCandidates().slice(0,10).length',context),10);
  context.state.borough='Q';
  assert.deepEqual(Array.from(vm.runInContext('filteredCandidates().map(c=>c.rank)',context)),[2,4,6,8,10,12]);
  context.candidate = candidates[0];
  vm.runInContext('selectCandidate(candidate,false)',context);
  assert.equal(context.candidateState.selected,'P0');
  assert.equal(context.state.selected,null);
  assert.equal(context.detail.hidden,true);
  assert.equal(elements.get('#candidate-detail').hidden,false);
  assert.equal(elements.get('#candidate-rank').textContent,'#1 citywide');
  assert.equal(elements.get('#candidate-gain').textContent,'100');
  assert.match(elements.get('#candidate-warnings').children.map(e=>e.textContent).join(' '),/repaired.*intersects/);
  let centered;
  context.svg = {
    node:()=>({clientWidth:800,clientHeight:600}),
    transition(){return this;}, duration(){return this;},
    call(handler,value){handler(this,value);return this;}
  };
  context.zoom = {transform:(_selection,value)=>{centered=value;}};
  vm.runInContext('selectCandidate(candidate,true)',context);
  assert.equal(centered.k,5);
  assert.deepEqual(centered.apply(context.projection([candidates[0].longitude,candidates[0].latitude])),[400,300]);
  vm.runInContext('clearCandidateSelection()',context);
  assert.equal(context.candidateState.selected,null);
  assert.equal(elements.get('#candidate-detail').hidden,true);
});

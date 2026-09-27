const assert = require('node:assert/strict');
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { analyzeOwnerThresholds } = require('../apps/web/src/lib/liveSafe.ts');
const { validateImport, readSafeSnapshot } = require('../apps/web/src/services/safeIngestion.ts');
const addr = n => '0x'+n.toString(16).padStart(40,'0');
const safe = (owners, threshold, balanceRaw='0') => ({address:addr(100), owners:owners.map(addr),threshold,balanceRaw});
describe('read-only Safe import boundaries and owner model', () => {
  it('counts zero-balance Safes and finds overlap and majority by wallet count', () => {
    const result=analyzeOwnerThresholds([safe([1,2,3],2),safe([1,2,4],2),safe([4,5,6],2)]);
    assert.equal(result.minimumAll,4); assert.equal(result.minimumMajority,2);
    assert.deepEqual(result.overlap,[addr(1),addr(2),addr(4)]); assert.equal(result.totalBalanceRaw,'0');
    assert.equal(result.allWitness.length,4);
  });
  it('sums exact wei and limits exhaustive search without losing overlap', () => {
    const result=analyzeOwnerThresholds([safe(Array.from({length:13},(_,i)=>i+1),2,'9007199254740993000'),safe([1,2],1,'1')]);
    assert.equal(result.minimumAll,null); assert.equal(result.exact,false);
    assert.equal(result.totalBalanceRaw,'9007199254740993001'); assert.equal(result.overlap.length,2);
  });
  it('rejects URL injection, duplicates, malformed addresses and unsupported counts', () => {
    assert.throws(()=>validateImport('http://evil.test',[addr(1),addr(2)]),/supported/);
    assert.throws(()=>validateImport('sepolia',[addr(1),addr(1)]),/different/);
    assert.throws(()=>validateImport('base',['nope',addr(1)]),/valid/);
    assert.throws(()=>validateImport('base',[addr(1)]),/between/);
    assert.throws(()=>validateImport('base',Array.from({length:6},(_,i)=>addr(i+1))),/between/);
    assert.deepEqual(validateImport('base',[addr(1),addr(2)]).addresses,[addr(1),addr(2)]);
  });
  it('rejects wrong chain and non-Safe contracts before interpreting authority', async () => {
    await assert.rejects(readSafeSnapshot('base',[addr(1),addr(2)],async()=> '0x1'),/wrong chain/);
    const methods=[];
    await assert.rejects(readSafeSnapshot('base',[addr(1),addr(2)],async(method)=>{
      methods.push(method); if(method==='eth_chainId') return '0x2105';
      if(method==='eth_getBlockByNumber') return {number:'0x1',hash:'0xabc'};
      if(method==='eth_getCode') return '0x6000'; throw Error('Unexpected call');
    }),/recognized Safe/);
    assert.deepEqual(methods,['eth_chainId','eth_getBlockByNumber','eth_getCode']);
  });
});

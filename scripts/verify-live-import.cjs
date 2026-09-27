// Optional read-only live smoke check. Never submits transactions.
const fs = require('node:fs');
const ts = require('typescript');
require.extensions['.ts'] = (module, filename) => module._compile(ts.transpileModule(fs.readFileSync(filename, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText, filename);
const { ingestSafes } = require('../apps/web/src/services/safeIngestion.ts');
const network = process.argv[2] || 'local';
(async () => {
  let addresses = process.argv.slice(3);
  if (!addresses.length && network === 'local') {
    const current=await (await fetch('http://127.0.0.1:3000/api/scenario/snapshot')).json();
    addresses=current.positions.map(p=>p.controller.address);
  } else if (!addresses.length) {
    throw new Error('Supply 2–5 initialized Safe addresses after the network name, or use local.');
  }
  console.log('Reading',network,addresses);
  const result=await ingestSafes(network,addresses);
  console.log(JSON.stringify(result,null,2));
})().catch(e=>{console.error(e.message);process.exitCode=1;});

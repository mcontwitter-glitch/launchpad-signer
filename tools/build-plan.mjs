// Builds plan.js from the UNSIGNED plan JSON produced by multichain-dashboard/scripts/lp-mainnet-plan.mjs.
// Adds per-step on-chain "done" checks. Read-only; signs nothing.
// Usage: node tools/build-plan.mjs /tmp/lp-plan-base.json
import fs from 'node:fs';
const V = '/workspace/multichain-dashboard/node_modules/viem/_esm/index.js';
const { encodeFunctionData, encodeAbiParameters, keccak256, parseAbi, decodeFunctionData, createPublicClient, http, getContractAddress } = await import(V);
const plan = JSON.parse(fs.readFileSync(process.argv[2] || '/tmp/lp-plan-base.json', 'utf8'));
const B = plan.chains.base, P = B.predicted, D = plan.deployer;
const A = parseAbi(['function owner() view returns (address)', 'function pendingOwner() view returns (address)', 'function omniImplementation() view returns (address)', 'function omniEscrow() view returns (address)', 'function factory() view returns (address)', 'function peers(uint32) view returns (bytes32)', 'function delegates(address) view returns (address)', 'function getConfig(address,address,uint32,uint32) view returns (bytes)', 'function getTimestamp(bytes32) view returns (uint256)', 'function setConfig(address oapp, address lib, (uint32 eid, uint32 configType, bytes config)[] params)', 'function setPeer(uint32,bytes32)', 'function schedule(address,uint256,bytes,bytes32,bytes32,uint256)', 'function execute(address,uint256,bytes,bytes32,bytes32)']);
const call = (to, fn, args = []) => ({ to, data: encodeFunctionData({ abi: A, functionName: fn, args }) });
const addr32 = a => '0x' + a.slice(2).toLowerCase().padStart(64, '0');
const bytesRet = b => encodeAbiParameters([{ type: 'bytes' }], [b]).toLowerCase();
const EIDS = { 30101: 'Ethereum', 30102: 'BNB Chain', 30312: 'ApeChain', 30416: 'Robinhood Chain' };
let opId;
const steps = B.txs.map((t, i) => {
  const s = { step: t.step, to: t.to, data: t.data, value: t.value, note: t.note, expectedNonce: Number(B.deployerNonce) + i };
  const n = t.note;
  if (i < 5) { const key = ['timelock', 'dropImpl', 'omniDropImpl', 'omniEscrow', 'factory'][i]; s.creates = P[key];
    s.label = ['Deploy the Timelock (48h delay; your wallet is proposer + executor)', 'Deploy the Drop implementation', 'Deploy the Omni Drop implementation', 'Deploy the Omni Escrow (LayerZero; 0.0001 ETH move fee)', 'Deploy the Launchpad Factory (approver = your wallet, 0.5% fee)'][i];
    s.check = { type: 'code', to: P[key] }; }
  else if (n.startsWith('factory.setOmni')) { s.label = 'Factory: link Omni Drop impl + Escrow'; s.check = { type: 'all', of: [{ ...call(P.factory, 'omniImplementation'), expect: addr32(P.omniDropImpl) }, { ...call(P.factory, 'omniEscrow'), expect: addr32(P.omniEscrow) }] }; }
  else if (n.startsWith('escrow.setFactory')) { s.label = 'Escrow: link the Factory'; s.check = { type: 'eq', ...call(P.omniEscrow, 'factory'), expect: addr32(P.factory) }; }
  else if (n.startsWith('escrow.setPeer')) { const { args } = decodeFunctionData({ abi: A, data: t.data }); s.label = `Escrow: set ${EIDS[args[0]]} peer (eid ${args[0]}) -> ${'0x' + args[1].slice(26)}`; s.peerEid = Number(args[0]); s.peer = '0x' + args[1].slice(26); s.check = { type: 'eq', ...call(P.omniEscrow, 'peers', [args[0]]), expect: args[1].toLowerCase() }; }
  else if (n.startsWith('endpoint.setConfig')) { const { args } = decodeFunctionData({ abi: A, data: t.data }); const send = n.includes('send lib'); const eid = args[2][0].eid;
    s.label = `LayerZero endpoint: ${send ? 'send' : 'receive'} config ${send ? 'to' : 'from'} ${EIDS[eid]} (${send ? 'executor + ' : ''}2-of-2 DVNs)`;
    s.check = { type: 'all', of: args[2].map(p => ({ ...call(args[0] === P.omniEscrow ? t.to : t.to, 'getConfig', [P.omniEscrow, args[1], p.eid, p.configType]), expect: bytesRet(p.config) })) }; }
  else if (n.startsWith('escrow.setDelegate')) { s.label = 'Escrow: make the Timelock the LayerZero delegate'; s.check = { type: 'eq', ...call(B.endpoint, 'delegates', [P.omniEscrow]), expect: addr32(P.timelock) }; }
  else if (n.startsWith('escrow.transferOwnership')) { s.label = 'Escrow: transfer ownership to the Timelock'; s.check = { type: 'eq', ...call(P.omniEscrow, 'owner'), expect: addr32(P.timelock) }; }
  else if (n.startsWith('factory.transferOwnership')) { s.label = 'Factory: start ownership transfer to the Timelock (pending until step 24)'; s.check = { type: 'any', of: [{ ...call(P.factory, 'pendingOwner'), expect: addr32(P.timelock) }, { ...call(P.factory, 'owner'), expect: addr32(P.timelock) }] }; }
  else if (n.includes('timelock.schedule')) { const { args } = decodeFunctionData({ abi: A, data: t.data });
    opId = keccak256(encodeAbiParameters([{ type: 'address' }, { type: 'uint256' }, { type: 'bytes' }, { type: 'bytes32' }, { type: 'bytes32' }], args.slice(0, 5)));
    s.label = 'Timelock (you as admin): schedule factory.acceptOwnership — starts the 48h clock'; s.opId = opId; s.check = { type: 'nonzero', ...call(P.timelock, 'getTimestamp', [opId]) }; }
  else if (n.includes('timelock.execute')) { s.label = 'Timelock (you as admin): execute factory.acceptOwnership — only after 48h'; s.opId = opId; s.check = { type: 'eq', ...call(P.factory, 'owner'), expect: addr32(P.timelock) }; }
  if (!s.label) throw Error('unlabelled step ' + t.step);
  return s;
});
// current nonces on the other chains (peers were predicted from these)
const RPC = { ethereum: ['https://ethereum-rpc.publicnode.com', 'https://etherscan.io'], bnb: ['https://bsc-rpc.publicnode.com', 'https://bscscan.com'], apechain: ['https://rpc.apechain.com/http', 'https://apescan.io'], robinhood: ['https://rpc.mainnet.chain.robinhood.com', 'https://explorer.mainnet.chain.robinhood.com'] };
const others = {};
for (const [k, [rpc, exp]] of Object.entries(RPC)) { const n = await createPublicClient({ transport: http(rpc) }).getTransactionCount({ address: D }); others[k] = { rpc, exp, nonce: n, escrow: getContractAddress({ from: D, nonce: BigInt(n + 3) }) }; }
for (const s of steps) if (s.peer) { const o = Object.values(others).find(o => o.escrow.toLowerCase() === s.peer.toLowerCase()); if (!o) throw Error('peer ' + s.peer + ' does not match current other-chain nonce prediction'); }
const gasHints = fs.existsSync('tools/gas-hints.json') ? JSON.parse(fs.readFileSync('tools/gas-hints.json', 'utf8')) : {};
for (const s of steps) s.gasHint = gasHints[s.step] || null;
const out = { generated: plan.generated, chainId: 8453, deployer: D, admin: plan.admin, feeWallet: plan.feeWallet, platformFeeBps: plan.platformFeeBps, endpoint: B.endpoint, startNonce: Number(B.deployerNonce), predicted: P, others, steps };
fs.writeFileSync('plan.js', '// AUTO-GENERATED by tools/build-plan.mjs from the unsigned lp-mainnet-plan.mjs output. No keys, no secrets.\nwindow.PLAN=' + JSON.stringify(out) + ';\n');
console.log('plan.js written', steps.length, 'steps; other-chain nonces', Object.fromEntries(Object.entries(others).map(([k, o]) => [k, o.nonce])));

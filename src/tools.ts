import { PublicKey } from '@solana/web3.js';
import { z } from 'zod';
import {
  accounts, checkedAccount, EARN, EXCHANGE, HYLO, metadata, MINTS, mintSupply,
  POOL_CONFIG, POOL_HYUSD, rpc, TOKEN_PROGRAM, units, virtualSupply,
  type Account,
} from './chain.js';

const hyloDisc = [114, 161, 169, 210, 204, 175, 149, 174];
const poolDisc = [26, 108, 14, 123, 116, 230, 129, 43];
const address = (key: PublicKey) => key.toBase58();

export async function getProtocolState() {
  const keys = [HYLO, MINTS.hyUSD, MINTS.xSOL, MINTS.eHYUSD];
  const { slot, data: [hylo, hyusd, xsol, ehyusd] } = await accounts(keys);
  checkedAccount(hylo, hyloDisc, 511);
  if (!hylo.subarray(104, 136).equals(MINTS.hyUSD.toBuffer()) ||
      !hylo.subarray(136, 168).equals(MINTS.xSOL.toBuffer())) {
    throw new Error('Hylo state mint addresses disagree with SDK PDA derivation');
  }
  if (hylo[478] > 1 || hylo[479] > 1) throw new Error('Invalid Hylo pause flag');
  return {
    ...metadata(slot, [EXCHANGE, ...keys]),
    hyUSD: { mint: address(MINTS.hyUSD), mintSupply: mintSupply(hyusd) },
    xSOL: { mint: address(MINTS.xSOL), mintSupply: mintSupply(xsol) },
    eHYUSD: { mint: address(MINTS.eHYUSD), mintSupply: mintSupply(ehyusd) },
    solPoolVirtualStablecoinSupply: virtualSupply(hylo),
    protocolPaused: hylo[478] === 1,
    solPoolPaused: hylo[479] === 1,
    scope: 'Supplies and flags only. Virtual SOL-pool supply is not total hyUSD supply; no collateral ratio or xSOL price is inferred.',
  };
}

export async function getEarnPoolState() {
  const keys = [POOL_CONFIG, POOL_HYUSD, MINTS.eHYUSD];
  const { slot, data: [config, reserve, mint] } = await accounts(keys);
  checkedAccount(config, poolDisc, 107);
  if (reserve.length !== 165 ||
      !reserve.subarray(0, 32).equals(MINTS.hyUSD.toBuffer()) ||
      reserve[108] !== 1) throw new Error('Unexpected Earn Pool SPL token account');
  if (config[52] > 1) throw new Error('Invalid Earn Pool pause flag');
  const reserveRaw = reserve.readBigUInt64LE(64);
  const supplyRaw = mint.readBigUInt64LE(36);
  const supply = mintSupply(mint);
  if (supplyRaw === 0n) throw new Error('eHYUSD supply is zero: NAV cannot be calculated');
  // SDK hylo-core/src/earn_pool_math.rs: lp_token_nav = stablecoin_in_pool / lp_token_supply, rounded up to 6 decimals.
  const navRaw = (reserveRaw * 1_000_000n + supplyRaw - 1n) / supplyRaw;
  return {
    ...metadata(slot, [EARN, ...keys]),
    hyUSDInPool: units(reserveRaw), eHYUSDSupply: supply,
    eHYUSDNavInHyUSD: units(navRaw),
    paused: config[52] === 1,
    scope: 'NAV is an onchain reserve ratio, not a market price or guaranteed redemption amount. Withdrawal fees may apply.',
  };
}

export async function getWalletExposure(wallet: string) {
  const owner = new PublicKey(wallet);
  const result = await rpc<{ context: { slot: number }; value: { pubkey: string; account: Account }[] }>(
    'getTokenAccountsByOwner', [address(owner), { programId: address(TOKEN_PROGRAM) },
      { encoding: 'base64', commitment: 'confirmed' }],
  );
  const mints = Object.entries(MINTS);
  const mintBytes = mints.map(([symbol, mint]) => [symbol, mint.toBuffer()] as const);
  const ownerBytes = owner.toBuffer();
  const tokenProgramAddress = address(TOKEN_PROGRAM);
  const matchedAccounts: string[] = [];
  const balances = Object.fromEntries(mints.map(([symbol, mint]) => [symbol, {
    mint: address(mint), balance: '0', tokenAccounts: [] as string[],
  }]));
  const totals = new Map<string, bigint>();
  for (const { pubkey, account } of result.value) {
    if (account.owner !== tokenProgramAddress || account.data[1] !== 'base64') {
      throw new Error(`Unexpected token account owner or encoding: ${pubkey}`);
    }
    const data = Buffer.from(account.data[0], 'base64');
    if (data.length < 72 || !data.subarray(32, 64).equals(ownerBytes)) continue;
    const symbol = mintBytes.find(([, mint]) => data.subarray(0, 32).equals(mint))?.[0];
    if (!symbol) continue;
    if (data.length !== 165 || data[108] !== 1) throw new Error(`Unexpected Hylo token account layout: ${pubkey}`);
    totals.set(symbol, (totals.get(symbol) ?? 0n) + data.readBigUInt64LE(64));
    balances[symbol].tokenAccounts.push(pubkey);
    matchedAccounts.push(pubkey);
  }
  for (const [symbol, amount] of totals) balances[symbol].balance = units(amount);
  return {
    ...metadata(result.context.slot, [owner, TOKEN_PROGRAM, ...Object.values(MINTS), ...matchedAccounts]),
    wallet: address(owner), balances,
    scope: 'SPL Token holdings of hyUSD, xSOL and eHYUSD only. No LP, lending, custodial or transaction-history exposure is inferred.',
  };
}

export async function explainMechanism() {
  const slot = await rpc<number>('getSlot', [{ commitment: 'confirmed' }]);
  return {
    ...metadata(slot, [EXCHANGE, EARN, HYLO, POOL_CONFIG, ...Object.values(MINTS)]),
    mechanism: [
      { statement: 'Each collateral pool splits its value between a virtual $1 stablecoin liability and a leveraged token that absorbs price moves. vUSD is accounting, not a tradable mint.', source: 'https://docs.hylo.so/protocol-overview/core-mechanism' },
      { statement: 'The xAsset net asset value is (collateral pool value minus virtual stablecoin supply) divided by xAsset supply; effective leverage changes with pool reserves and minting.', source: 'https://docs.hylo.so/protocol-overview/xassets' },
      { statement: 'hyUSD is backed by the aggregate virtual stablecoin value across pools; eHYUSD is an Earn Pool share accruing protocol yield.', source: 'https://docs.hylo.so/product-guide/stablecoin' },
    ],
    scope: 'Static description from linked docs. Slot marks the RPC check, not a fresh verification of documentation claims.',
  };
}

const walletArgs = z.object({ wallet: z.string().describe('Public Solana wallet address (base58). No wallet connection required.') });
function display(value: unknown) { return JSON.stringify(value, null, 2); }
export const tools = [
  { name: 'get_protocol_state', description: 'Read verified Hylo SPL mint supplies, SOL-pool virtual stablecoin supply and pause flags at one mainnet slot. No inferred CR or price.', parameters: z.object({}), execute: async () => display(await getProtocolState()) },
  { name: 'get_earn_pool_state', description: 'Read hyUSD Earn Pool reserve and eHYUSD supply; compute eHYUSD NAV in hyUSD from SDK formula.', parameters: z.object({}), execute: async () => display(await getEarnPoolState()) },
  { name: 'get_wallet_exposure', description: 'Find direct SPL balances of hyUSD, xSOL and eHYUSD at one mainnet slot for any public address.', parameters: walletArgs, execute: async ({ wallet }: z.infer<typeof walletArgs>) => display(await getWalletExposure(wallet)) },
  { name: 'explain_mechanism', description: 'Describe Hylo backing and xAsset leverage with links to Hylo docs, plus current mainnet slot.', parameters: z.object({}), execute: async () => display(await explainMechanism()) },
] as const;

import { PublicKey } from '@solana/web3.js';

// SDK IDL at https://github.com/hylo-so/sdk/tree/5071a0eeb74d9c3ddff41cc71021a9ffa22fcc51/hylo-idl/idls
// PDA seeds at hylo-idl/src/pda.rs and mint seeds at hylo-idl/src/tokens.rs.
export const EXCHANGE = new PublicKey('HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn');
export const EARN = new PublicKey('HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ');
const TOKEN = new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA');
const ASSOCIATED_TOKEN = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');
const pda = (program: PublicKey, seed: string) => PublicKey.findProgramAddressSync([Buffer.from(seed)], program)[0];
export const HYLO = pda(EXCHANGE, 'hylo');
export const POOL_CONFIG = pda(EARN, 'pool_config');
export const MINTS = {
  hyUSD: pda(EXCHANGE, 'hyUSD'),
  xSOL: pda(EXCHANGE, 'xSOL'),
  eHYUSD: pda(EARN, 'staked_hyUSD'),
} as const;
export const POOL_AUTH = pda(EARN, 'pool_auth');
export const POOL_HYUSD = PublicKey.findProgramAddressSync(
  [POOL_AUTH.toBuffer(), TOKEN.toBuffer(), MINTS.hyUSD.toBuffer()], ASSOCIATED_TOKEN,
)[0];
export const TOKEN_PROGRAM = TOKEN;

export type Account = { data: [string, string]; owner: string; space: number };
type Result<T> = { context: { slot: number }; value: T };
const url = process.env.SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com';
let nextId = 0;
export async function rpc<T>(method: string, params: unknown[]): Promise<T> {
  const response = await fetch(url, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: ++nextId, method, params }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!response.ok) throw new Error(`Solana RPC HTTP ${response.status}`);
  const body = await response.json() as { result?: T; error?: { message: string } };
  if (body.error) throw new Error(`Solana RPC: ${body.error.message}`);
  if (!body.result) throw new Error(`Solana RPC returned no ${method} result`);
  return body.result;
}
export async function accounts(keys: PublicKey[]): Promise<{ slot: number; data: Buffer[] }> {
  const result = await rpc<Result<(Account | null)[]>>('getMultipleAccounts', [
    keys.map(k => k.toBase58()), { encoding: 'base64', commitment: 'confirmed' },
  ]);
  const data = result.value.map((a, i) => {
    if (!a) throw new Error(`Missing account ${keys[i].toBase58()}`);
    const expected = keys[i].equals(HYLO) ? EXCHANGE.toBase58() : keys[i].equals(POOL_CONFIG) ? EARN.toBase58() : TOKEN.toBase58();
    if (a.owner !== expected || a.data[1] !== 'base64') throw new Error(`Unexpected owner or encoding at ${keys[i].toBase58()}`);
    return Buffer.from(a.data[0], 'base64');
  });
  return { slot: result.context.slot, data };
}
export function checkedAccount(data: Buffer, discriminator: number[], length: number): void {
  if (data.length !== length || !data.subarray(0, 8).equals(Buffer.from(discriminator))) {
    throw new Error('Account layout differs from pinned Hylo SDK IDL; refusing to decode');
  }
}
export function mintSupply(data: Buffer): string {
  if (data.length !== 82 || data[45] !== 1 || data[44] !== 6) throw new Error('Unexpected SPL mint layout or decimals');
  return units(data.readBigUInt64LE(36));
}
export function units(amount: bigint): string {
  const whole = amount / 1_000_000n;
  const fraction = (amount % 1_000_000n).toString().padStart(6, '0').replace(/0+$/, '');
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
export function virtualSupply(data: Buffer): string {
  // Hylo.virtual_stablecoin.supply = UFixValue64 {bits: u64, exp: i8}, IDL offsets 433 and 441.
  if (data.readInt8(441) !== -6) throw new Error('Unexpected virtual stablecoin exponent');
  return units(data.readBigUInt64LE(433));
}
export function metadata(slot: number, sourceAccounts: (PublicKey | string)[]) {
  return {
    slot, timestamp: new Date().toISOString(),
    sourceAccounts: sourceAccounts.map(k => typeof k === 'string' ? k : k.toBase58()),
    note: 'read-only: no transactions are built or signed',
  };
}

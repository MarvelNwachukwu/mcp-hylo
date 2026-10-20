import { tools } from './tools.js';
import { POOL_AUTH } from './chain.js';

// Calls the exact tool execute handlers registered with FastMCP.
// The public Earn Pool authority is not a user wallet; its hyUSD reserve proves nonzero balance decoding.
console.log('get_protocol_state:', await tools[0].execute());
console.log('get_earn_pool_state:', await tools[1].execute());
console.log('get_wallet_exposure:', await tools[2].execute({ wallet: POOL_AUTH.toBase58() }));
console.log('explain_mechanism:', await tools[3].execute());

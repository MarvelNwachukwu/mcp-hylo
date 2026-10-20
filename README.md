# mcp-hylo

A local, read-only MCP server for public Hylo state on Solana mainnet. It does not accept a private key, connect a wallet, build a transaction, simulate a trade, or sign anything. Source: [Hylo SDK](https://github.com/hylo-so/sdk) and [Hylo onchain addresses](https://docs.hylo.so/security/onchain-addresses).

## Run

Node 22+ and pnpm are required.

```sh
pnpm install
pnpm build
pnpm smoke
```

The default endpoint is `https://api.mainnet-beta.solana.com`. Set `SOLANA_RPC_URL` to a different public or private RPC URL if needed. No RPC credential is required by the default endpoint. The smoke script calls the same four tool handlers used by the MCP server; it performs four read-only RPC requests. The wallet example is the public Hylo Earn Pool authority, not a person. Public RPC rate limits may affect repeated runs.

For Claude Desktop, add this to `~/Library/Application Support/Claude/claude_desktop_config.json` under `mcpServers`, then restart Claude:

```json
{
  "mcpServers": {
    "hylo": {
      "command": "/opt/homebrew/bin/node",
      "args": ["/Users/0xmarvel/superconductor/projects/value-drops/hylo-mcp/dist/index.js"]
    }
  }
}
```

For Cursor, put the same `mcpServers` object in a project `.cursor/mcp.json` or use Cursor's MCP settings. Change the Node path if `which node` reports a different binary. Restart the client after rebuilding. The server uses stdio; stdout contains MCP messages, not status logs.

## Tools

- `get_protocol_state`: hyUSD, xSOL and eHYUSD **mint** supplies; SOL-pool virtual stablecoin accounting supply; protocol and SOL-pool pause flags. These are not estimates of circulating float or aggregate collateralization.
- `get_earn_pool_state`: hyUSD in the Earn Pool, eHYUSD mint supply, eHYUSD NAV in hyUSD, pool pause flag. NAV is the reserve/supply ratio rounded up to six decimals as in [Hylo's SDK math](https://github.com/hylo-so/sdk/blob/5071a0eeb74d9c3ddff41cc71021a9ffa22fcc51/hylo-core/src/earn_pool_math.rs); it is not a market quote or a guaranteed redemption amount.
- `get_wallet_exposure(wallet)`: direct SPL Token balances for those three mints in public token accounts owned by the supplied address. It does not count positions deposited into other protocols, custodial holdings, or a transaction history.
- `explain_mechanism`: short description with links to the [core mechanism](https://docs.hylo.so/protocol-overview/core-mechanism), [xAsset mechanics](https://docs.hylo.so/protocol-overview/xassets), and [hyUSD/eHYUSD](https://docs.hylo.so/product-guide/stablecoin). Static explanation; its slot is only an RPC connectivity check.

Every response includes a confirmed RPC `slot`, local UTC observation `timestamp`, `sourceAccounts`, and `read-only: no transactions are built or signed`. Numeric fields from one tool call come from a single RPC snapshot. Values are decimal strings to avoid JavaScript precision loss. A schema/owner/mint mismatch fails rather than returning an invented number.

## Actual mainnet run

`pnpm build && pnpm smoke` passed on 2026-10-20. The following are selected fields from the four actual tool responses, not a cached data source. Run `pnpm smoke` to see full JSON including all source account addresses and notes.

```text
get_protocol_state: slot 459364411, timestamp 2026-10-20T20:34:40.212Z, sourceAccounts HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn / 9cd2sAfbBvKs4SX9YKo4dcjwP3TgTVQ8dT5koshGcDND / 5YMkXAYccHSGnHn9nob9xEvv6Pvka9DZWH7nTbotTu9E / 4sWNB8zGWHkh6UnmwiEtzNxL4XrN7uK9tosbESbJFfVs / HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz, hyUSD.mintSupply 24860625.721152, xSOL.mintSupply 190373579.132589, eHYUSD.mintSupply 13822274.500846, solPoolVirtualStablecoinSupply 21391929.586304, protocolPaused false
get_earn_pool_state: slot 459364412, timestamp 2026-10-20T20:34:40.502Z, sourceAccounts HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ / 2jk7miWrsTbt5hUSaCXPkEQPvuUMgbFLpgMzMQw3Z6ar / EqozKyMj7FVnLHc2cJj3VC25aBr4AhVh1cGM2WDajGe9 / HnnGv3HrSqjRpgdFmx7vQGjntNEoex1SU4e9Lxcxuihz, hyUSDInPool 20787119.512185, eHYUSDSupply 13822274.500846, eHYUSDNavInHyUSD 1.503886, paused false
get_wallet_exposure({"wallet":"5YrRAQag9BbJkauDtJkd1vsTquXT6N46oU8rJ66GDxHd"}): slot 459364413, timestamp 2026-10-20T20:34:40.809Z, source account EqozKyMj7FVnLHc2cJj3VC25aBr4AhVh1cGM2WDajGe9, hyUSD.balance 20787119.512185, xSOL.balance 0, eHYUSD.balance 0
explain_mechanism: slot 459364414, timestamp 2026-10-20T20:34:41.086Z, sourceAccounts HYEXCHtHkBagdStcJCp3xbbb9B7sdMdWXFNj6mdsG4hn / HysTabVUfmQBFcmzu1ctRd1Y1fxd66RBpboy1bmtDSQQ, source https://docs.hylo.so/protocol-overview/core-mechanism
```

The stdio server also answered MCP `initialize`, `tools/list` (four tools), and `tools/call` for `get_protocol_state` on mainnet at slot 459364549. All four smoke outputs include the read-only note.

## Verification boundary

Program IDs, mint seeds and account layouts come from [SDK commit `5071a0e`](https://github.com/hylo-so/sdk/tree/5071a0eeb74d9c3ddff41cc71021a9ffa22fcc51/hylo-idl). The derived token mints match [Hylo's published addresses](https://docs.hylo.so/security/onchain-addresses). Account discriminators, lengths, owners, mint addresses, fixed-point exponent and SPL decimals are checked against live RPC responses. Earn Pool reserve also matches the balance obtained through the independent `getTokenAccountsByOwner` call above.

I could not compare these values with hylo.so's web dashboard: the public site returned HTTP 429 and then a Vercel Security Checkpoint in a clean browser. That comparison is **not verified**. I left collateral ratio, xSOL NAV/effective leverage, SOL/USD and other pool prices, and exogenous pool totals out. They require current collateral vault balances, valid oracle updates, SDK price math and an independent public sanity check. The SOL-pool virtual supply is not the total hyUSD supply. No purported stability-pool APY is inferred from these accounts.

## What I'd add next

- Validate oracle freshness and LST reserve valuation against a public Hylo dashboard figure, then compute SOL-pool CR and xSOL NAV using the SDK's exact math.
- Decode and cross-check each exogenous pool before claiming an aggregate collateral ratio or effective leverage.
- Report additional Hylo mint balances only after pinning their SDK addresses and checking live mint ownership.

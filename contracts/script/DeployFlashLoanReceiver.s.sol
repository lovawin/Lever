// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/FlashLoanReceiver.sol";

/**
 * Deploy FlashLoanReceiver to Arbitrum.
 *
 * This contract receives flash loans from Aave v3 and executes strategies
 * (arbitrage, self-liquidation, leverage loops). It needs to be deployed
 * BEFORE flash loans can be executed.
 *
 * Usage:
 *   forge script script/DeployFlashLoanReceiver.s.sol --rpc-url arbitrum --broadcast
 *
 * Environment variables (.env):
 *   PRIVATE_KEY        - Deployer private key (same as LeverVault deployer)
 *   VAULT_ADDRESS      - Deployed LeverVault contract address
 *   ARBITRUM_RPC_URL   - Arbitrum RPC endpoint
 *
 * After deployment:
 *   1. Call vault.setOperator(flashLoanReceiver, true) to allow it to open/close positions
 *   2. Call flashLoanReceiver.toggleStrategy(1, true) to enable arbitrage
 *   3. Call flashLoanReceiver.toggleStrategy(2, true) to enable self-liquidation
 *   4. Call flashLoanReceiver.toggleStrategy(3, true) to enable leverage loops
 *
 * Arbitrum addresses:
 *   USDC:                 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
 *   Aave Pool:            0x794a61358D6845594F94dc1DB02A252b5b4814aD
 *   Uniswap V3 Router:   0x68b3465833fb72A70ec138488f5723Ce294C6d30
 *   LeverVault:           (set after deployment)
 */
contract DeployFlashLoanReceiver is Script {
    // Arbitrum One addresses
    address constant ARB_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;
    address constant AAVE_POOL = 0x794a61358D6845594F94dc1DB02A252b5b4814aD;
    address constant UNISWAP_V3_ROUTER = 0x68b3465833Fb72a70EC138488f5723cE294c6D30;

    function run() external {
        address vaultAddress = vm.envAddress("VAULT_ADDRESS");

        vm.startBroadcast();

        FlashLoanReceiver receiver = new FlashLoanReceiver(
            ARB_USDC,
            vaultAddress,
            AAVE_POOL,
            UNISWAP_V3_ROUTER
        );

        console.log("FlashLoanReceiver deployed at:", address(receiver));
        console.log("Owner:", receiver.owner());
        console.log("USDC:", receiver.USDC());
        console.log("Vault:", address(receiver.vault()));
        console.log("Pool (Aave):", address(receiver.pool()));
        console.log("Router (Uniswap):", address(receiver.router()));
        console.log("");
        console.log("=== NEXT STEPS ===");
        console.log("1. Call LeverVault.setOperator(flashLoanReceiver, true)");
        console.log("2. Call FlashLoanReceiver.toggleStrategy(1, true)  // arbitrage");
        console.log("3. Call FlashLoanReceiver.toggleStrategy(2, true)  // self-liquidation");
        console.log("4. Call FlashLoanReceiver.toggleStrategy(3, true)  // leverage loop");
        console.log("5. Update backend .env with FLASH_LOAN_RECEIVER_ADDRESS");

        vm.stopBroadcast();
    }
}
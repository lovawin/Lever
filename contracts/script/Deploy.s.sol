// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/LeverVault.sol";

/**
 * Deploy LeverVault to Arbitrum.
 *
 * Usage:
 *   forge script script/Deploy.s.sol --rpc-url arbitrum --broadcast
 *
 * Environment variables (.env):
 *   PRIVATE_KEY        - Deployer private key
 *   TREASURY           - Treasury wallet address (receives fees)
 *   HL_MASTER          - HL master account address (receives margin)
 *   OPEN_CLOSE_BPS     - Open+close fee in bps (default: 1000 = 10%)
 *   PROFIT_FEE_BPS     - Profit fee in bps (default: 500 = 5%)
 *   ARBITRUM_RPC_URL   - Arbitrum RPC endpoint
 *   ARBISCAN_API_KEY   - For contract verification
 *
 * Arbitrum USDC (native): 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
 */
contract Deploy is Script {
    // Arbitrum One USDC (native)
    address constant ARB_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    function run() external {
        address treasury = vm.envAddress("TREASURY");
        address hlMaster = vm.envAddress("HL_MASTER");
        uint256 openCloseBps = vm.envOr("OPEN_CLOSE_BPS", uint256(1000));  // 10%
        uint256 profitFeeBps = vm.envOr("PROFIT_FEE_BPS", uint256(500));   // 5%

        vm.startBroadcast();

        LeverVault vault = new LeverVault(
            ARB_USDC,
            treasury,
            hlMaster,
            openCloseBps,
            profitFeeBps
        );

        console.log("LeverVault deployed at:", address(vault));
        console.log("USDC:", address(vault.USDC()));
        console.log("Owner:", vault.owner());
        console.log("Treasury:", vault.treasury());
        console.log("HL Master:", vault.hlMasterAccount());
        console.log("Open+Close Fee:", vault.openCloseFeeBps(), "bps");
        console.log("Profit Fee:", vault.profitFeeBps(), "bps");

        vm.stopBroadcast();
    }
}
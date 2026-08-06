// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Script.sol";
import "../src/LeverVault.sol";

/**
 * Deploy LeverVault to Arbitrum.
 *
 * Usage:
 *   forge script script/Deploy.s.sol --rpc-url $ARBITRUM_RPC_URL --broadcast
 *
 * Environment variables:
 *   TREASURY         - Treasury wallet address (receives fees)
 *   FEE_CONTROLLER   - Address that can update fee rates
 *   HL_MASTER        - HL master account address (receives margin)
 *   OPEN_CLOSE_BPS   - Open+close fee in bps (default: 10 = 0.10%)
 *   PROFIT_FEE_BPS   - Profit fee in bps (default: 1000 = 10%)
 *
 * Arbitrum USDC: 0xaf88d065e77c8cC2239327C5EDb3A432268e5831
 * Arbitrum USDC (bridged): 0xFF970A616B314a7872686a7eA55b9 BE5cB3e3c00 (old)
 */
contract Deploy is Script {
    // Arbitrum One USDC
    address constant ARB_USDC = 0xaf88d065e77c8cC2239327C5EDb3A432268e5831;

    function run() external {
        address treasury = vm.envAddress("TREASURY");
        address feeController = vm.envAddress("FEE_CONTROLLER");
        address hlMaster = vm.envAddress("HL_MASTER");
        uint256 openCloseBps = vm.envOr("OPEN_CLOSE_BPS", uint256(10));   // 0.10%
        uint256 profitFeeBps = vm.envOr("PROFIT_FEE_BPS", uint256(1000)); // 10%

        vm.startBroadcast();

        LeverVault vault = new LeverVault(
            ARB_USDC,
            treasury,
            feeController,
            hlMaster,
            openCloseBps,
            profitFeeBps
        );

        console.log("LeverVault deployed at:", address(vault));
        console.log("USDC:", address(vault.USDC()));
        console.log("Treasury:", vault.treasury());
        console.log("HL Master:", vault.hlMasterAccount());
        console.log("Open+Close Fee:", vault.openCloseFeeBps(), "bps");
        console.log("Profit Fee:", vault.profitFeeBps(), "bps");

        vm.stopBroadcast();
    }
}
// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "forge-std/Test.sol";
import "../src/LeverVault.sol";

/// @title Simple mock USDC
contract MockUSDC {
    string public name = "USD Coin";
    string public symbol = "USDC";
    uint8 public decimals = 6;

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

/// @title Simple mock random ERC-20
contract MockToken {
    string public name = "Random Token";
    string public symbol = "RND";

    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;

    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
    }

    function transfer(address to, uint256 amount) external returns (bool) {
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        uint256 allowed = allowance[from][msg.sender];
        if (allowed != type(uint256).max) {
            allowance[from][msg.sender] = allowed - amount;
        }
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }
}

contract LeverVaultTest is Test {
    LeverVault public vault;
    MockUSDC public usdc;
    MockToken public randomToken;

    address public owner;
    address public alice;
    address public bob;
    address public treasury;
    address public hlMaster;
    address public operator;

    uint256 constant DEPOSIT_AMOUNT = 10_000e6; // 10,000 USDC

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        treasury = makeAddr("treasury");
        hlMaster = makeAddr("hlMaster");
        operator = makeAddr("operator");

        usdc = new MockUSDC();
        randomToken = new MockToken();

        vault = new LeverVault(
            address(usdc),
            treasury,
            hlMaster,
            1000,  // 10% open+close fee
            500    // 5% profit fee
        );

        vault.setOperator(operator, true);

        // Fund alice and bob
        usdc.mint(alice, 100_000e6);
        usdc.mint(bob, 100_000e6);

        // Approve vault to spend their USDC
        vm.prank(alice);
        usdc.approve(address(vault), type(uint256).max);
        vm.prank(bob);
        usdc.approve(address(vault), type(uint256).max);

        // Fund hlMaster and approve vault
        usdc.mint(hlMaster, 1_000_000e6);
        vm.prank(hlMaster);
        usdc.approve(address(vault), type(uint256).max);
    }

    // ─── Helper: open a position and return its ID ──────────────────────────

    function _openPosition(address user, uint256 margin, uint256 openFee) internal returns (bytes32) {
        bytes32 positionId = keccak256(abi.encodePacked(user, margin, openFee, block.timestamp));
        vm.prank(operator);
        vault.openPosition(positionId, user, margin, openFee, "BTC", true, 5);
        return positionId;
    }

    // ─── Deposit Tests ──────────────────────────────────────────────────────

    function test_Deposit() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        assertEq(vault.balances(alice), DEPOSIT_AMOUNT);
        assertEq(vault.totalDeposits(), DEPOSIT_AMOUNT);
        assertEq(usdc.balanceOf(address(vault)), DEPOSIT_AMOUNT);
    }

    function test_DepositMultiple() public {
        vm.prank(alice);
        vault.deposit(5_000e6);
        vm.prank(alice);
        vault.deposit(5_000e6);

        assertEq(vault.balances(alice), DEPOSIT_AMOUNT);
    }

    function test_DepositTwoUsers() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);
        vm.prank(bob);
        vault.deposit(DEPOSIT_AMOUNT);

        assertEq(vault.balances(alice), DEPOSIT_AMOUNT);
        assertEq(vault.balances(bob), DEPOSIT_AMOUNT);
        assertEq(vault.totalDeposits(), DEPOSIT_AMOUNT * 2);
    }

    function test_RevertDepositZero() public {
        vm.prank(alice);
        vm.expectRevert(LeverVault.ZeroAmount.selector);
        vault.deposit(0);
    }

    function test_RevertDepositBelowMinimum() public {
        vm.prank(alice);
        vm.expectRevert(LeverVault.BelowMinimum.selector);
        vault.deposit(0.5e6);
    }

    function test_RevertDepositAboveMaximum() public {
        vm.prank(alice);
        vm.expectRevert(LeverVault.AboveMaximum.selector);
        vault.deposit(2_000_000e6);
    }

    // ─── Withdrawal Tests ───────────────────────────────────────────────────

    function test_Withdraw() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        uint256 aliceBalBefore = usdc.balanceOf(alice);
        vm.prank(alice);
        vault.withdraw(5_000e6);

        assertEq(vault.balances(alice), 5_000e6);
        assertEq(usdc.balanceOf(alice), aliceBalBefore + 5_000e6);
    }

    function test_WithdrawAll() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vm.prank(alice);
        vault.withdrawAll();

        assertEq(vault.balances(alice), 0);
        assertEq(vault.totalDeposits(), 0);
        assertEq(usdc.balanceOf(alice), 100_000e6);
    }

    function test_RevertWithdrawInsufficientBalance() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vm.prank(alice);
        vm.expectRevert(LeverVault.InsufficientBalance.selector);
        vault.withdraw(DEPOSIT_AMOUNT + 1);
    }

    // ─── Emergency Withdraw ──────────────────────────────────────────────────

    function test_EmergencyWithdrawWorksWhenPaused() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vault.pause();
        assertTrue(vault.paused());

        vm.prank(alice);
        vault.emergencyWithdraw();

        assertEq(vault.balances(alice), 0);
        assertEq(vault.totalDeposits(), 0);
        assertEq(usdc.balanceOf(alice), 100_000e6);
    }

    function test_WithdrawAlsoWorksWhenPaused() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vault.pause();

        vm.prank(alice);
        vault.withdraw(5_000e6);

        assertEq(vault.balances(alice), 5_000e6);
    }

    function test_WithdrawAllAlsoWorksWhenPaused() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vault.pause();

        vm.prank(alice);
        vault.withdrawAll();

        assertEq(vault.balances(alice), 0);
    }

    // ─── Position Tracking ──────────────────────────────────────────────────

    function test_OpenPositionCreatesOnChainRecord() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        uint256 margin = 1_000e6;
        uint256 openFee = 100e6; // 10% of margin
        bytes32 positionId = keccak256("pos1");

        vm.prank(operator);
        vault.openPosition(positionId, alice, margin, openFee, "BTC", true, 5);

        (address user, uint256 posMargin, uint256 posOpenFee, bool isOpen) = vault.positions(positionId);
        assertEq(user, alice);
        assertEq(posMargin, margin);
        assertEq(posOpenFee, openFee);
        assertTrue(isOpen);
    }

    function test_RevertOpenPositionDuplicateId() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        bytes32 positionId = keccak256("pos1");

        vm.prank(operator);
        vault.openPosition(positionId, alice, 1_000e6, 100e6, "BTC", true, 5);

        // Re-deposit so alice has balance again
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vm.prank(operator);
        vm.expectRevert(LeverVault.PositionAlreadyClosed.selector);
        vault.openPosition(positionId, alice, 1_000e6, 100e6, "ETH", false, 3);
    }

    function test_ClosePositionValidatesPositionExists() public {
        bytes32 fakePositionId = keccak256("fake");

        vm.prank(operator);
        vm.expectRevert(LeverVault.PositionNotFound.selector);
        vault.closePosition(fakePositionId, 0, 0, 0, 1_000e6, "fake");
    }

    function test_ClosePositionValidatesMarginReturn() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        bytes32 positionId = keccak256("pos1");
        vm.prank(operator);
        vault.openPosition(positionId, alice, 1_000e6, 100e6, "BTC", true, 5);

        // Trying to close with wrong marginReturn should fail
        vm.prank(operator);
        vm.expectRevert(LeverVault.PositionNotFound.selector);
        vault.closePosition(positionId, 0, 0, 0, 999e6, "pos1");
    }

    function test_ClosePositionMarksClosed() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        bytes32 positionId = keccak256("pos1");
        vm.prank(operator);
        vault.openPosition(positionId, alice, 1_000e6, 100e6, "BTC", true, 5);

        vm.prank(operator);
        vault.closePosition(positionId, 0, 0, 0, 1_000e6, "pos1");

        (,, , bool isOpen) = vault.positions(positionId);
        assertFalse(isOpen);

        // Cannot close again
        vm.prank(operator);
        vm.expectRevert(LeverVault.PositionNotFound.selector);
        vault.closePosition(positionId, 0, 0, 0, 1_000e6, "pos1");
    }

    // ─── Close Fee Cap ─────────────────────────────────────────────────────

    function test_ClosePositionCapsCloseFee() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        uint256 margin = 1_000e6;
        bytes32 positionId = keccak256("pos1");
        vm.prank(operator);
        vault.openPosition(positionId, alice, margin, 100e6, "BTC", true, 5);

        // closeFee at exactly 10% cap should work
        uint256 maxCloseFee = (margin * 1000) / 10000; // 100e6 = 10% of 1000

        vm.prank(operator);
        vault.closePosition(positionId, maxCloseFee, 0, 0, margin, "pos1");
    }

    function test_RevertCloseFeeExceedsCap() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        uint256 margin = 1_000e6;
        bytes32 positionId = keccak256("pos1");
        vm.prank(operator);
        vault.openPosition(positionId, alice, margin, 100e6, "BTC", true, 5);

        // closeFee above 10% of margin should fail
        uint256 excessiveCloseFee = (margin * 1001) / 10000;

        vm.prank(operator);
        vm.expectRevert(LeverVault.FeeCapExceeded.selector);
        vault.closePosition(positionId, excessiveCloseFee, 0, 0, margin, "pos1");
    }

    function test_RevertProfitFeeExceedsCap() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        uint256 margin = 1_000e6;
        bytes32 positionId = keccak256("pos1");
        vm.prank(operator);
        vault.openPosition(positionId, alice, margin, 100e6, "BTC", true, 5);

        uint256 profit = 100e6;
        usdc.mint(hlMaster, margin + profit);

        // profitFeeBps = 500 (5%), so max profitFee on 100 USDC = 5 USDC
        uint256 excessiveProfitFee = 6e6; // 6% of profit, over 5% cap

        vm.prank(operator);
        vm.expectRevert(LeverVault.FeeCapExceeded.selector);
        vault.closePosition(positionId, 0, excessiveProfitFee, int256(profit), margin, "pos1");
    }

    // ─── Full Open → Close Flow ───────────────────────────────────────────────

    function test_OpenAndClosePositionWithProfit() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        uint256 margin = 1_000e6;
        uint256 openFee = 100e6; // 10% of margin
        bytes32 positionId = keccak256("profit_pos");

        vm.prank(operator);
        vault.openPosition(positionId, alice, margin, openFee, "BTC", true, 5);

        assertEq(vault.balances(alice), DEPOSIT_AMOUNT - margin - openFee);

        // Fund hlMaster for close (margin + profit)
        uint256 profit = 100e6;
        usdc.mint(hlMaster, margin + profit);

        uint256 closeFee = 10e6;  // 1% of margin
        uint256 profitFee = 5e6;   // 5% of 100 USDC profit

        uint256 aliceBalBefore = vault.balances(alice);
        vm.prank(operator);
        vault.closePosition(positionId, closeFee, profitFee, int256(profit), margin, "profit_pos");

        // Alice gets: margin + profit - closeFee - profitFee = 1000 + 100 - 10 - 5 = 1085
        uint256 expectedReturn = margin + profit - closeFee - profitFee;
        assertEq(vault.balances(alice), aliceBalBefore + expectedReturn);
    }

    function test_OpenAndClosePositionWithLoss() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        uint256 margin = 1_000e6;
        uint256 openFee = 100e6;
        bytes32 positionId = keccak256("loss_pos");

        vm.prank(operator);
        vault.openPosition(positionId, alice, margin, openFee, "ETH", false, 3);

        // Fund hlMaster
        usdc.mint(hlMaster, margin);

        uint256 loss = 200e6;
        uint256 closeFee = 10e6;
        int256 pnl = -int256(loss);

        uint256 aliceBalBefore = vault.balances(alice);
        vm.prank(operator);
        vault.closePosition(positionId, closeFee, 0, pnl, margin, "loss_pos");

        // Alice gets: margin - loss - closeFee = 1000 - 200 - 10 = 790
        uint256 expectedReturn = margin - loss - closeFee;
        assertEq(vault.balances(alice), aliceBalBefore + expectedReturn);
    }

    // ─── Double-Close Prevention ──────────────────────────────────────────────

    function test_RevertDoubleClose() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        bytes32 positionId = keccak256("double_close");
        vm.prank(operator);
        vault.openPosition(positionId, alice, 1_000e6, 100e6, "BTC", true, 5);

        vm.prank(operator);
        vault.closePosition(positionId, 0, 0, 0, 1_000e6, "double_close");

        vm.prank(operator);
        vm.expectRevert(LeverVault.PositionNotFound.selector);
        vault.closePosition(positionId, 0, 0, 0, 1_000e6, "double_close");
    }

    function test_RevertCloseNonexistentPosition() public {
        vm.prank(operator);
        vm.expectRevert(LeverVault.PositionNotFound.selector);
        vault.closePosition(keccak256("ghost"), 0, 0, 0, 1_000e6, "ghost");
    }

    // ─── Wrong Token Recovery ─────────────────────────────────────────────────

    function test_RescueRandomToken() public {
        randomToken.mint(address(vault), 1000e18);

        uint256 ownerBalBefore = randomToken.balanceOf(owner);
        vault.rescueTokens(address(randomToken), 500e18);

        assertEq(randomToken.balanceOf(owner), ownerBalBefore + 500e18);
        assertEq(randomToken.balanceOf(address(vault)), 500e18);
    }

    function test_RevertRescueUSDC() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vm.expectRevert(LeverVault.CannotRescueUSDC.selector);
        vault.rescueTokens(address(usdc), 100e6);
    }

    function test_RevertRescueTokensNotOwner() public {
        randomToken.mint(address(vault), 1000e18);

        vm.prank(alice);
        vm.expectRevert(LeverVault.NotOwner.selector);
        vault.rescueTokens(address(randomToken), 500e18);
    }

    function test_RecoverETH() public {
        address sender = makeAddr("ethSender");
        vm.deal(sender, 1 ether);

        vm.prank(sender);
        (bool ok,) = address(vault).call{value: 0.5 ether}("");
        assertTrue(ok);

        assertEq(vault.stuckETH(sender), 0.5 ether);

        uint256 senderBalBefore = sender.balance;
        vm.prank(sender);
        vault.recoverETH();

        assertEq(sender.balance, senderBalBefore + 0.5 ether);
        assertEq(vault.stuckETH(sender), 0);
    }

    // ─── Solvency ─────────────────────────────────────────────────────────────

    function test_IsSolvent() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        (uint256 vaultBal, uint256 totalDep, uint256 deficit, bool solvent) = vault.getSolvencyInfo();

        assertTrue(solvent);
        assertEq(vaultBal, DEPOSIT_AMOUNT);
        assertEq(totalDep, DEPOSIT_AMOUNT);
        assertEq(deficit, 0);
    }

    // ─── Admin ─────────────────────────────────────────────────────────────────

    function test_PauseBlocksDeposits() public {
        vault.pause();
        assertTrue(vault.paused());

        vm.prank(alice);
        vm.expectRevert(LeverVault.IsPaused.selector);
        vault.deposit(DEPOSIT_AMOUNT);
    }

    function test_PauseBlocksOpenPosition() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vault.pause();

        vm.prank(operator);
        vm.expectRevert(LeverVault.IsPaused.selector);
        vault.openPosition(keccak256("pos1"), alice, 1_000e6, 100e6, "BTC", true, 5);
    }

    function test_PauseBlocksClosePosition() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        bytes32 positionId = keccak256("pos1");
        vm.prank(operator);
        vault.openPosition(positionId, alice, 1_000e6, 100e6, "BTC", true, 5);

        vault.pause();

        vm.prank(operator);
        vm.expectRevert(LeverVault.IsPaused.selector);
        vault.closePosition(positionId, 0, 0, 0, 1_000e6, "pos1");
    }

    function test_Unpause() public {
        vault.pause();
        vault.unpause();
        assertFalse(vault.paused());

        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);
        assertEq(vault.balances(alice), DEPOSIT_AMOUNT);
    }

    function test_SetTreasury() public {
        address newTreasury = makeAddr("newTreasury");
        vault.setTreasury(newTreasury);
        assertEq(vault.treasury(), newTreasury);
    }

    function test_RevertSetTreasuryZero() public {
        vm.expectRevert(LeverVault.ZeroAddress.selector);
        vault.setTreasury(address(0));
    }

    // ─── Fee Params (Owner Only) ─────────────────────────────────────────────

    function test_SetFeeParamsOwner() public {
        vault.setFeeParams(500, 1000); // 5% open+close, 10% profit

        assertEq(vault.openCloseFeeBps(), 500);
        assertEq(vault.profitFeeBps(), 1000);
    }

    function test_RevertSetFeeParamsAboveCap() public {
        vm.expectRevert(LeverVault.FeeCapExceeded.selector);
        vault.setFeeParams(1001, 500); // 10.01% open+close exceeds cap
    }

    function test_RevertSetFeeParamsProfitAboveCap() public {
        vm.expectRevert(LeverVault.FeeCapExceeded.selector);
        vault.setFeeParams(500, 2001); // 20.01% profit exceeds cap
    }

    function test_RevertSetFeeParamsNotOwner() public {
        vm.prank(alice);
        vm.expectRevert(LeverVault.NotOwner.selector);
        vault.setFeeParams(5, 500);
    }

    // ─── Two-Step Ownership Transfer ──────────────────────────────────────────

    function test_TwoStepOwnershipTransfer() public {
        address newOwner = makeAddr("newOwner");

        vault.proposeOwnership(newOwner);
        assertEq(vault.proposedOwner(), newOwner);

        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner);
        assertEq(vault.proposedOwner(), address(0));
    }

    function test_RevertAcceptOwnershipNotProposed() public {
        vm.prank(alice);
        vm.expectRevert(LeverVault.OwnershipNotProposed.selector);
        vault.acceptOwnership();
    }

    function test_TransferOwnershipNowUsesTwoStep() public {
        address newOwner = makeAddr("newOwner2");

        vault.transferOwnership(newOwner);
        assertEq(vault.proposedOwner(), newOwner);
        assertEq(vault.owner(), address(this));

        vm.prank(newOwner);
        vault.acceptOwnership();
        assertEq(vault.owner(), newOwner);
    }

    function test_RevertProposeOwnershipSameAddress() public {
        vm.expectRevert(LeverVault.SameAddress.selector);
        vault.proposeOwnership(address(this));
    }

    function test_RevertProposeOwnershipZero() public {
        vm.expectRevert(LeverVault.ZeroAddress.selector);
        vault.proposeOwnership(address(0));
    }

    // ─── Open Position Tests ──────────────────────────────────────────────────

    function test_OpenPosition() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        uint256 margin = 1_000e6;
        uint256 openFee = 100e6; // 10% of margin

        uint256 treasuryBalBefore = usdc.balanceOf(treasury);

        bytes32 positionId = keccak256("test_pos");
        vm.prank(operator);
        vault.openPosition(positionId, alice, margin, openFee, "BTC", true, 5);

        assertEq(vault.balances(alice), DEPOSIT_AMOUNT - margin - openFee);
        assertEq(usdc.balanceOf(treasury), treasuryBalBefore + openFee);
    }

    function test_RevertOpenPositionNotOperator() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vm.prank(bob);
        vm.expectRevert(LeverVault.NotOperator.selector);
        vault.openPosition(keccak256("pos"), alice, 1_000e6, 100e6, "BTC", true, 5);
    }

    function test_RevertOpenPositionInsufficientBalance() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.prank(operator);
        vm.expectRevert(LeverVault.InsufficientBalance.selector);
        vault.openPosition(keccak256("pos"), alice, 200e6, 0, "BTC", true, 5);
    }

    function test_RevertOpenPositionFeeExceedsCap() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        // openFee cannot exceed 10% of margin
        uint256 margin = 1_000e6;
        uint256 excessiveOpenFee = (margin * 1001) / 10000;

        vm.prank(operator);
        vm.expectRevert(LeverVault.FeeCapExceeded.selector);
        vault.openPosition(keccak256("pos"), alice, margin, excessiveOpenFee, "BTC", true, 5);
    }

    // ─── Constructor Fee Caps ─────────────────────────────────────────────────

    function test_RevertConstructorOpenCloseFeeAboveCap() public {
        vm.expectRevert(LeverVault.FeeCapExceeded.selector);
        new LeverVault(
            address(usdc),
            treasury,
            hlMaster,
            1001,  // 10.01% — over MAX_OPEN_CLOSE_BPS
            500
        );
    }

    function test_RevertConstructorProfitFeeAboveCap() public {
        vm.expectRevert(LeverVault.FeeCapExceeded.selector);
        new LeverVault(
            address(usdc),
            treasury,
            hlMaster,
            1000,
            2001   // 20.01% — over MAX_PROFIT_FEE_BPS
        );
    }
}
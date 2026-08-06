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
    address public feeController;
    address public hlMaster;
    address public operator;

    uint256 constant DEPOSIT_AMOUNT = 10_000e6; // 10,000 USDC

    function setUp() public {
        owner = address(this);
        alice = makeAddr("alice");
        bob = makeAddr("bob");
        treasury = makeAddr("treasury");
        feeController = makeAddr("feeController");
        hlMaster = makeAddr("hlMaster");
        operator = makeAddr("operator");

        usdc = new MockUSDC();
        randomToken = new MockToken();

        vault = new LeverVault(
            address(usdc),
            treasury,
            feeController,
            hlMaster,
            10,    // 0.10% open+close
            1000   // 10% profit fee
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

        // Both withdraw and emergencyWithdraw work when paused
        // (users can always get their funds out)
        vm.prank(alice);
        vault.emergencyWithdraw();

        assertEq(vault.balances(alice), 0);
        assertEq(vault.totalDeposits(), 0);
        assertEq(usdc.balanceOf(alice), 100_000e6);
    }

    // ─── Wrong Token Recovery ─────────────────────────────────────────────────

    function test_RescueRandomToken() public {
        randomToken.mint(address(vault), 1000e18);

        uint256 bobBalBefore = randomToken.balanceOf(bob);
        vm.prank(bob);
        vault.rescueTokens(address(randomToken), 500e18);

        assertEq(randomToken.balanceOf(bob), bobBalBefore + 500e18);
        assertEq(randomToken.balanceOf(address(vault)), 500e18);
    }

    function test_RevertRescueUSDC() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vm.prank(bob);
        vm.expectRevert(LeverVault.CannotRescueUSDC.selector);
        vault.rescueTokens(address(usdc), 100e6);
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

    // ─── Position Management ──────────────────────────────────────────────────

    function test_OpenPosition() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        uint256 margin = 1_000e6;
        uint256 openFee = 1e6;

        uint256 treasuryBalBefore = usdc.balanceOf(treasury);

        vm.prank(operator);
        vault.openPosition(alice, margin, openFee, "BTC", true, 5);

        assertEq(vault.balances(alice), DEPOSIT_AMOUNT - margin - openFee);
        assertEq(usdc.balanceOf(treasury), treasuryBalBefore + openFee);
    }

    function test_RevertOpenPositionNotOperator() public {
        vm.prank(alice);
        vault.deposit(DEPOSIT_AMOUNT);

        vm.prank(bob);
        vm.expectRevert(LeverVault.NotOperator.selector);
        vault.openPosition(alice, 1_000e6, 2e6, "BTC", true, 5);
    }

    function test_RevertOpenPositionInsufficientBalance() public {
        vm.prank(alice);
        vault.deposit(100e6);

        vm.prank(operator);
        vm.expectRevert(LeverVault.InsufficientBalance.selector);
        vault.openPosition(alice, 200e6, 0, "BTC", true, 5);
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

    function test_SetFeeParams() public {
        vm.prank(feeController);
        vault.setFeeParams(20, 500);

        assertEq(vault.openCloseFeeBps(), 20);
        assertEq(vault.profitFeeBps(), 500);
    }

    function test_RevertSetFeeParamsAboveCap() public {
        vm.prank(feeController);
        vm.expectRevert(LeverVault.FeeCapExceeded.selector);
        vault.setFeeParams(300, 1000);
    }

    function test_RevertSetFeeParamsNotController() public {
        vm.prank(alice);
        vm.expectRevert(LeverVault.NotFeeController.selector);
        vault.setFeeParams(5, 500);
    }
}
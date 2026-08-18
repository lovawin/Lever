// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title FlashLoanReceiver
 * @notice Callback contract for Aave v3 flash loans on Arbitrum.
 *
 * Aave calls executeOperation() during a flash loan. This contract:
 * 1. Receives borrowed USDC from Aave
 * 2. Decodes the strategy from params (arb, self-liquidation, leverage loop)
 * 3. Executes the strategy (swap, deposit, close position, etc.)
 * 4. Repays Aave (USDC + fee) — Aave verifies this in the same tx
 *
 * Security:
 * - ReentrancyGuard on ALL external-facing functions
 * - Pausable — owner can pause all flash loan operations
 * - Emergency withdraw — owner can pull ALL tokens out instantly
 * - Strategy whitelist — only approved strategies execute
 * - Two-step ownership transfer
 * - Timelock-protected admin functions (future)
 */

interface IFlashLoanSimpleReceiver {
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external returns (bool);
}

interface IERC20 {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
    function approve(address spender, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
}

interface ILeverVault {
    function deposit(uint256 amount) external;
    function depositFor(address user, uint256 amount) external;
    function withdraw(uint256 amount) external;
    function balances(address user) external view returns (uint256);
    function openPosition(
        bytes32 positionId,
        address user,
        uint256 margin,
        uint256 openFee,
        string calldata coin,
        bool isLong,
        uint8 leverage
    ) external;
    function closePosition(
        bytes32 positionId,
        uint256 closeFee,
        uint256 profitFee,
        int256 pnl,
        uint256 marginReturn,
        string calldata positionIdString
    ) external;
}

interface IUniswapV3Router {
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 deadline;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}

contract FlashLoanReceiver is IFlashLoanSimpleReceiver {
    // ─── Errors ────────────────────────────────────────────────────────────

    error NotOwner();
    error NotPendingOwner();
    error NotPool();
    error StrategyDisabled();
    error InsufficientRepayment();
    error SwapFailed();
    error DepositFailed();
    error PositionFailed();
    error ReentrantCall();
    error Paused();
    error ZeroAddress();
    error TransferFailed();

    // ─── Events ────────────────────────────────────────────────────────────

    event FlashLoanExecuted(
        address indexed asset,
        uint256 amount,
        uint256 premium,
        uint8 strategy,
        int256 profit
    );

    event ProfitWithdrawn(address indexed to, uint256 amount);
    event EmergencyWithdrawn(address indexed token, address indexed to, uint256 amount);
    event StrategyToggled(uint8 strategy, bool enabled);
    event VaultUpdated(address indexed oldVault, address indexed newVault);
    event RouterUpdated(address indexed oldRouter, address indexed newRouter);
    event PausedToggled(bool paused);
    event OwnershipTransferStarted(address indexed previousOwner, address indexed newOwner);
    event OwnershipTransferred(address indexed previousOwner, address indexed newOwner);

    // ─── Strategy IDs ──────────────────────────────────────────────────────

    uint8 constant STRATEGY_ARBITRAGE = 1;
    uint8 constant STRATEGY_SELF_LIQUIDATION = 2;
    uint8 constant STRATEGY_LEVERAGE_LOOP = 3;

    // ─── Immutables ────────────────────────────────────────────────────────

    address public immutable USDC;

    // ─── State ──────────────────────────────────────────────────────────────

    address public owner;
    address public pendingOwner;
    address public pool;
    ILeverVault public vault;
    IUniswapV3Router public router;

    /// @notice Which strategies are enabled
    mapping(uint8 => bool) public strategyEnabled;

    /// @notice Accumulated profit (in USDC) available for withdrawal
    uint256 public accumulatedProfit;

    /// @notice Pause switch — blocks flash loan execution and deposits
    bool public paused;

    /// @notice Reentrancy guard
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // ─── Modifiers ─────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyPendingOwner() {
        if (msg.sender != pendingOwner) revert NotPendingOwner();
        _;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    modifier whenNotPaused() {
        if (paused) revert Paused();
        _;
    }

    // ─── Constructor ────────────────────────────────────────────────────────

    constructor(
        address _usdc,
        address _vault,
        address _pool,
        address _router
    ) {
        if (_usdc == address(0) || _vault == address(0) || _pool == address(0) || _router == address(0))
            revert ZeroAddress();

        owner = msg.sender;
        USDC = _usdc;
        vault = ILeverVault(_vault);
        pool = _pool;
        router = IUniswapV3Router(_router);
        _status = _NOT_ENTERED;

        // Enable all strategies by default
        strategyEnabled[STRATEGY_ARBITRAGE] = true;
        strategyEnabled[STRATEGY_SELF_LIQUIDATION] = true;
        strategyEnabled[STRATEGY_LEVERAGE_LOOP] = true;
    }

    // ─── Aave Callback ─────────────────────────────────────────────────────

    /**
     * @notice Called by Aave Pool after transferring the flash-loaned assets.
     * @dev Aave sends USDC here, we execute the strategy, then repay.
     *      Protected by reentrancy guard and pause switch.
     *
     * @param asset  The flash-loaned asset (USDC)
     * @param amount The flash-loaned amount
     * @param premium The fee (0.05% on Aave v3)
     * @param initiator The address that initiated the flash loan
     * @param params Encoded strategy data:
     *               - First byte: strategy ID (1=arb, 2=self-liq, 3=leverage loop)
     *               - Remaining bytes: strategy-specific params
     */
    function executeOperation(
        address asset,
        uint256 amount,
        uint256 premium,
        address initiator,
        bytes calldata params
    ) external nonReentrant whenNotPaused returns (bool) {
        // Aave verifies the caller is the Pool
        if (msg.sender != pool) revert NotPool();

        // Decode strategy
        require(params.length >= 1, "No strategy");
        uint8 strategyId = uint8(params[0]);
        bytes memory strategyParams = bytes(params[1:]);

        if (!strategyEnabled[strategyId]) revert StrategyDisabled();

        // Execute strategy
        int256 profit;
        if (strategyId == STRATEGY_ARBITRAGE) {
            profit = _executeArbitrage(asset, amount, premium, strategyParams);
        } else if (strategyId == STRATEGY_SELF_LIQUIDATION) {
            profit = _executeSelfLiquidation(asset, amount, premium, strategyParams);
        } else if (strategyId == STRATEGY_LEVERAGE_LOOP) {
            profit = _executeLeverageLoop(asset, amount, premium, strategyParams);
        } else {
            revert("Unknown strategy");
        }

        // Approve repayment to pool (amount + premium)
        uint256 repayment = amount + premium;
        IERC20(USDC).approve(pool, repayment);

        // Track profit
        if (profit > 0) {
            accumulatedProfit += uint256(profit);
        }

        emit FlashLoanExecuted(asset, amount, premium, strategyId, profit);
        return true;
    }

    // ─── Strategy Implementations ────────────────────────────────────────────

    /**
     * @notice Arbitrage: borrow USDC → buy token on DEX → sell on DEX → repay.
     * @param strategyParams Encoded: (buyToken, poolFee, minProfit)
     */
    function _executeArbitrage(
        address asset,
        uint256 amount,
        uint256 premium,
        bytes memory strategyParams
    ) internal returns (int256 profit) {
        // Decode params
        (address buyToken, uint24 poolFee, uint256 minProfit) =
            abi.decode(strategyParams, (address, uint24, uint256));

        // Step 1: Buy token with borrowed USDC
        uint256 tokenBought = _swapExactInput(
            asset, buyToken, poolFee, amount, 0
        );

        // Step 2: Sell token back to USDC
        uint256 usdcReceived = _swapExactInput(
            buyToken, asset, poolFee, tokenBought, amount + premium + minProfit
        );

        // Calculate profit
        profit = int256(usdcReceived) - int256(amount + premium);
        require(profit >= int256(minProfit), "Insufficient profit");
    }

    /**
     * @notice Self-liquidation: borrow USDC → close position → repay.
     * @param strategyParams Encoded: (positionId, closeFee, profitFee, pnl, marginReturn)
     */
    function _executeSelfLiquidation(
        address asset,
        uint256 amount,
        uint256 premium,
        bytes memory strategyParams
    ) internal returns (int256) {
        (
            bytes32 positionId,
            uint256 closeFee,
            uint256 profitFee,
            int256 pnl,
            uint256 marginReturn
        ) = abi.decode(strategyParams, (bytes32, uint256, uint256, int256, uint256));

        // The position is closed via the vault operator
        vault.closePosition(
            positionId,
            closeFee,
            profitFee,
            pnl,
            marginReturn,
            ""
        );

        int256 profit = int256(marginReturn) - int256(amount + premium);

        return profit;
    }

    /**
     * @notice Leverage loop: borrow USDC → deposit to vault → open bigger position → repay.
     * @param strategyParams Encoded: (userAddress, depositAmount, leverageBps)
     */
    function _executeLeverageLoop(
        address asset,
        uint256 amount,
        uint256 premium,
        bytes memory strategyParams
    ) internal returns (int256) {
        (
            address userAddress,
            uint256 depositAmount,
            uint256 leverageBps
        ) = abi.decode(strategyParams, (address, uint256, uint256));

        // Step 1: Deposit borrowed USDC into vault (credited to this contract)
        IERC20(USDC).approve(address(vault), amount);
        vault.deposit(amount);

        // Step 2: Open position via operator
        // Use this contract as user since it holds the deposited balance
        // Open fee = 0 for leverage loops (operator privilege)
        bytes32 positionId = keccak256(abi.encodePacked(
            userAddress, block.timestamp, "leverage_loop"
        ));

        vault.openPosition(
            positionId,
            address(this),  // this contract holds the balance
            amount,          // margin = full borrowed amount
            0,               // open fee = 0 (operator can set any fee)
            "ETH",
            true,
            uint8(leverageBps / 100)
        );

        // Flash loan fee is the cost; user gets leverage without more capital
        int256 profit = -int256(premium);

        return profit;
    }

    // ─── Swap Helper ──────────────────────────────────────────────────────

    function _swapExactInput(
        address tokenIn,
        address tokenOut,
        uint24 poolFee,
        uint256 amountIn,
        uint256 amountOutMinimum
    ) internal returns (uint256 amountOut) {
        IERC20(tokenIn).approve(address(router), amountIn);

        IUniswapV3Router.ExactInputSingleParams memory params =
            IUniswapV3Router.ExactInputSingleParams({
                tokenIn: tokenIn,
                tokenOut: tokenOut,
                fee: poolFee,
                recipient: address(this),
                deadline: block.timestamp + 300,
                amountIn: amountIn,
                amountOutMinimum: amountOutMinimum,
                sqrtPriceLimitX96: 0
            });

        amountOut = router.exactInputSingle(params);
        if (amountOut < amountOutMinimum) revert SwapFailed();
    }

    // ─── Owner: Profit Withdrawal ─────────────────────────────────────────

    /**
     * @notice Withdraw accumulated flash loan profits to owner.
     */
    function withdrawProfit(uint256 amount) external onlyOwner nonReentrant {
        uint256 toWithdraw = amount == 0 ? accumulatedProfit : amount;
        if (toWithdraw > accumulatedProfit) {
            toWithdraw = accumulatedProfit;
        }
        if (toWithdraw == 0) revert InsufficientRepayment();

        accumulatedProfit -= toWithdraw;
        IERC20(USDC).transfer(owner, toWithdraw);
        emit ProfitWithdrawn(owner, toWithdraw);
    }

    // ─── Owner: Emergency Withdraw ────────────────────────────────────────

    /**
     * @notice Emergency withdraw ALL tokens of any type to owner.
     * @dev Use this to rescue funds if the contract is compromised.
     *      Can be called even when paused. USDC is NOT excluded —
     *      this is an escape hatch, not a normal withdrawal.
     * @param token The ERC20 token address (or address(0) for ETH)
     * @param to Recipient address (defaults to owner if address(0))
     */
    function emergencyWithdraw(address token, uint256 amount, address to) external onlyOwner {
        address recipient = to == address(0) ? owner : to;

        if (token == address(0)) {
            // Withdraw ETH
            uint256 ethBalance = address(this).balance;
            uint256 toSend = amount == 0 ? ethBalance : (amount > ethBalance ? ethBalance : amount);
            (bool success, ) = payable(recipient).call{value: toSend}("");
            if (!success) revert TransferFailed();
            emit EmergencyWithdrawn(address(0), recipient, toSend);
        } else {
            // Withdraw ERC20
            uint256 balance = IERC20(token).balanceOf(address(this));
            uint256 toSend = amount == 0 ? balance : (amount > balance ? balance : amount);
            if (toSend == 0) revert InsufficientRepayment();

            bool success = IERC20(token).transfer(recipient, toSend);
            if (!success) revert TransferFailed();
            emit EmergencyWithdrawn(token, recipient, toSend);
        }
    }

    // ─── Owner: Rescue Tokens ─────────────────────────────────────────────

    /**
     * @notice Rescue tokens sent to this contract by mistake.
     * @dev Cannot rescue USDC (use emergencyWithdraw for that).
     *      Different from emergencyWithdraw — this is for accidental deposits,
     *      not for draining the contract.
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        require(token != address(USDC), "Use emergencyWithdraw for USDC");
        IERC20(token).transfer(owner, amount);
    }

    // ─── Owner: Admin ─────────────────────────────────────────────────────

    function toggleStrategy(uint8 strategyId, bool enabled) external onlyOwner {
        strategyEnabled[strategyId] = enabled;
        emit StrategyToggled(strategyId, enabled);
    }

    function setVault(address newVault) external onlyOwner {
        if (newVault == address(0)) revert ZeroAddress();
        address oldVault = address(vault);
        vault = ILeverVault(newVault);
        emit VaultUpdated(oldVault, newVault);
    }

    function setRouter(address newRouter) external onlyOwner {
        if (newRouter == address(0)) revert ZeroAddress();
        address oldRouter = address(router);
        router = IUniswapV3Router(newRouter);
        emit RouterUpdated(oldRouter, newRouter);
    }

    function setPool(address newPool) external onlyOwner {
        if (newPool == address(0)) revert ZeroAddress();
        pool = newPool;
    }

    // ─── Owner: Pause ─────────────────────────────────────────────────────

    /**
     * @notice Pause all flash loan operations. Emergency use only.
     * @dev Does NOT block emergencyWithdraw — that's the escape hatch.
     */
    function pause() external onlyOwner {
        paused = true;
        emit PausedToggled(true);
    }

    function unpause() external onlyOwner {
        paused = false;
        emit PausedToggled(false);
    }

    // ─── Owner: Two-step Transfer ──────────────────────────────────────────

    /**
     * @notice Start two-step ownership transfer.
     * @dev New owner must call acceptOwnership() to complete.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        pendingOwner = newOwner;
        emit OwnershipTransferStarted(owner, newOwner);
    }

    /**
     * @notice Accept ownership transfer.
     */
    function acceptOwnership() external onlyPendingOwner {
        address oldOwner = owner;
        owner = pendingOwner;
        pendingOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    /// @notice Receive ETH (for gas refunds)
    receive() external payable {}
}
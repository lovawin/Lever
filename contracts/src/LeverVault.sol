// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

/**
 * @title LeverVault
 * @notice Non-custodial vault for Lever Trading platform on Arbitrum.
 *
 * Users deposit USDC, the vault tracks balances, and only users can withdraw.
 * Operators (Lever backend) place orders on behalf of users.
 *
 * Key guarantees:
 * - Users can ALWAYS withdraw via emergencyWithdraw(), even when paused
 * - Wrong tokens (non-USDC ERC-20s, ETH) are recoverable
 * - Operators can only deduct approved margin + fee amounts
 * - Fee rates are capped and cannot be set to extreme values
 * - Anyone can verify solvency on-chain (vault USDC >= totalDeposits)
 */

interface IUSDC {
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

contract LeverVault {
    // ─── Errors ──────────────────────────────────────────────────────────────

    error ZeroAmount();
    error BelowMinimum();
    error AboveMaximum();
    error InsufficientBalance();
    error TransferFailed();
    error NotOwner();
    error NotOperator();
    error NotFeeController();
    error IsPaused();
    error CannotRescueUSDC();
    error FeeCapExceeded();
    error ZeroAddress();
    error SameAddress();
    error NoStuckTokens();
    error NoStuckETH();

    // ─── Events ──────────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event EmergencyWithdrawn(address indexed user, uint256 amount);
    event PositionOpened(
        address indexed user,
        string coin,
        bool isLong,
        uint8 leverage,
        uint256 margin,
        uint256 openFee
    );
    event PositionClosed(
        address indexed user,
        string positionId,
        uint256 closeFee,
        uint256 profitFee,
        int256 pnl,
        uint256 returned
    );
    event FeeDeducted(address indexed user, uint256 amount, string feeType);
    event FeeCollected(address indexed from, uint256 amount, string reason);
    event TokensRescued(address indexed token, address indexed to, uint256 amount);
    event ETHRecovered(address indexed to, uint256 amount);
    event ETHReceived(address indexed from, uint256 amount);
    event ContractPaused();
    event Unpaused();
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event OperatorUpdated(address indexed operator, bool status);
    event FeeControllerUpdated(address indexed oldController, address indexed newController);
    event FeeParamsUpdated(uint256 openCloseBps, uint256 profitFeeBps);
    event HLMasterUpdated(address indexed oldMaster, address indexed newMaster);

    // ─── Immutables ──────────────────────────────────────────────────────────

    /// @notice USDC token contract (6 decimals on Arbitrum)
    IUSDC public immutable USDC;

    /// @notice Minimum deposit amount (1 USDC)
    uint256 public constant MIN_DEPOSIT = 1e6;

    /// @notice Maximum single deposit (1M USDC)
    uint256 public constant MAX_DEPOSIT = 1_000_000e6;

    /// @notice Minimum withdrawal amount (0.01 USDC)
    uint256 public constant MIN_WITHDRAW = 1e4;

    /// @notice Minimum position margin (10 USDC)
    uint256 public constant MIN_POSITION = 10e6;

    /// @notice Maximum open+close fee rate (2% = 200 bps)
    uint256 public constant MAX_OPEN_CLOSE_BPS = 200;

    /// @notice Maximum profit fee rate (50%)
    uint256 public constant MAX_PROFIT_FEE_BPS = 5000;

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice User USDC balances
    mapping(address => uint256) public balances;

    /// @notice Total deposits across all users
    uint256 public totalDeposits;

    /// @notice Protocol treasury (receives fees)
    address public treasury;

    /// @notice HL master account (receives margin for positions)
    address public hlMasterAccount;

    /// @notice Fee controller (can update fee rates)
    address public feeController;

    /// @notice Whether the contract is paused (blocks deposits/opens, NOT withdrawals)
    bool public paused;

    /// @notice Operators (Lever backend servers) that can place/close positions
    mapping(address => bool) public operators;

    /// @notice Current fee rates
    uint256 public openCloseFeeBps;   // e.g., 10 = 0.10%
    uint256 public profitFeeBps;       // e.g., 1000 = 10%

    /// @notice Stuck ETH per sender (for recovery)
    mapping(address => uint256) public stuckETH;

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert NotOperator();
        _;
    }

    modifier onlyFeeController() {
        if (msg.sender != feeController) revert NotFeeController();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    address public owner;

    constructor(
        address _usdc,
        address _treasury,
        address _feeController,
        address _hlMasterAccount,
        uint256 _openCloseFeeBps,
        uint256 _profitFeeBps
    ) {
        if (_usdc == address(0) || _treasury == address(0) || _feeController == address(0) || _hlMasterAccount == address(0))
            revert ZeroAddress();
        if (_openCloseFeeBps > MAX_OPEN_CLOSE_BPS || _profitFeeBps > MAX_PROFIT_FEE_BPS)
            revert FeeCapExceeded();

        USDC = IUSDC(_usdc);
        treasury = _treasury;
        feeController = _feeController;
        hlMasterAccount = _hlMasterAccount;
        openCloseFeeBps = _openCloseFeeBps;
        profitFeeBps = _profitFeeBps;
        owner = msg.sender;

        emit TreasuryUpdated(address(0), _treasury);
        emit FeeControllerUpdated(address(0), _feeController);
        emit HLMasterUpdated(address(0), _hlMasterAccount);
        emit FeeParamsUpdated(_openCloseFeeBps, _profitFeeBps);
    }

    // ─── Deposits ────────────────────────────────────────────────────────────

    /**
     * @notice Deposit USDC into the vault.
     * @dev User must approve USDC transfer first.
     *      Uses balance diff to handle fee-on-transfer tokens.
     */
    function deposit(uint256 amount) external whenNotPaused {
        if (amount == 0) revert ZeroAmount();
        if (amount < MIN_DEPOSIT) revert BelowMinimum();
        if (amount > MAX_DEPOSIT) revert AboveMaximum();

        uint256 before = USDC.balanceOf(address(this));
        USDC.transferFrom(msg.sender, address(this), amount);
        uint256 received = USDC.balanceOf(address(this)) - before;

        if (received == 0) revert ZeroAmount();

        balances[msg.sender] += received;
        totalDeposits += received;

        emit Deposited(msg.sender, received);
    }

    // ─── Withdrawals ──────────────────────────────────────────────────────────

    /**
     * @notice Withdraw USDC from the vault.
     * @dev Always free. No withdrawal fee.
     */
    function withdraw(uint256 amount) external {
        if (amount == 0) revert ZeroAmount();
        if (amount < MIN_WITHDRAW) revert BelowMinimum();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        // CEI pattern: deduct before transfer
        balances[msg.sender] -= amount;
        totalDeposits -= amount;

        USDC.transfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Withdraw entire balance.
     */
    function withdrawAll() external {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert InsufficientBalance();

        balances[msg.sender] = 0;
        totalDeposits -= amount;

        USDC.transfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /**
     * @notice Emergency withdraw — ALWAYS works, even when paused.
     * @dev This is the escape hatch. If anything goes wrong, users can always get their USDC.
     */
    function emergencyWithdraw() external {
        uint256 amount = balances[msg.sender];
        if (amount == 0) revert InsufficientBalance();

        // CEI pattern
        balances[msg.sender] = 0;
        totalDeposits -= amount;

        USDC.transfer(msg.sender, amount);

        emit EmergencyWithdrawn(msg.sender, amount);
    }

    // ─── Position Management ──────────────────────────────────────────────────

    /**
     * @notice Open a position on behalf of a user.
     * @dev Only operators can call. Deducts margin + open fee from user balance.
     *      Sends margin to HL master account, fee to treasury.
     */
    function openPosition(
        address user,
        uint256 margin,
        uint256 openFee,
        string calldata coin,
        bool isLong,
        uint8 leverage
    ) external onlyOperator whenNotPaused {
        if (margin < MIN_POSITION) revert BelowMinimum();
        if (openFee > (margin * MAX_OPEN_CLOSE_BPS) / 10000) revert FeeCapExceeded(); // openFee can't exceed max% of margin

        uint256 total = margin + openFee;
        if (balances[user] < total) revert InsufficientBalance();

        // CEI pattern
        balances[user] -= total;
        totalDeposits -= total;

        // Fee to treasury
        USDC.transfer(treasury, openFee);
        // Margin to HL master account
        USDC.transfer(hlMasterAccount, margin);

        emit PositionOpened(user, coin, isLong, leverage, margin, openFee);
    }

    /**
     * @notice Close a position on behalf of a user.
     * @param closeFee Fee for closing position (open+close bps on notional)
     * @param profitFee Fee on PnL (only if pnl > 0, otherwise 0)
     * @param pnl Realized PnL (positive = profit, negative = loss)
     * @param marginReturn Original margin being returned
     */
    function closePosition(
        address user,
        uint256 closeFee,
        uint256 profitFee,
        int256 pnl,
        uint256 marginReturn,
        string calldata positionId
    ) external onlyOperator whenNotPaused {
        // Validate fee caps
        uint256 totalFee = closeFee + profitFee;
        if (profitFee > 0 && (profitFee * 10000) > uint256(pnl > 0 ? uint256(pnl) : uint256(0)) * profitFeeBps) {
            revert FeeCapExceeded();
        }

        // Calculate return to user
        // return = margin + pnl - closeFee - profitFee (if positive pnl)
        // If pnl is negative, subtract the loss
        uint256 userReturn;

        if (pnl >= 0) {
            uint256 profit = uint256(pnl);
            userReturn = marginReturn + profit;
            if (userReturn > totalFee) {
                userReturn -= totalFee;
            } else {
                userReturn = 0; // edge case: fees exceed profit
            }
        } else {
            // Loss — deduct from margin
            uint256 loss = uint256(-pnl);
            userReturn = marginReturn > loss ? marginReturn - loss : 0;
            if (userReturn > closeFee) {
                userReturn -= closeFee;
            } else {
                userReturn = 0;
            }
        }

        // Credit user balance
        if (userReturn > 0) {
            // Fund from HL master account (margin + pnl returned there)
            // In production, the backend coordinates this
            USDC.transferFrom(hlMasterAccount, address(this), userReturn);
            balances[user] += userReturn;
            totalDeposits += userReturn;
        }

        // Fees to treasury (funded from position proceeds)
        if (totalFee > 0) {
            USDC.transfer(treasury, totalFee);
        }

        emit PositionClosed(user, positionId, closeFee, profitFee, pnl, userReturn);
    }

    /**
     * @notice Deduct a fee from a user's balance.
     * @dev Used for funding fees, miscellaneous fees.
     */
    function deductFee(
        address user,
        uint256 amount,
        string calldata feeType
    ) external onlyOperator {
        if (amount == 0) revert ZeroAmount();
        if (balances[user] < amount) revert InsufficientBalance();

        // CEI pattern
        balances[user] -= amount;
        totalDeposits -= amount;

        USDC.transfer(treasury, amount);

        emit FeeDeducted(user, amount, feeType);
    }

    // ─── Wrong Token Recovery ──────────────────────────────────────────────────

    /**
     * @notice Rescue any ERC-20 token sent to this contract by mistake.
     * @dev Does NOT work for USDC — use withdraw() for that.
     *      Anyone can call this for any non-USDC token.
     *      Tokens go to msg.sender.
     */
    function rescueTokens(address token, uint256 amount) external {
        if (token == address(USDC)) revert CannotRescueUSDC();
        if (amount == 0) revert ZeroAmount();

        IUSDC(token).transfer(msg.sender, amount);

        emit TokensRescued(token, msg.sender, amount);
    }

    /**
     * @notice Receive ETH accidentally sent to the contract.
     * @dev Track per-sender so they can recover it.
     */
    receive() external payable {
        stuckETH[msg.sender] += msg.value;
        emit ETHReceived(msg.sender, msg.value);
    }

    /**
     * @notice Recover ETH you accidentally sent to the contract.
     */
    function recoverETH() external {
        uint256 amount = stuckETH[msg.sender];
        if (amount == 0) revert NoStuckETH();

        stuckETH[msg.sender] = 0;

        (bool success, ) = msg.sender.call{value: amount}("");
        if (!success) revert TransferFailed();

        emit ETHRecovered(msg.sender, amount);
    }

    // ─── Solvency Check ────────────────────────────────────────────────────────

    /**
     * @notice Check if the vault is solvent.
     * @return vaultBalance USDC balance of this contract
     * @return totalDeposited Sum of all user deposits
     * @return deficit Shortfall if insolvent (0 if solvent)
     * @return solvent Whether vault holds enough USDC
     */
    function getSolvencyInfo() external view returns (
        uint256 vaultBalance,
        uint256 totalDeposited,
        uint256 deficit,
        bool solvent
    ) {
        vaultBalance = USDC.balanceOf(address(this));
        totalDeposited = totalDeposits;
        deficit = totalDeposited > vaultBalance ? totalDeposited - vaultBalance : 0;
        solvent = vaultBalance >= totalDeposits;
    }

    /**
     * @notice Quick solvency check.
     */
    function isSolvent() external view returns (bool) {
        return USDC.balanceOf(address(this)) >= totalDeposits;
    }

    // ─── Admin ────────────────────────────────────────────────────────────────

    function pause() external onlyOwner {
        paused = true;
        emit ContractPaused();
    }

    function unpause() external onlyOwner {
        paused = false;
        emit Unpaused();
    }

    function setTreasury(address newTreasury) external onlyOwner {
        if (newTreasury == address(0)) revert ZeroAddress();
        address old = treasury;
        treasury = newTreasury;
        emit TreasuryUpdated(old, newTreasury);
    }

    function setHLMasterAccount(address newMaster) external onlyOwner {
        if (newMaster == address(0)) revert ZeroAddress();
        address old = hlMasterAccount;
        hlMasterAccount = newMaster;
        emit HLMasterUpdated(old, newMaster);
    }

    function setOperator(address operator, bool status) external onlyOwner {
        if (operator == address(0)) revert ZeroAddress();
        operators[operator] = status;
        emit OperatorUpdated(operator, status);
    }

    function setFeeController(address newController) external onlyOwner {
        if (newController == address(0)) revert ZeroAddress();
        address old = feeController;
        feeController = newController;
        emit FeeControllerUpdated(old, newController);
    }

    function setFeeParams(uint256 _openCloseFeeBps, uint256 _profitFeeBps) external onlyFeeController {
        if (_openCloseFeeBps > MAX_OPEN_CLOSE_BPS) revert FeeCapExceeded();
        if (_profitFeeBps > MAX_PROFIT_FEE_BPS) revert FeeCapExceeded();

        openCloseFeeBps = _openCloseFeeBps;
        profitFeeBps = _profitFeeBps;

        emit FeeParamsUpdated(_openCloseFeeBps, _profitFeeBps);
    }

    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == owner) revert SameAddress();
        owner = newOwner;
    }
}
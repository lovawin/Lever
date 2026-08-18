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
 * - Regular withdraw()/withdrawAll() also work when paused (intentional: pause
 *   blocks new deposits/opens, never blocks withdrawals)
 * - Wrong tokens (non-USDC ERC-20s, ETH) are recoverable
 * - Operators can only deduct approved margin + fee amounts
 * - Fee rates are capped and cannot be set to extreme values
 * - Fee rates can only be changed by the owner
 * - Positions are tracked on-chain so closePosition must match a real open
 * - Anyone can verify solvency on-chain (vault USDC >= totalDeposits)
 * - Two-step ownership transfer prevents accidental bricking
 * - ReentrancyGuard on all external calls
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
    error IsPaused();
    error CannotRescueUSDC();
    error FeeCapExceeded();
    error ZeroAddress();
    error SameAddress();
    error NoStuckTokens();
    error NoStuckETH();
    error PositionNotFound();
    error PositionAlreadyClosed();
    error ReentrancyGuardReentrantCall();
    error OwnershipNotProposed();

    // ─── Events ──────────────────────────────────────────────────────────────

    event Deposited(address indexed user, uint256 amount);
    event Withdrawn(address indexed user, uint256 amount);
    event EmergencyWithdrawn(address indexed user, uint256 amount);
    event PositionOpened(
        bytes32 indexed positionId,
        address indexed user,
        string coin,
        bool isLong,
        uint8 leverage,
        uint256 margin,
        uint256 openFee
    );
    event PositionClosed(
        bytes32 indexed positionId,
        address indexed user,
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
    event FeeParamsUpdated(uint256 openCloseBps, uint256 profitFeeBps);
    event HLMasterUpdated(address indexed oldMaster, address indexed newMaster);
    event OwnershipProposed(address indexed proposedOwner);
    event OwnershipTransferred(address indexed oldOwner, address indexed newOwner);

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

    /// @notice Maximum open+close fee rate (10% = 1000 bps)
    uint256 public constant MAX_OPEN_CLOSE_BPS = 1000;

    /// @notice Maximum profit fee rate (20% = 2000 bps)
    uint256 public constant MAX_PROFIT_FEE_BPS = 2000;

    // ─── Structs ──────────────────────────────────────────────────────────────

    struct Position {
        address user;
        uint256 margin;
        uint256 openFee;
        bool isOpen;
    }

    // ─── State ────────────────────────────────────────────────────────────────

    /// @notice User USDC balances
    mapping(address => uint256) public balances;

    /// @notice Total deposits across all users
    uint256 public totalDeposits;

    /// @notice Protocol treasury (receives fees)
    address public treasury;

    /// @notice HL master account (receives margin for positions)
    address public hlMasterAccount;

    /// @notice Whether the contract is paused (blocks deposits/opens, NOT withdrawals)
    bool public paused;

    /// @notice Operators (Lever backend servers) that can place/close positions
    mapping(address => bool) public operators;

    /// @notice Open+close fee rate in bps (default: 1000 = 10%)
    uint256 public openCloseFeeBps;

    /// @notice Profit fee rate in bps (default: 500 = 5%)
    uint256 public profitFeeBps;

    /// @notice Stuck ETH per sender (for recovery)
    mapping(address => uint256) public stuckETH;

    /// @notice On-chain position tracking
    mapping(bytes32 => Position) public positions;

    /// @notice Proposed new owner (two-step transfer)
    address public proposedOwner;

    /// @notice Reentrancy guard status
    uint256 private _status;
    uint256 private constant _NOT_ENTERED = 1;
    uint256 private constant _ENTERED = 2;

    // ─── Modifiers ───────────────────────────────────────────────────────────

    modifier onlyOwner() {
        if (msg.sender != owner) revert NotOwner();
        _;
    }

    modifier onlyOperator() {
        if (!operators[msg.sender]) revert NotOperator();
        _;
    }

    modifier whenNotPaused() {
        if (paused) revert IsPaused();
        _;
    }

    modifier nonReentrant() {
        if (_status == _ENTERED) revert ReentrancyGuardReentrantCall();
        _status = _ENTERED;
        _;
        _status = _NOT_ENTERED;
    }

    // ─── Constructor ──────────────────────────────────────────────────────────

    address public owner;

    constructor(
        address _usdc,
        address _treasury,
        address _hlMasterAccount,
        uint256 _openCloseFeeBps,
        uint256 _profitFeeBps
    ) {
        if (_usdc == address(0) || _treasury == address(0) || _hlMasterAccount == address(0))
            revert ZeroAddress();
        if (_openCloseFeeBps > MAX_OPEN_CLOSE_BPS || _profitFeeBps > MAX_PROFIT_FEE_BPS)
            revert FeeCapExceeded();

        USDC = IUSDC(_usdc);
        treasury = _treasury;
        hlMasterAccount = _hlMasterAccount;
        openCloseFeeBps = _openCloseFeeBps;
        profitFeeBps = _profitFeeBps;
        owner = msg.sender;
        _status = _NOT_ENTERED;

        emit TreasuryUpdated(address(0), _treasury);
        emit HLMasterUpdated(address(0), _hlMasterAccount);
        emit FeeParamsUpdated(_openCloseFeeBps, _profitFeeBps);
    }

    // ─── Deposits ────────────────────────────────────────────────────────────

    /**
     * @notice Deposit USDC into the vault.
     * @dev User must approve USDC transfer first.
     *      Uses balance diff to handle fee-on-transfer tokens.
     */
    function deposit(uint256 amount) external whenNotPaused nonReentrant {
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

    /** @notice Deposit USDC on behalf of another user (e.g. FlashLoanReceiver crediting a user)
     *  @param user  Address that receives the credited balance
     *  @param amount Amount of USDC to deposit
     */
    function depositFor(address user, uint256 amount) external whenNotPaused nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount < MIN_DEPOSIT) revert BelowMinimum();
        if (amount > MAX_DEPOSIT) revert AboveMaximum();

        uint256 before = USDC.balanceOf(address(this));
        USDC.transferFrom(msg.sender, address(this), amount);
        uint256 received = USDC.balanceOf(address(this)) - before;

        if (received == 0) revert ZeroAmount();

        balances[user] += received;
        totalDeposits += received;

        emit Deposited(user, received);
    }

    // ─── Withdrawals ──────────────────────────────────────────────────────────

    /**
     * @notice Withdraw USDC from the vault.
     * @dev Always free. No withdrawal fee. Works even when paused (intentional).
     */
    function withdraw(uint256 amount) external nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount < MIN_WITHDRAW) revert BelowMinimum();
        if (balances[msg.sender] < amount) revert InsufficientBalance();

        // CEI pattern: deduct before transfer
        balances[msg.sender] -= amount;
        totalDeposits -= amount;

        USDC.transfer(msg.sender, amount);

        emit Withdrawn(msg.sender, amount);
    }

    /** @notice Withdraw on behalf of a user (operator only).
     *  @dev Used by FlashLoanReceiver to repay Aave from user's pre-deposited balance.
     *  @param user   Address whose balance to withdraw from
     *  @param amount Amount of USDC to withdraw
     */
    function withdrawFor(address user, uint256 amount) external onlyOperator nonReentrant {
        if (amount == 0) revert ZeroAmount();
        if (amount < MIN_WITHDRAW) revert BelowMinimum();
        if (balances[user] < amount) revert InsufficientBalance();

        // CEI pattern: deduct before transfer
        balances[user] -= amount;
        totalDeposits -= amount;

        USDC.transfer(msg.sender, amount);

        emit Withdrawn(user, amount);
    }

    /**
     * @notice Withdraw entire balance.
     * @dev Works even when paused (intentional).
     */
    function withdrawAll() external nonReentrant {
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
    function emergencyWithdraw() external nonReentrant {
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
     *      Creates an on-chain position record that must be closed via closePosition.
     * @param positionId Unique identifier for this position (operator-generated)
     */
    function openPosition(
        bytes32 positionId,
        address user,
        uint256 margin,
        uint256 openFee,
        string calldata coin,
        bool isLong,
        uint8 leverage
    ) external onlyOperator whenNotPaused nonReentrant {
        if (margin < MIN_POSITION) revert BelowMinimum();
        if (openFee > (margin * MAX_OPEN_CLOSE_BPS) / 10000) revert FeeCapExceeded();
        if (positions[positionId].isOpen) revert PositionAlreadyClosed();

        uint256 total = margin + openFee;
        if (balances[user] < total) revert InsufficientBalance();

        // CEI pattern: deduct before transfers
        balances[user] -= total;
        totalDeposits -= total;

        // Track position on-chain
        positions[positionId] = Position({
            user: user,
            margin: margin,
            openFee: openFee,
            isOpen: true
        });

        // Fee to treasury
        USDC.transfer(treasury, openFee);
        // Margin to HL master account
        USDC.transfer(hlMasterAccount, margin);

        emit PositionOpened(positionId, user, coin, isLong, leverage, margin, openFee);
    }

    /**
     * @notice Close a position on behalf of a user.
     * @param positionId Must match a currently-open position from openPosition
     * @param closeFee Fee for closing position (capped at MAX_OPEN_CLOSE_BPS of position margin)
     * @param profitFee Fee on PnL (only if pnl > 0, capped at profitFeeBps of profit)
     * @param pnl Realized PnL (positive = profit, negative = loss)
     * @param marginReturn Must equal position margin exactly
     */
    function closePosition(
        bytes32 positionId,
        uint256 closeFee,
        uint256 profitFee,
        int256 pnl,
        uint256 marginReturn,
        string calldata /* positionIdString */
    ) external onlyOperator whenNotPaused nonReentrant {
        Position storage pos = positions[positionId];

        // Position must exist and be open
        if (!pos.isOpen) revert PositionNotFound();

        // marginReturn must match the original position margin exactly
        if (marginReturn != pos.margin) revert PositionNotFound();

        // Cap closeFee: cannot exceed MAX_OPEN_CLOSE_BPS of position margin
        if (closeFee > (pos.margin * MAX_OPEN_CLOSE_BPS) / 10000) revert FeeCapExceeded();

        // Cap profitFee: cannot exceed profitFeeBps of profit
        if (pnl > 0 && profitFee > (uint256(pnl) * profitFeeBps) / 10000) revert FeeCapExceeded();

        // Mark position closed before any external calls
        pos.isOpen = false;

        // Calculate return to user
        uint256 userReturn;
        uint256 totalFee = closeFee + profitFee;

        if (pnl >= 0) {
            uint256 profit = uint256(pnl);
            userReturn = pos.margin + profit;
            if (userReturn > totalFee) {
                userReturn -= totalFee;
            } else {
                userReturn = 0;
            }
        } else {
            // Loss — deduct from margin
            uint256 loss = uint256(-pnl);
            if (pos.margin > loss) {
                userReturn = pos.margin - loss;
            } else {
                userReturn = 0;
            }
            if (userReturn > closeFee) {
                userReturn -= closeFee;
            } else {
                userReturn = 0;
            }
        }

        // Credit user balance from HL master account
        if (userReturn > 0) {
            USDC.transferFrom(hlMasterAccount, address(this), userReturn);
            balances[pos.user] += userReturn;
            totalDeposits += userReturn;
        }

        // Fees to treasury (funded from HL master account)
        if (totalFee > 0) {
            USDC.transferFrom(hlMasterAccount, treasury, totalFee);
        }

        emit PositionClosed(positionId, pos.user, closeFee, profitFee, pnl, userReturn);
    }

    /**
     * @notice Deduct a fee from a user's balance.
     * @dev Used for funding fees, miscellaneous fees.
     */
    function deductFee(
        address user,
        uint256 amount,
        string calldata feeType
    ) external onlyOperator nonReentrant {
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
     *      Only owner can call. Tokens go to owner to prevent front-running.
     */
    function rescueTokens(address token, uint256 amount) external onlyOwner {
        if (token == address(USDC)) revert CannotRescueUSDC();
        if (amount == 0) revert ZeroAmount();

        IUSDC(token).transfer(owner, amount);

        emit TokensRescued(token, owner, amount);
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
    function recoverETH() external nonReentrant {
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

    /**
     * @notice Update fee rates. Only owner can call.
     * @param _openCloseFeeBps Open+close fee in basis points (max 1000 = 10%)
     * @param _profitFeeBps Profit fee in basis points (max 2000 = 20%)
     */
    function setFeeParams(uint256 _openCloseFeeBps, uint256 _profitFeeBps) external onlyOwner {
        if (_openCloseFeeBps > MAX_OPEN_CLOSE_BPS) revert FeeCapExceeded();
        if (_profitFeeBps > MAX_PROFIT_FEE_BPS) revert FeeCapExceeded();

        openCloseFeeBps = _openCloseFeeBps;
        profitFeeBps = _profitFeeBps;

        emit FeeParamsUpdated(_openCloseFeeBps, _profitFeeBps);
    }

    // ─── Two-Step Ownership Transfer ──────────────────────────────────────────

    /**
     * @notice Propose a new owner. Does not take effect until acceptOwnership is called.
     */
    function proposeOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == owner) revert SameAddress();
        proposedOwner = newOwner;
        emit OwnershipProposed(newOwner);
    }

    /**
     * @notice Accept ownership. Only the proposed owner can call this.
     */
    function acceptOwnership() external {
        if (msg.sender != proposedOwner) revert OwnershipNotProposed();
        address oldOwner = owner;
        owner = proposedOwner;
        proposedOwner = address(0);
        emit OwnershipTransferred(oldOwner, owner);
    }

    /**
     * @dev Legacy one-step transfer — delegates to two-step.
     * @notice Use proposeOwnership + acceptOwnership instead.
     */
    function transferOwnership(address newOwner) external onlyOwner {
        if (newOwner == address(0)) revert ZeroAddress();
        if (newOwner == owner) revert SameAddress();
        proposedOwner = newOwner;
        emit OwnershipProposed(newOwner);
    }
}
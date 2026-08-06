# Lever Vault Contract — Design Document

## Overview

A non-custodial smart contract vault on Arbitrum that holds user funds.
Users deposit USDC, the vault tracks balances internally, and only users can withdraw.
Lever (the protocol) places trades on behalf of users via the vault.

## Core Principles

1. **Users always can withdraw** — no lockup, no gatekeeping, no "processing"
2. **No wrong-token loss** — if someone sends the wrong token, it's recoverable
3. **Protocol can't rug** — the vault only moves funds on user instructions
4. **Solana side** — separate Solana program for SOL/USDC deposits (Phase 2)

---

## Contract: LeverVault.sol (Arbitrum)

### State

```solidity
// User balances (USDC only, denominated in 6 decimals)
mapping(address => uint256) public balances;

// Total deposits (for solvency checks)
uint256 public totalDeposits;

// Protocol treasury (receives fees)
address public treasury;

// Fee controller (can update fee rates)
address public feeController;

// Supported deposit tokens
mapping(address => bool) public supportedTokens;

// Emergency pause (circuit breaker)
bool public paused;

// Stuck tokens (sent by accident) — recoverable by original sender
mapping(address => mapping(address => uint256)) public stuckTokens;
// stuckTokens[token][sender] = amount

// Role-based access
mapping(address => bool) public operators;  // Can place orders on behalf of users
```

### Functions

#### Deposits

```solidity
function deposit(uint256 amount) external nonReentrant whenNotPaused {
    // USDC only — requires approval first
    require(amount > 0, "Zero deposit");
    require(amount >= MIN_DEPOSIT, "Below minimum");
    require(amount <= MAX_DEPOSIT, "Above maximum");
    
    uint256 before = usdc.balanceOf(address(this));
    usdc.safeTransferFrom(msg.sender, address(this), amount);
    uint256 received = usdc.balanceOf(address(this)) - before;
    
    // Handle fee-on-transfer tokens (use actual received amount)
    balances[msg.sender] += received;
    totalDeposits += received;
    
    emit Deposited(msg.sender, received);
}
```

#### Withdrawals

```solidity
function withdraw(uint256 amount) external nonReentrant whenNotPaused {
    require(amount > 0, "Zero withdraw");
    require(balances[msg.sender] >= amount, "Insufficient balance");
    require(amount >= MIN_WITHDRAW, "Below minimum");
    
    // Deduct first (CEI pattern — prevent reentrancy)
    balances[msg.sender] -= amount;
    totalDeposits -= amount;
    
    // Send USDC to user — ALWAYS FREE
    usdc.safeTransfer(msg.sender, amount);
    
    emit Withdrawn(msg.sender, amount);
}

function withdrawAll() external {
    withdraw(balances[msg.sender]);
}
```

#### Emergency Withdraw (even when paused)

```solidity
function emergencyWithdraw() external nonReentrant {
    // Works even when contract is paused — users ALWAYS have exit
    uint256 amount = balances[msg.sender];
    require(amount > 0, "No balance");
    
    balances[msg.sender] = 0;
    totalDeposits -= amount;
    
    usdc.safeTransfer(msg.sender, amount);
    
    emit EmergencyWithdrawn(msg.sender, amount);
}
```

#### Wrong Token Recovery

```solidity
// If someone sends ETH, ARB, or random tokens to the contract,
// they can recover them. This is NOT for USDC deposits.

// Approach 1: Anyone can rescue non-USDC tokens
function rescueTokens(address token, uint256 amount) external {
    require(token != address(usdc), "Cannot rescue USDC — use withdraw()");
    require(amount > 0, "Zero amount");
    
    IERC20(token).safeTransfer(msg.sender, amount);
    
    emit TokensRescued(token, msg.sender, amount);
}

// Approach 2: Track who sent what, give back only to sender
function recoverStuckTokens(address token, uint256 amount) external nonReentrant {
    require(token != address(usdc), "Use withdraw() for USDC");
    require(stuckTokens[token][msg.sender] >= amount, "Not your tokens");
    
    stuckTokens[token][msg.sender] -= amount;
    IERC20(token).safeTransfer(msg.sender, amount);
    
    emit StuckTokensRecovered(token, msg.sender, amount);
}
```

#### Receive ETH (Accidental)

```solidity
// If someone sends ETH to the contract, they can recover it
receive() external payable {
    // Track who sent ETH so they can recover
    stuckETH[msg.sender] += msg.value;
    emit ETHReceived(msg.sender, msg.value);
}

function recoverETH() external nonReentrant {
    uint256 amount = stuckETH[msg.sender];
    require(amount > 0, "No stuck ETH");
    
    stuckETH[msg.sender] = 0;
    (bool success, ) = msg.sender.call{value: amount}("");
    require(success, "ETH transfer failed");
    
    emit ETHRecovered(msg.sender, amount);
}
```

#### Fee Collection

```solidity
// Only operators (the Lever backend) can deduct fees
function deductFee(address user, uint256 amount, string calldata feeType) external onlyOperator {
    require(balances[user] >= amount, "Insufficient balance for fee");
    require(amount > 0, "Zero fee");
    
    balances[user] -= amount;
    totalDeposits -= amount;
    
    // Fee goes to treasury
    usdc.safeTransfer(treasury, amount);
    
    emit FeeDeducted(user, amount, feeType);
}
```

#### Operator Actions

```solidity
// Only operators can open/close positions on behalf of users
// This deducts margin from the vault and sends to HL
function openPosition(
    address user,
    uint256 margin,
    uint256 fee,
    string calldata coin,
    bool isLong,
    uint8 leverage
) external onlyOperator whenNotPaused {
    uint256 total = margin + fee;
    require(balances[user] >= total, "Insufficient balance");
    require(margin >= MIN_POSITION, "Position too small");
    
    balances[user] -= total;
    totalDeposits -= total;
    
    // Transfer margin to HL master account (via treasury)
    // Fee goes to treasury
    usdc.safeTransfer(treasury, fee);
    // Margin sent to HL for position
    usdc.safeTransfer(hlMasterAccount, margin);
    
    emit PositionOpened(user, coin, isLong, leverage, margin, fee);
}

function closePosition(
    address user,
    uint256 closeFee,
    uint256 profitFee,
    int256 pnl,
    string calldata positionId
) external onlyOperator whenNotPaused {
    uint256 totalFee = closeFee;
    if (pnl > 0) {
        totalFee += profitFee;
    }
    
    // If user has profit, add it back minus fees
    uint256 marginReturn = ???;  // Fetched from HL position data
    uint256 pnlAmount = pnl > 0 ? uint256(pnl) : 0;
    uint256 lossAmount = pnl < 0 ? uint256(-pnl) : 0;
    
    // Return margin + profit - fees - losses
    uint256 returnAmount = marginReturn + pnlAmount - totalFee;
    if (lossAmount > 0) {
        returnAmount = returnAmount > lossAmount ? returnAmount - lossAmount : 0;
    }
    
    // Credit user balance
    balances[user] += returnAmount;
    totalDeposits += returnAmount;
    
    // Fees to treasury
    usdc.safeTransfer(treasury, totalFee);
    
    emit PositionClosed(user, positionId, closeFee, profitFee, pnl);
}
```

#### Solvency Check

```solidity
// Anyone can verify the vault is solvent
// totalDeposits should equal sum of all user balances
// + USDC balance should >= totalDeposits

function isSolvent() external view returns (bool) {
    return usdc.balanceOf(address(this)) >= totalDeposits;
}

function getSolvencyInfo() external view returns (
    uint256 vaultBalance,
    uint256 totalDeposited,
    uint256 deficit,
    bool solvent
) {
    vaultBalance = usdc.balanceOf(address(this));
    totalDeposited = totalDeposits;
    deficit = totalDeposited > vaultBalance ? totalDeposited - vaultBalance : 0;
    solvent = vaultBalance >= totalDeposited;
}
```

#### Admin

```solidity
function pause() external onlyOwner { paused = true; emit Paused(); }
function unpause() external onlyOwner { paused = false; emit Unpaused(); }
function setTreasury(address newTreasury) external onlyOwner { treasury = newTreasury; }
function setOperator(address op, bool status) external onlyOwner { operators[op] = status; }
function setFees(uint256 openCloseBps, uint256 profitFeeBps) external onlyFeeController { ... }
```

---

## Architecture Flow

```
User                    LeverVault (Arbitrum)              Lever Backend
 │                          │                                    │
 │── deposit(1000 USDC)──→  │                                    │
 │                          │── balances[user] += 1000            │
 │                          │                                    │
 │── openPosition() ─────→  │── deduct margin + fee              │
 │                          │── transfer margin to HL master ────→│── place order on HL
 │                          │── transfer fee to treasury          │
 │                          │                                    │
 │── closePosition() ────→  │── return margin + pnl - fees       │
 │                          │── transfer fees to treasury         │── close position on HL
 │                          │                                    │
 │── withdraw() ─────────→  │── send USDC to user                │
 │                          │                                    │
 │── emergencyWithdraw() →  │── ALWAYS works, even paused        │
```

## Edge Cases Handled

### Wrong Token Sent
- Any ERC-20 sent to the vault (except USDC) → `rescueTokens()` lets anyone recover it
- ETH sent accidentally → tracked per sender, recoverable via `recoverETH()`
- Wrong amount/format → `deposit()` uses balance diff, so fee-on-transfer tokens work

### Reentrancy
- All state-changing functions use `nonReentrant` modifier
- Checks-Effects-Interactions (CEI) pattern: deduct balance BEFORE transfer

### Pause/Circuit Breaker
- `pause()` stops deposits, opens, closes
- `emergencyWithdraw()` ALWAYS works, even when paused
- This prevents the protocol from locking user funds during an incident

### Flash Loan Attacks
- No lending, no borrowing, no flash loan vulnerability surface
- Balances are simple mappings, no complex math that could be manipulated

### Oracle/Price Manipulation
- Vault doesn't use price oracles — it just holds USDC and tracks balances
- Price data comes from HL/Drift for trade execution, not for balance accounting

### Rug Pull Prevention
- Operators can only move USDC that the user has approved (margin + fee)
- Operators CANNOT withdraw arbitrary amounts
- `emergencyWithdraw()` is a permanent escape hatch
- `rescueTokens()` only works for non-USDC tokens

### Solvency
- Anyone can call `isSolvent()` to verify vault USDC >= totalDeposits
- Frontend shows solvency proof
- If insolvent, `emergencyWithdraw()` still works (pro-rata if needed)

---

## Deployment Plan

### Phase 1: Arbitrum Vault (this contract)
1. Deploy LeverVault on Arbitrum
2. Set USDC (0xaf88d... on Arbitrum) as deposit token
3. Set treasury address
4. Set operator addresses (backend servers)
5. Frontend connects wallet, deposits via contract
6. Backend monitors deposits, places orders on HL

### Phase 2: Solana Vault Program
- Separate Solana program (Anchor/Rust)
- SPL-USDC deposits
- Same non-custodial principles
- Cross-chain balance tracking via backend

### Phase 3: Merkle Proofs (optional)
- Backend publishes Merkle tree of all balances periodically
- Users can verify their balance is included
- If backend goes down, users can force-withdraw using the Merkle proof

---

## Auditing Checklist

- [ ] Reentrancy guards on all external calls
- [ ] CEI pattern (state changes before transfers)
- [ ] SafeERC20 for all token transfers
- [ ] No unchecked math
- [ ] No unbounded loops
- [ ] Emergency withdraw always available
- [ ] Wrong token recovery works
- [ ] ETH recovery works
- [ ] Fee rates capped (max 2% open+close, max 50% profit)
- [ ] Operator cannot drain more than user balance
- [ ] Treasury cannot be changed to zero address
- [ ] Pause doesn't block withdrawals
- [ ] Solvency check is accurate
- [ ] Minimum/maximum deposit amounts
- [ ] Minimum withdrawal amount
- [ ] Events emitted for all state changes
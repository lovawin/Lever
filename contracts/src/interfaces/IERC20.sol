// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

interface IERC20 {
    function totalSupply() external view returns (uint256);
    function balanceOf(address account) external view returns (uint256);
    function transfer(address to, uint256 amount) external returns (bool);
    function allowance(address owner, address spender) external view returns (uint256);
    function approve(address spender, uint256 amount) external returns (bool);
    function transferFrom(address from, address to, uint256 amount) external returns (bool);
}

interface IUSDC is IERC20 {
    // USDC on Arbitrum is a standard ERC-20 with 6 decimals
    function decimals() external view returns (uint8);
}
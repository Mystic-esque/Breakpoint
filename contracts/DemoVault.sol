// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

/// @notice Minimal demo custody contract whose withdrawal pause is controlled by a Safe.
contract DemoVault is ReentrancyGuard {
    using SafeERC20 for IERC20;

    IERC20 public immutable token;
    address public immutable administrator;
    bool public withdrawalsPaused;
    mapping(address => uint256) public balances;

    error Unauthorized();
    error WithdrawalsPaused();
    error InsufficientBalance();

    event Deposited(address indexed depositor, uint256 amount);
    event Withdrawn(address indexed depositor, uint256 amount);
    event WithdrawalPauseChanged(bool paused, address indexed administrator);

    constructor(IERC20 token_, address administrator_) {
        token = token_;
        administrator = administrator_;
    }

    modifier onlyAdministrator() {
        if (msg.sender != administrator) revert Unauthorized();
        _;
    }

    function deposit(uint256 amount) external nonReentrant {
        token.safeTransferFrom(msg.sender, address(this), amount);
        balances[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant {
        if (withdrawalsPaused) revert WithdrawalsPaused();
        if (balances[msg.sender] < amount) revert InsufficientBalance();
        balances[msg.sender] -= amount;
        token.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function pauseWithdrawals() external onlyAdministrator {
        withdrawalsPaused = true;
        emit WithdrawalPauseChanged(true, msg.sender);
    }

    function unpauseWithdrawals() external onlyAdministrator {
        withdrawalsPaused = false;
        emit WithdrawalPauseChanged(false, msg.sender);
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {ERC20} from "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @notice Fee-on-transfer ERC-20 for tests: every transfer burns `feeBps` of
///         the amount, so the recipient receives less than was sent. Used to
///         prove Ante credits the *actually received* amount (balance-delta),
///         not the requested amount.
contract MockFeeERC20 is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable feeBps; // e.g. 100 = 1%

    constructor(string memory name_, string memory symbol_, uint8 decimals_, uint256 feeBps_)
        ERC20(name_, symbol_)
    {
        _decimals = decimals_;
        feeBps = feeBps_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        _mint(to, amount);
    }

    function _update(address from, address to, uint256 value) internal override {
        // Mints/burns (from or to == address(0)) pass through untaxed.
        if (from == address(0) || to == address(0) || feeBps == 0) {
            super._update(from, to, value);
            return;
        }
        uint256 fee = (value * feeBps) / 10_000;
        super._update(from, to, value - fee);
        super._update(from, address(0), fee); // burn the fee
    }
}

// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {AccessControl} from "@openzeppelin/contracts/access/AccessControl.sol";
import {Pausable} from "@openzeppelin/contracts/utils/Pausable.sol";
import {ReentrancyGuard} from "@openzeppelin/contracts/utils/ReentrancyGuard.sol";

import {CallToken} from "../token/CallToken.sol";
import {IdLib} from "../libs/IdLib.sol";

interface IPriceLike {
    function latestAnswer() external view returns (uint256); // 1e18
}

/// @notice Covered-call vault for the **1inch LOP v3** flow:
/// - Maker deposits GNO, mints ERC-1155 options (collateral locked).
/// - Sells those options via 1inch off-chain order.
/// - Post-expiry, vault settles, buyers exercise, makers reclaim.
contract OptionsVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------- roles ----------
    bytes32 public constant SERIES_ADMIN_ROLE = keccak256("SERIES_ADMIN_ROLE");

    // ---------- immutables ----------
    IERC20 public immutable UNDERLYING; // GNO
    CallToken public immutable CALL_TOKEN;

    // ---------- storage ----------
    struct Series {
        address underlying;          // GNO
        uint8   underlyingDecimals;  // 18
        uint256 strike;              // in WXDAI 1e18
        uint64  expiry;              // unix
        uint256 collateralPerOption; // in underlying decimals
        address oracle;              // returns price(GNO/WXDAI) 1e18
        bool    settled;
    }

    // maker balances
    mapping(address => uint256) public collateralBalance;
    mapping(address => uint256) public totalLocked; // cached sum of all locked amounts
    mapping(address => mapping(uint256 => uint256)) public lockedPerSeries;

    // series
    mapping(uint256 => Series) public series;
    mapping(uint256 => uint256) public settlePrice; // 1e18

    // ---------- events ----------
    event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry);
    event Deposited(address indexed maker, uint256 amount);
    event Withdrawn(address indexed maker, uint256 amount);
    event Minted(address indexed maker, uint256 indexed id, uint256 qty, uint256 collateralLocked);
    event Settled(uint256 indexed id, uint256 priceWXDAI, bool inTheMoney);
    event Exercised(address indexed holder, uint256 indexed id, uint256 qty, uint256 payoffGNO);
    event Reclaimed(address indexed maker, uint256 indexed id, uint256 amount);

    // ---------- constants ----------
    uint256 private constant ONE = 1e18;

    constructor(IERC20 underlying, CallToken ct, address admin) {
        UNDERLYING = underlying;
        CALL_TOKEN = ct;
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(SERIES_ADMIN_ROLE, admin);
    }

    // ------------------ Series management ------------------

    function defineSeries(
        address underlying,
        uint8 underlyingDecimals,
        uint256 strike,              // 1e18 WXDAI
        uint64 expiry,
        uint256 collateralPerOption, // in underlying decimals
        address oracle
    ) external onlyRole(SERIES_ADMIN_ROLE) whenNotPaused returns (uint256 id) {
        require(underlying == address(UNDERLYING), "wrong underlying");
        require(expiry > block.timestamp, "expiry in past");
        require(strike > 0, "strike=0");
        require(collateralPerOption > 0, "collat=0");

        id = IdLib.buildId(underlying, strike, expiry);
        require(series[id].expiry == 0, "exists");

        series[id] = Series({
            underlying: underlying,
            underlyingDecimals: underlyingDecimals,
            strike: strike,
            expiry: expiry,
            collateralPerOption: collateralPerOption,
            oracle: oracle,
            settled: false
        });

        emit SeriesDefined(id, underlying, strike, expiry);
    }

    // ------------------ Collateral ------------------

    function deposit(uint256 amount) external nonReentrant whenNotPaused {
        UNDERLYING.safeTransferFrom(msg.sender, address(this), amount);
        collateralBalance[msg.sender] += amount;
        emit Deposited(msg.sender, amount);
    }

    function withdraw(uint256 amount) external nonReentrant whenNotPaused {
        require(amount <= freeCollateralOf(msg.sender), "not enough free");
        collateralBalance[msg.sender] -= amount;
        UNDERLYING.safeTransfer(msg.sender, amount);
        emit Withdrawn(msg.sender, amount);
    }

    function freeCollateralOf(address maker) public view returns (uint256) {
        return collateralBalance[maker] - totalLocked[maker];
    }

    // ------------------ Mint (pre-sell on 1inch v3) ------------------

    function mintOptions(uint256 id, uint256 qty) external nonReentrant whenNotPaused {
        Series memory s = series[id];
        require(s.expiry != 0, "unknown");
        require(block.timestamp < s.expiry, "expired");

        uint256 required = s.collateralPerOption * qty;
        require(freeCollateralOf(msg.sender) >= required, "insufficient collateral");

        lockedPerSeries[msg.sender][id] += required;
        totalLocked[msg.sender] += required;

        CALL_TOKEN.mint(msg.sender, id, qty);
        emit Minted(msg.sender, id, qty, required);
    }

    // ------------------ Settlement ------------------

    function settleSeries(uint256 id) external nonReentrant whenNotPaused {
        Series storage s = series[id];
        require(s.expiry != 0, "unknown");
        require(block.timestamp >= s.expiry, "not expired");
        require(!s.settled, "settled");

        uint256 price = IPriceLike(s.oracle).latestAnswer(); // 1e18 WXDAI
        settlePrice[id] = price;
        s.settled = true;

        bool itm = price > s.strike;
        emit Settled(id, price, itm);
    }

    /// @notice Buyer exercises, receiving GNO worth intrinsic value.
    function exercise(uint256 id, uint256 qty) external nonReentrant whenNotPaused {
        Series memory s = series[id];
        require(s.settled, "not settled");

        uint256 bal = CALL_TOKEN.balanceOf(msg.sender, id);
        require(qty > 0 && qty <= bal, "bad qty");

        uint256 price = settlePrice[id];
        uint256 payoffGNO = 0;

        if (price > s.strike) {
            uint256 intrinsicWx = (price - s.strike) * qty; // 1e18 * qty
            payoffGNO = intrinsicWx * ONE / price;
        }

        CALL_TOKEN.burn(msg.sender, id, qty);

        if (payoffGNO > 0) {
            UNDERLYING.safeTransfer(msg.sender, payoffGNO);
        }

        emit Exercised(msg.sender, id, qty, payoffGNO);
    }

    /// @notice Maker reclaims their locked collateral after settlement.
    /// @dev MVP logic: frees everything they locked. For exact accounting vs exercised qty,
    ///      track per-maker minted/exercised or cash-settle in WXDAI.
    function reclaim(uint256 id) external nonReentrant whenNotPaused {
        Series memory s = series[id];
        require(s.settled, "not settled");

        uint256 locked = lockedPerSeries[msg.sender][id];
        if (locked == 0) return;

        lockedPerSeries[msg.sender][id] = 0;
        totalLocked[msg.sender] -= locked;

        UNDERLYING.safeTransfer(msg.sender, locked);
        emit Reclaimed(msg.sender, id, locked);
    }

    // ------------------ Admin ------------------

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
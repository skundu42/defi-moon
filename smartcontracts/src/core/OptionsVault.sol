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
    function latestAnswer() external view returns (uint256); // 1e18 (WXDAI)
}

/// @notice Covered-call vault with pro-rata realized PnL accounting.
contract OptionsVault is AccessControl, Pausable, ReentrancyGuard {
    using SafeERC20 for IERC20;

    // ---------- roles ----------
    bytes32 public constant SERIES_ADMIN_ROLE = keccak256("SERIES_ADMIN_ROLE");

    // ---------- immutables ----------
    IERC20 public immutable UNDERLYING;
    CallToken public immutable CALL_TOKEN;

    // ---------- storage ----------
    struct Series {
        address underlying;          // must equal UNDERLYING
        uint8   underlyingDecimals;
        uint256 strike;              // WXDAI 1e18
        uint64  expiry;              // unix seconds
        uint256 collateralPerOption; // underlying decimals
        address oracle;              // returns price(UNDERLYING/WXDAI) 1e18
        bool    settled;
    }

    // maker balances
    mapping(address => uint256) public collateralBalance;
    mapping(address => uint256) public totalLocked;
    mapping(address => mapping(uint256 => uint256)) public lockedPerSeries;

    // series data
    mapping(uint256 => Series) public series;
    mapping(uint256 => uint256) public settlePrice;          // WXDAI 1e18

    // series aggregates (for accurate realized PnL)
    mapping(uint256 => uint256) public totalLockedBySeries;  // live (decreases on each reclaim)
    mapping(uint256 => uint256) public lockedBaselineAtSettle; // NEW: frozen at settleSeries()
    mapping(uint256 => uint256) public totalExerciseOut;     // underlying sent via exercise

    // ---------- events ----------
    event SeriesDefined(uint256 indexed id, address indexed underlying, uint256 strike, uint64 expiry);
    event Deposited(address indexed maker, uint256 amount);
    event Withdrawn(address indexed maker, uint256 amount);
    event Minted(address indexed maker, uint256 indexed id, uint256 qty, uint256 collateralLocked);
    event Settled(uint256 indexed id, uint256 priceWXDAI, bool inTheMoneyAtSettle);
    event Exercised(address indexed holder, uint256 indexed id, uint256 qty, uint256 payoffUnderlying);
    event Reclaimed(address indexed maker, uint256 indexed id, uint256 amount);

    // analytics-friendly
    event ExercisePayout(uint256 indexed id, address indexed holder, uint256 qty, uint256 payout, uint256 totalExerciseOutAfter);
    event ReclaimCalculated(
        address indexed maker,
        uint256 indexed id,
        uint256 makerLockedBefore,
        uint256 exerciseShare,
        uint256 reclaimed,
        uint256 totalLockedBySeriesAfter
    );

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

    // ------------------ Mint ------------------

    function mintOptions(uint256 id, uint256 qty) external nonReentrant whenNotPaused {
        Series memory s = series[id];
        require(s.expiry != 0, "unknown");
        require(block.timestamp < s.expiry, "expired");

        uint256 required = s.collateralPerOption * qty;
        require(freeCollateralOf(msg.sender) >= required, "insufficient collateral");

        lockedPerSeries[msg.sender][id] += required;
        totalLocked[msg.sender] += required;
        totalLockedBySeries[id] += required; // live aggregate

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

        // Freeze baseline for pro-rata
        lockedBaselineAtSettle[id] = totalLockedBySeries[id];

        bool itm = price > s.strike;
        emit Settled(id, price, itm);
    }

    /// @notice Buyer exercises after settlement. Pays intrinsic in UNDERLYING.
    function exercise(uint256 id, uint256 qty) external nonReentrant whenNotPaused {
        Series memory s = series[id];
        require(s.settled, "not settled");

        uint256 bal = CALL_TOKEN.balanceOf(msg.sender, id);
        require(qty > 0 && qty <= bal, "bad qty");

        uint256 price = settlePrice[id];
        uint256 payoff = 0;

        if (price > s.strike) {
            uint256 intrinsicWx = (price - s.strike) * qty; // 1e18 * qty
            payoff = intrinsicWx * ONE / price;              // underlying (1e18)
        }

        CALL_TOKEN.burn(msg.sender, id, qty);

        if (payoff > 0) {
            UNDERLYING.safeTransfer(msg.sender, payoff);
            totalExerciseOut[id] += payoff;
            emit ExercisePayout(id, msg.sender, qty, payoff, totalExerciseOut[id]);
        }

        emit Exercised(msg.sender, id, qty, payoff);
    }

    /// @notice Maker reclaims collateral minus pro-rata exercise share, using baseline frozen at settle.
    function reclaim(uint256 id) external nonReentrant whenNotPaused {
        Series memory s = series[id];
        require(s.settled, "not settled");

        uint256 makerLocked = lockedPerSeries[msg.sender][id];
        if (makerLocked == 0) return;

        uint256 baseline = lockedBaselineAtSettle[id];
        // If baseline is 0 (shouldn't happen if there were mints), fall back to makerLocked to avoid div by zero.
        if (baseline == 0) baseline = makerLocked;

        uint256 share = 0;
        if (totalExerciseOut[id] > 0) {
            share = (totalExerciseOut[id] * makerLocked) / baseline;
            if (share > makerLocked) share = makerLocked; // clamp
        }

        uint256 reclaimable = makerLocked - share;

        // state updates
        lockedPerSeries[msg.sender][id] = 0;
        totalLocked[msg.sender] -= makerLocked;

        // live aggregate (for info only)
        if (totalLockedBySeries[id] >= makerLocked) {
            totalLockedBySeries[id] -= makerLocked;
        } else {
            totalLockedBySeries[id] = 0;
        }

        if (reclaimable > 0) {
            UNDERLYING.safeTransfer(msg.sender, reclaimable);
        }

        emit ReclaimCalculated(
            msg.sender,
            id,
            makerLocked,
            share,
            reclaimable,
            totalLockedBySeries[id]
        );

        emit Reclaimed(msg.sender, id, reclaimable);
    }

    // ------------------ Views ------------------

    function exerciseShareOf(address maker, uint256 id) public view returns (uint256) {
        uint256 makerLocked = lockedPerSeries[maker][id];
        if (makerLocked == 0) return 0;
        uint256 baseline = lockedBaselineAtSettle[id];
        if (baseline == 0) return 0;
        uint256 out = totalExerciseOut[id];
        if (out == 0) return 0;

        uint256 share = (out * makerLocked) / baseline;
        if (share > makerLocked) share = makerLocked;
        return share;
    }

    function reclaimableOf(address maker, uint256 id) external view returns (uint256 reclaimable, uint256 share) {
        uint256 makerLocked = lockedPerSeries[maker][id];
        if (makerLocked == 0) return (0, 0);
        share = exerciseShareOf(maker, id);
        reclaimable = makerLocked - share;
    }

    // ------------------ Admin ------------------

    function pause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _pause();
    }

    function unpause() external onlyRole(DEFAULT_ADMIN_ROLE) {
        _unpause();
    }
}
// SPDX-License-Identifier: UNLICENSED
pragma solidity ^0.8.24;

import "forge-std/Test.sol";
import "../src/core/OptionsVault.sol"; // adjust path if needed
import "../src/token/CallToken.sol";
import "../src/oracle/ChainlinkPriceAdapter.sol";
import "../src/core/ERC1155TransferProxy.sol";

// Minimal ERC20 mock
contract MockERC20 is IERC20 {
    string public name = "MockUnderlying";
    string public symbol = "MCK";
    uint8 public decimals = 18;
    mapping(address => uint256) public balanceOf;
    mapping(address => mapping(address => uint256)) public allowance;
    uint256 public totalSupply;

    function transfer(address to, uint256 amount) external returns (bool) {
        require(balanceOf[msg.sender] >= amount, "balance");
        balanceOf[msg.sender] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    function approve(address spender, uint256 amount) external returns (bool) {
        allowance[msg.sender][spender] = amount;
        return true;
    }

    function transferFrom(address from, address to, uint256 amount) external returns (bool) {
        require(balanceOf[from] >= amount, "balance");
        require(allowance[from][msg.sender] >= amount, "allowance");
        allowance[from][msg.sender] -= amount;
        balanceOf[from] -= amount;
        balanceOf[to] += amount;
        return true;
    }

    // Mint helper
    function mint(address to, uint256 amount) external {
        balanceOf[to] += amount;
        totalSupply += amount;
    }

    // IERC20 views
    function totalSupply() external view returns (uint256) {
        return totalSupply;
    }
}

// Minimal Chainlink-style aggregator mock
contract MockAggregatorV3 is IAggregatorV3 {
    int256 public answer;
    uint8 public override decimals = 18;
    uint256 public updatedAt;

    function setAnswer(int256 _answer) external {
        answer = _answer;
        updatedAt = block.timestamp;
    }

    function latestRoundData()
        external
        view
        override
        returns (
            uint80,
            int256,
            uint256,
            uint256 updated,
            uint80
        )
    {
        return (0, answer, 0, updatedAt, 0);
    }
}

// Simplified “limit order protocol” mock for call options.
// Buyer/seller submit orders, simple match if price condition met.
contract MockLimitOrderProtocol {
    // Order to buy a given option id for a premium in underlying
    struct BuyOrder {
        address buyer;
        uint256 optionId;
        uint256 qty;
        uint256 maxPremium; // in underlying units per option
        bool filled;
    }

    // Seller fills order by delivering options and receives premium.
    mapping(bytes32 => BuyOrder) public orders;

    OptionsVault public vault;
    CallToken public callToken;
    IERC20 public underlying;

    constructor(OptionsVault _vault, CallToken _callToken, IERC20 _underlying) {
        vault = _vault;
        callToken = _callToken;
        underlying = _underlying;
    }

    // Buyer creates order; funds premium upfront escrowed here.
    function createBuyOrder(
        bytes32 salt,
        uint256 optionId,
        uint256 qty,
        uint256 maxPremiumPerOption
    ) external {
        uint256 totalPremium = maxPremiumPerOption * qty;
        require(underlying.transferFrom(msg.sender, address(this), totalPremium), "premium transfer");
        bytes32 key = keccak256(abi.encodePacked(salt, msg.sender, optionId, qty, maxPremiumPerOption));
        orders[key] = BuyOrder({
            buyer: msg.sender,
            optionId: optionId,
            qty: qty,
            maxPremium: maxPremiumPerOption,
            filled: false
        });
    }

    // Seller fills the buy order if they own the options. Pays nothing extra, receives premium.
    function fillBuyOrder(
        bytes32 salt,
        address buyer,
        uint256 optionId,
        uint256 qty,
        uint256 premiumPerOption
    ) external {
        bytes32 key = keccak256(abi.encodePacked(salt, buyer, optionId, qty, premiumPerOption));
        BuyOrder storage o = orders[key];
        require(!o.filled, "already filled");
        require(o.qty == qty, "qty mismatch");
        require(o.optionId == optionId, "option mismatch");
        require(o.buyer == buyer, "buyer mismatch");
        require(premiumPerOption <= o.maxPremium, "premium too high");

        // Transfer options from seller to buyer
        // Seller must have approved this contract or use proxy if needed
        callToken.safeTransferFrom(msg.sender, buyer, optionId, qty, "");

        // Pay seller the premium (qty * premiumPerOption)
        uint256 payout = premiumPerOption * qty;
        require(underlying.transfer(msg.sender, payout), "pay seller");

        o.filled = true;
    }

    // Refund buyer if order never filled (helper for test)
    function refund(
        bytes32 salt,
        address buyer,
        uint256 optionId,
        uint256 qty,
        uint256 maxPremiumPerOption
    ) external {
        bytes32 key = keccak256(abi.encodePacked(salt, buyer, optionId, qty, maxPremiumPerOption));
        BuyOrder storage o = orders[key];
        require(!o.filled, "filled");
        require(o.buyer == buyer, "buyer mismatch");
        uint256 locked = maxPremiumPerOption * qty;
        require(underlying.transfer(buyer, locked), "refund");
        o.filled = true; // mark as closed
    }
}

contract OptionsVaultTest is Test {
    // Actors
    address maker = vm.addr(1);
    address buyer = vm.addr(2);
    address admin = vm.addr(3);

    // Contracts
    MockERC20 underlying;
    MockAggregatorV3 aggregator;
    ChainlinkPriceAdapter priceAdapter;
    CallToken callToken;
    OptionsVault vault;
    ERC1155TransferProxy proxy;
    MockLimitOrderProtocol limiter;

    uint256 constant INITIAL_COLLATERAL = 1_000e18;
    uint256 constant OPTION_QTY = 10;
    uint256 constant COLLATERAL_PER_OPTION = 10e18; // maker must lock 10 underlying per option
    uint64 expiry;
    uint256 seriesId;

    function setUp() public {
        // Deploy mocks and core
        underlying = new MockERC20();
        aggregator = new MockAggregatorV3();
        priceAdapter = new ChainlinkPriceAdapter(IAggregatorV3(address(aggregator)), 1 days);
        callToken = new CallToken("https://base/", admin);
        vault = new OptionsVault(IERC20(address(underlying)), callToken, admin);
        proxy = new ERC1155TransferProxy();

        // Grant vault minter role on CallToken
        vm.prank(admin);
        callToken._grantRole(callToken.MINTER_ROLE(), address(vault));

        // Fund maker and buyer
        underlying.mint(maker, INITIAL_COLLATERAL);
        underlying.mint(buyer, INITIAL_COLLATERAL);

        // Approvals
        vm.prank(maker);
        underlying.approve(address(vault), type(uint256).max);

        vm.prank(buyer);
        underlying.approve(address(this), type(uint256).max); // for limit order creation

        // Define series parameters
        expiry = uint64(block.timestamp + 1 days);
        seriesId = IdLib.buildId(address(underlying), 1e18 /*strike*/, expiry);

        // Give maker collateral and define series
        vm.prank(admin);
        vault.defineSeries(address(underlying), 18, 1e18, expiry, COLLATERAL_PER_OPTION, address(priceAdapter));

        // Maker deposits collateral
        vm.prank(maker);
        vault.deposit(COLLATERAL_PER_OPTION * OPTION_QTY); // enough to mint 10 options

        // Maker mints options
        vm.prank(maker);
        vault.mintOptions(seriesId, OPTION_QTY);

        // Deploy mock limit order protocol
        limiter = new MockLimitOrderProtocol(vault, callToken, IERC20(address(underlying)));
    }

    function test_fullHappyPath_ITM_exercise_and_reclaim() public {
        // Set price above strike so option is ITM: strike=1e18, price=1.5e18
        vm.prank(address(aggregator));
        aggregator.setAnswer(int256(1_500e15)); // 1.5 * 1e18 (scale)
        // fast-forward to expiry
        vm.warp(expiry + 1);

        // Settle series
        vm.prank(admin);
        vault.settleSeries(seriesId);

        // Buyer has no options yet. Simulate buyer receiving options via limit order:
        // Setup limit order: buyer wants to buy 5 options, willing to pay 5 underlying each (premium)
        uint256 buyQty = 5;
        uint256 premiumPerOption = 5e18;
        bytes32 salt = keccak256("order1");

        vm.prank(buyer);
        underlying.approve(address(limiter), type(uint256).max);
        vm.prank(buyer);
        limiter.createBuyOrder(salt, seriesId, buyQty, premiumPerOption);

        // Maker sells 5 options to buyer via limit order filling at premiumPerOption
        vm.prank(maker);
        // Need to mint to maker already has them from vault; but CallToken balanceOf(maker) is the option qty
        // Approve protocol to transfer call tokens
        callToken.setApprovalForAll(address(limiter), true);
        vm.prank(maker);
        limitFillBuyOrder(salt, buyer, seriesId, buyQty, premiumPerOption);

        // Buyer exercises the 5 options: payoff calculation
        uint256 price = vault.settlePrice(seriesId);
        // payoff = intrinsicWx * ONE / price. intrinsicWx = (price - strike)*qty
        uint256 intrinsicWx = (price - 1e18) * buyQty; // (0.5e18)*5
        uint256 expectedPayoff = intrinsicWx * 1e18 / price;

        // Buyer exercises
        vm.prank(buyer);
        vault.exercise(seriesId, buyQty);

        // Validate payoff transferred
        uint256 buyerUnderlying = underlying.balanceOf(buyer);
        assertEq(buyerUnderlying, expectedPayoff, "buyer payoff mismatch");

        // Maker reclaims: their collateral was 10 * 10 =100 underlying; they sold 5 options so exercise share should reflect
        vm.prank(maker);
        (uint256 reclaimable, uint256 share) = vault.reclaimableOf(maker, seriesId);
        // share should be proportional to exercised amount
        uint256 lockedMaker = vault.lockedPerSeries(maker, seriesId);
        uint256 baseline = vault.lockedBaselineAtSettle(seriesId);
        uint256 totalExerciseOut = vault.totalExerciseOut(seriesId);
        uint256 expectedShare = (totalExerciseOut * lockedMaker) / baseline;
        if (expectedShare > lockedMaker) expectedShare = lockedMaker;
        assertEq(share, expectedShare, "exercise share mismatch");

        uint256 beforeCollateral = underlying.balanceOf(maker);
        vm.prank(maker);
        vault.reclaim(seriesId);
        uint256 afterCollateral = underlying.balanceOf(maker);
        assertGt(afterCollateral, beforeCollateral, "maker reclaim not increased");
    }

    // Helper to wrap limit order fill (since internal API)
    function limitFillBuyOrder(
        bytes32 salt,
        address buyerAddr,
        uint256 optionId,
        uint256 qty,
        uint256 premiumPerOption
    ) internal {
        // This triggers the fill function on the mock protocol
        limiter.fillBuyOrder(salt, buyerAddr, optionId, qty, premiumPerOption);
    }

    function test_settle_twice_reverts() public {
        vm.warp(expiry + 1);
        vm.prank(admin);
        vault.settleSeries(seriesId);

        vm.prank(admin);
        vm.expectRevert("settled");
        vault.settleSeries(seriesId);
    }

    function test_withdraw_without_free_collateral_reverts() public {
        // Maker used all collateral to mint
        vm.prank(maker);
        vm.expectRevert("not enough free");
        vault.withdraw(1e18);
    }

    function test_exercise_out_of_the_money_does_nothing() public {
        // Set price below strike: 0.5e18
        vm.prank(address(aggregator));
        aggregator.setAnswer(int256(0.5e18));
        vm.warp(expiry + 1);
        vm.prank(admin);
        vault.settleSeries(seriesId);

        // Buyer has no options; simulate buyer buying 1 option at discount
        // Make buyer own one option by direct transfer from maker
        vm.prank(maker);
        callToken.safeTransferFrom(maker, buyer, seriesId, 1, "");

        // Exercise; price < strike so payoff 0
        vm.prank(buyer);
        vault.exercise(seriesId, 1);

        // No underlying change for buyer
        assertEq(underlying.balanceOf(buyer), 0, "should not get payoff");
    }

    function test_reclaim_when_nothing_locked_is_noop() public {
        // New user with nothing locked calls reclaim
        address random = vm.addr(99);
        vm.prank(random);
        vault.reclaim(seriesId); // should not revert
    }
}
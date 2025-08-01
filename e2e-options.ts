import { 
  createWalletClient, 
  createPublicClient, 
  http, 
  parseUnits, 
  formatUnits, 
  keccak256,
  encodeAbiParameters,
  Address,
  encodeFunctionData,
  parseAbi
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { gnosis } from 'viem/chains';
import { readFileSync, existsSync } from 'fs';
import { join } from 'path';

// ═══════════════════════════════════════════════════════════════════════════════
//                            CONFIGURATION & SETUP
// ═══════════════════════════════════════════════════════════════════════════════

// Contract addresses (update these with your deployed addresses)
const CONTRACTS = {
  VAULT: "0xB4048ce69523CF463bC37b648279e6EF66CaEBAf" as Address,
  CALL_TOKEN: "0x7b964e3dC49DAcB3971CA49f53629e2e11885016" as Address,
  ERC1155_PROXY: "0x639e4E6cFF7d9a9bcFCa09ac8282CF037D40f9Fd" as Address,
  ORACLE: "0xf3FcEd095bDD651b1Ea24F46EE5645Ab4169e955" as Address,
  GNO_TOKEN: "0x9C58BAcC331c9aa871AFD802DB6379a98e80CEdb" as Address,
  WXDAI_TOKEN: "0xe91D153E0b41518A2Ce8Dd3D7944Fa863463a97d" as Address,
  ONEINCH_LOP: "0x111111125421ca6dc452d289314280a0f8842a65" as Address,
  ONEINCH_ROUTER: "0x111111254eeb25477b68fb85ed929f73a960582" as Address,
};

// Configuration
const RPC_URL = process.env.GNOSIS_RPC_URL || "https://rpc.gnosischain.com";
const MAKER_PRIVATE_KEY = `0xdf77199f9e2cad3b641209515927148e76690e40036331f349b40224e4feac40`;
const TAKER_PRIVATE_KEY = `0xbc9f6873385cc6d453352f90aabd6a3a712692f390860d3e479f95bcce85b0d4`; // Default taker key

// Test parameters
const TEST_CONFIG = {
  DEPOSIT_AMOUNT: parseUnits("0.001", 18),    // 0.005 GNO
  COLLATERAL_PER_OPTION: parseUnits("0.001", 18), // 0.001 GNO per option
  STRIKE_PRICE: parseUnits("150", 18),        // 150 WXDAI
  EXPIRY_DAYS: 7,                             // 7 days from now
  OPTIONS_TO_MINT: 1n,                        // Mint 3 options
  OPTIONS_TO_SELL: 1n,                        // Sell 2 options on 1inch
  OPTION_PREMIUM: parseUnits("0.001", 18),        // 5 WXDAI per option
  MIN_GNO_BALANCE: parseUnits("0.006", 18),  // Minimum GNO needed
  MIN_GAS_BALANCE: parseUnits("0.05", 18),   // Minimum xDAI for gas
  MIN_WXDAI_BALANCE: parseUnits("15", 18),   // Minimum WXDAI for taker
  ORDER_DURATION: 3600,                       // 1 hour order duration
};

// SERIES_ADMIN_ROLE constant
const SERIES_ADMIN_ROLE = `0x31614bb72d45cac63afb2594a1e18378fbabc0e1821b20fb54a1e918334a268a`;

// Standard ERC20 ABI  
const ERC20_ABI = [
  {
    name: "approve",
    type: "function", 
    stateMutability: "nonpayable",
    inputs: [
      { name: "spender", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "transfer",
    type: "function",
    stateMutability: "nonpayable", 
    inputs: [
      { name: "to", type: "address" },
      { name: "amount", type: "uint256" }
    ],
    outputs: [{ name: "", type: "bool" }]
  },
  {
    name: "balanceOf",
    type: "function",
    stateMutability: "view",
    inputs: [{ name: "account", type: "address" }],
    outputs: [{ name: "", type: "uint256" }]
  },
  {
    name: "allowance",
    type: "function",
    stateMutability: "view",
    inputs: [
      { name: "owner", type: "address" },
      { name: "spender", type: "address" }
    ],
    outputs: [{ name: "", type: "uint256" }]
  }
] as const;

// ERC1155Proxy ABI for converting ERC1155 to ERC20
const ERC1155_PROXY_ABI = parseAbi([
  'function wrapToken(uint256 tokenId, uint256 amount) external',
  'function unwrapToken(uint256 tokenId, uint256 amount) external',
  'function balanceOf(address account, uint256 tokenId) external view returns (uint256)',
  'function totalSupply(uint256 tokenId) external view returns (uint256)',
  'function approve(address spender, uint256 amount) external returns (bool)',
  'function allowance(address owner, address spender) external view returns (uint256)',
  'function transfer(address to, uint256 amount) external returns (bool)',
  'function transferFrom(address from, address to, uint256 amount) external returns (bool)',
]);

// 1inch Limit Order Protocol ABI (essential functions)
const ONEINCH_LOP_ABI = parseAbi([
  'function fillOrder((uint256 salt, address makerAsset, address takerAsset, address maker, address receiver, address allowedSender, uint256 makingAmount, uint256 takingAmount, uint256 offsets, bytes interactions) order, bytes signature, bytes interaction, uint256 makingAmount, uint256 takingAmount) external returns (uint256, uint256, bytes32)',
  'function cancelOrder((uint256 salt, address makerAsset, address takerAsset, address maker, address receiver, address allowedSender, uint256 makingAmount, uint256 takingAmount, uint256 offsets, bytes interactions) order) external',
  'function invalidatorForOrderRFQ(address maker, uint256 slot) external view returns (uint256)',
  'function orderStatus(bytes32 orderHash) external view returns (uint256)',
  'function hashOrder((uint256 salt, address makerAsset, address takerAsset, address maker, address receiver, address allowedSender, uint256 makingAmount, uint256 takingAmount, uint256 offsets, bytes interactions) order) external view returns (bytes32)',
]);

// ERC1155 ABI for options tokens
const ERC1155_ABI = parseAbi([
  'function balanceOf(address account, uint256 id) external view returns (uint256)',
  'function setApprovalForAll(address operator, bool approved) external',
  'function isApprovedForAll(address account, address operator) external view returns (bool)',
  'function safeTransferFrom(address from, address to, uint256 id, uint256 amount, bytes calldata data) external',
]);

// ═══════════════════════════════════════════════════════════════════════════════
//                               UTILITY FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

function loadABI(contractName: string) {
  const artifactPath = join(process.cwd(), 'smartcontracts', 'out', `${contractName}.sol`, `${contractName}.json`);
  
  if (!existsSync(artifactPath)) {
    throw new Error(`ABI file not found: ${artifactPath}\nRun 'forge build' in the smartcontracts directory.`);
  }
  
  try {
    const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
    if (!artifact.abi || !Array.isArray(artifact.abi)) {
      throw new Error(`Invalid ABI format in ${artifactPath}`);
    }
    return artifact.abi;
  } catch (error: any) {
    throw new Error(`Failed to parse ABI for ${contractName}: ${error.message}`);
  }
}

function buildSeriesId(underlying: Address, strike: bigint, expiry: bigint): bigint {
  const encoded = encodeAbiParameters(
    [{ name: 'underlying', type: 'address' }, { name: 'strike', type: 'uint256' }, { name: 'expiry', type: 'uint64' }],
    [underlying, strike, expiry]
  );
  return BigInt(keccak256(encoded));
}

async function waitForTx(hash: `0x${string}`, label: string, publicClient: any) {
  console.log(`⏳ ${label}... (${hash.slice(0, 10)}...)`);
  try {
    const receipt = await publicClient.waitForTransactionReceipt({ hash });
    console.log(`✅ ${label} confirmed (block ${receipt.blockNumber}, gas: ${receipt.gasUsed})`);
    return receipt;
  } catch (error: any) {
    throw new Error(`Transaction failed - ${label}: ${error.message}`);
  }
}

function logStepHeader(step: number, title: string) {
  console.log(`\n${'═'.repeat(80)}`);
  console.log(`  STEP ${step}: ${title.toUpperCase()}`);
  console.log(`${'═'.repeat(80)}`);
}

function logError(step: number, title: string, error: any) {
  console.error(`\n❌ STEP ${step} FAILED: ${title}`);
  console.error(`Error: ${error.message || error}`);
  if (error.stack) {
    console.error(`Stack: ${error.stack}`);
  }
}

// 1inch Order utilities
function generateSalt(): bigint {
  return BigInt(Math.floor(Date.now() / 1000) + Math.floor(Math.random() * 1000000));
}

function buildOrder(params: {
  salt: bigint;
  makerAsset: Address;
  takerAsset: Address;
  maker: Address;
  receiver: Address;
  makingAmount: bigint;
  takingAmount: bigint;
}) {
  return {
    salt: params.salt,
    makerAsset: params.makerAsset,
    takerAsset: params.takerAsset,
    maker: params.maker,
    receiver: params.receiver,
    allowedSender: '0x0000000000000000000000000000000000000000' as Address,
    makingAmount: params.makingAmount,
    takingAmount: params.takingAmount,
    offsets: 0n,
    interactions: '0x' as `0x${string}`,
  };
}

async function signOrder(order: any, account: any, chainId: number, verifyingContract: Address) {
  const domain = {
    name: '1inch Limit Order Protocol',
    version: '3',
    chainId,
    verifyingContract,
  };

  const types = {
    Order: [
      { name: 'salt', type: 'uint256' },
      { name: 'makerAsset', type: 'address' },
      { name: 'takerAsset', type: 'address' },
      { name: 'maker', type: 'address' },
      { name: 'receiver', type: 'address' },
      { name: 'allowedSender', type: 'address' },
      { name: 'makingAmount', type: 'uint256' },
      { name: 'takingAmount', type: 'uint256' },
      { name: 'offsets', type: 'uint256' },
      { name: 'interactions', type: 'bytes' },
    ],
  };

  return await account.signTypedData({
    domain,
    types,
    primaryType: 'Order',
    message: order,
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//                            MAKER SIDE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function step1_MakerEnvironmentValidation(): Promise<{
  VAULT_ABI: any;
  CALL_TOKEN_ABI: any;
  ORACLE_ABI: any;
  publicClient: any;
  makerClient: any;
  makerAccount: any;
}> {
  logStepHeader(1, "Maker - Environment & ABI Validation");
  
  if (!MAKER_PRIVATE_KEY || !MAKER_PRIVATE_KEY.startsWith('0x')) {
    throw new Error("MAKER_PRIVATE_KEY environment variable is required and must start with '0x'");
  }
  
  console.log("✅ Environment variables validated");
  
  console.log("📂 Loading contract ABIs...");
  const VAULT_ABI = loadABI('OptionsVault');
  const CALL_TOKEN_ABI = loadABI('CallToken');
  const ORACLE_ABI = loadABI('ChainlinkPriceAdapter');
  console.log("✅ All ABIs loaded successfully");
  
  console.log("🔗 Initializing blockchain clients...");
  const publicClient = createPublicClient({
    chain: gnosis,
    transport: http(RPC_URL),
  });
  
  const makerAccount = privateKeyToAccount(MAKER_PRIVATE_KEY as `0x${string}`);
  const makerClient = createWalletClient({
    account: makerAccount,
    chain: gnosis,
    transport: http(RPC_URL),
  });
  
  try {
    const blockNumber = await publicClient.getBlockNumber();
    console.log(`✅ Connected to Gnosis Chain (block ${blockNumber})`);
  } catch (error) {
    throw new Error(`Failed to connect to RPC endpoint: ${RPC_URL}`);
  }
  
  console.log(`✅ Maker account: ${makerAccount.address}`);
  
  return { VAULT_ABI, CALL_TOKEN_ABI, ORACLE_ABI, publicClient, makerClient, makerAccount };
}

async function step2_MakerAccountValidation(publicClient: any, makerAccount: any): Promise<void> {
  logStepHeader(2, "Maker - Account & Balance Validation");
  
  console.log("💰 Checking maker account balances...");
  
  const [gnoBalance, xdaiBalance] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.GNO_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [makerAccount.address],
    }),
    publicClient.getBalance({ address: makerAccount.address })
  ]);
  
  console.log(`Maker GNO balance: ${formatUnits(gnoBalance, 18)}`);
  console.log(`Maker xDAI balance: ${formatUnits(xdaiBalance, 18)}`);
  
  if (gnoBalance < TEST_CONFIG.MIN_GNO_BALANCE) {
    throw new Error(
      `Insufficient GNO balance. Need ${formatUnits(TEST_CONFIG.MIN_GNO_BALANCE, 18)} GNO, ` +
      `have ${formatUnits(gnoBalance, 18)} GNO`
    );
  }
  
  if (xdaiBalance < TEST_CONFIG.MIN_GAS_BALANCE) {
    throw new Error(
      `Insufficient xDAI for gas. Need ${formatUnits(TEST_CONFIG.MIN_GAS_BALANCE, 18)} xDAI, ` +
      `have ${formatUnits(xdaiBalance, 18)} xDAI`
    );
  }
  
  console.log("✅ Maker balances validated");
}

async function step3_AdminRoleValidation(publicClient: any, makerAccount: any, VAULT_ABI: any): Promise<void> {
  logStepHeader(3, "Maker - Admin Role Verification (REQUIRED)");
  
  console.log("🔐 Checking SERIES_ADMIN_ROLE...");
  
  const hasAdminRole = await publicClient.readContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: 'hasRole',
    args: [SERIES_ADMIN_ROLE, makerAccount.address],
  });
  
  console.log(`SERIES_ADMIN_ROLE: ${hasAdminRole}`);
  
  if (!hasAdminRole) {
    throw new Error(
      `Maker account ${makerAccount.address} does not have SERIES_ADMIN_ROLE.\n` +
      `Grant the role using: vault.grantRole(SERIES_ADMIN_ROLE, "${makerAccount.address}")`
    );
  }
  
  console.log("✅ Admin role verified - proceeding with series definition");
}

async function step4_SeriesDefinition(
  publicClient: any, 
  makerClient: any, 
  VAULT_ABI: any
): Promise<{ seriesId: bigint; expiry: bigint; strike: bigint }> {
  logStepHeader(4, "Maker - Option Series Definition");
  
  const currentTime = Math.floor(Date.now() / 1000);
  const expiry = BigInt(currentTime + (TEST_CONFIG.EXPIRY_DAYS * 24 * 60 * 60));
  const strike = TEST_CONFIG.STRIKE_PRICE;
  const collateralPerOption = TEST_CONFIG.COLLATERAL_PER_OPTION;
  
  const seriesId = buildSeriesId(CONTRACTS.GNO_TOKEN, strike, expiry);
  
  console.log("📋 Series parameters:");
  console.log(`  Series ID: ${seriesId.toString()}`);
  console.log(`  Underlying: GNO (${CONTRACTS.GNO_TOKEN})`);
  console.log(`  Strike: ${formatUnits(strike, 18)} WXDAI`);
  console.log(`  Expiry: ${new Date(Number(expiry) * 1000).toISOString()}`);
  console.log(`  Collateral per option: ${formatUnits(collateralPerOption, 18)} GNO`);
  
  let seriesExists = false;
  try {
    const existingSeries = await publicClient.readContract({
      address: CONTRACTS.VAULT,
      abi: VAULT_ABI,
      functionName: 'series',
      args: [seriesId],
    });
    seriesExists = existingSeries.expiry > 0;
  } catch (error) {
    seriesExists = false;
  }
  
  if (seriesExists) {
    console.log("⚠️  Series already exists, skipping definition");
  } else {
    console.log("📝 Defining new option series...");
    
    try {
      const defineSeriesTx = await makerClient.writeContract({
        address: CONTRACTS.VAULT,
        abi: VAULT_ABI,
        functionName: 'defineSeries',
        args: [
          CONTRACTS.GNO_TOKEN,
          18, // GNO decimals
          strike,
          Number(expiry),
          collateralPerOption,
          CONTRACTS.ORACLE
        ],
      });
      
      await waitForTx(defineSeriesTx, "Series Definition", publicClient);
      
      const newSeries = await publicClient.readContract({
        address: CONTRACTS.VAULT,
        abi: VAULT_ABI,
        functionName: 'series',
        args: [seriesId],
      });
      
      if (newSeries.expiry === 0n) {
        throw new Error("Series was not created successfully");
      }
      
      console.log("✅ Series defined successfully");
    } catch (error: any) {
      throw new Error(`Failed to define series: ${error.message}`);
    }
  }
  
  return { seriesId, expiry, strike };
}

async function step5_CollateralDeposit(
  publicClient: any,
  makerClient: any, 
  makerAccount: any,
  VAULT_ABI: any
): Promise<void> {
  logStepHeader(5, "Maker - Collateral Deposit");
  
  const depositAmount = TEST_CONFIG.DEPOSIT_AMOUNT;
  
  const currentCollateral = await publicClient.readContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: 'collateralBalance',
    args: [makerAccount.address],
  });
  
  console.log(`Current collateral: ${formatUnits(currentCollateral, 18)} GNO`);
  console.log(`Deposit amount: ${formatUnits(depositAmount, 18)} GNO`);
  
  const totalNeeded = depositAmount;
  if (currentCollateral >= totalNeeded) {
    console.log("✅ Sufficient collateral already deposited");
    return;
  }
  
  const amountToDeposit = totalNeeded - currentCollateral;
  console.log(`Need to deposit: ${formatUnits(amountToDeposit, 18)} GNO`);
  
  const currentAllowance = await publicClient.readContract({
    address: CONTRACTS.GNO_TOKEN,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [makerAccount.address, CONTRACTS.VAULT],
  });
  
  console.log(`Current allowance: ${formatUnits(currentAllowance, 18)} GNO`);
  
  if (currentAllowance < amountToDeposit) {
    console.log("📝 Approving GNO...");
    const approveAmount = amountToDeposit * 2n;
    
    const approveTx = await makerClient.writeContract({
      address: CONTRACTS.GNO_TOKEN,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.VAULT, approveAmount],
    });
    
    await waitForTx(approveTx, "GNO Approval", publicClient);
    console.log("✅ GNO approved");
  }
  
  console.log("📝 Depositing collateral...");
  const depositTx = await makerClient.writeContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: 'deposit',
    args: [amountToDeposit],
  });
  
  await waitForTx(depositTx, "Collateral Deposit", publicClient);
  
  const finalCollateral = await publicClient.readContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: 'collateralBalance',
    args: [makerAccount.address],
  });
  
  console.log(`✅ Collateral deposited. New balance: ${formatUnits(finalCollateral, 18)} GNO`);
}

async function step6_OptionMinting(
  publicClient: any,
  makerClient: any,
  makerAccount: any,
  VAULT_ABI: any,
  CALL_TOKEN_ABI: any,
  seriesId: bigint
): Promise<void> {
  logStepHeader(6, "Maker - Option Minting");
  
  const optionsToMint = TEST_CONFIG.OPTIONS_TO_MINT;
  const requiredCollateral = TEST_CONFIG.COLLATERAL_PER_OPTION * optionsToMint;
  
  console.log(`Options to mint: ${optionsToMint}`);
  console.log(`Required collateral: ${formatUnits(requiredCollateral, 18)} GNO`);
  
  const freeCollateral = await publicClient.readContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: 'freeCollateralOf',
    args: [makerAccount.address],
  });
  
  console.log(`Free collateral: ${formatUnits(freeCollateral, 18)} GNO`);
  
  if (freeCollateral < requiredCollateral) {
    throw new Error(
      `Insufficient free collateral. Need ${formatUnits(requiredCollateral, 18)} GNO, ` +
      `have ${formatUnits(freeCollateral, 18)} GNO`
    );
  }
  
  const initialOptionBalance = await publicClient.readContract({
    address: CONTRACTS.CALL_TOKEN,
    abi: CALL_TOKEN_ABI,
    functionName: 'balanceOf',
    args: [makerAccount.address, seriesId],
  });
  
  console.log(`Initial option balance: ${initialOptionBalance}`);
  
  console.log("📝 Minting options...");
  const mintTx = await makerClient.writeContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: 'mintOptions',
    args: [seriesId, optionsToMint],
  });
  
  await waitForTx(mintTx, "Option Minting", publicClient);
  
  const finalOptionBalance = await publicClient.readContract({
    address: CONTRACTS.CALL_TOKEN,
    abi: CALL_TOKEN_ABI,
    functionName: 'balanceOf',
    args: [makerAccount.address, seriesId],
  });
  
  const mintedOptions = finalOptionBalance - initialOptionBalance;
  
  if (mintedOptions !== optionsToMint) {
    throw new Error(
      `Option minting failed. Expected ${optionsToMint} options, ` +
      `but balance only increased by ${mintedOptions}`
    );
  }
  
  console.log(`✅ Options minted successfully: ${mintedOptions}`);
}

async function step7_WrapAndCreate1inchOrder(
  publicClient: any,
  makerClient: any,
  makerAccount: any,
  seriesId: bigint
): Promise<{ order: any; orderHash: string; signature: string }> {
  logStepHeader(7, "Maker - Wrap ERC1155 & Create 1inch Order");
  
  const optionsToSell = TEST_CONFIG.OPTIONS_TO_SELL;
  const pricePerOption = TEST_CONFIG.OPTION_PREMIUM;
  const totalPrice = optionsToSell * pricePerOption;
  
  console.log(`Wrapping and selling ${optionsToSell} options for ${formatUnits(totalPrice, 18)} WXDAI`);
  console.log(`Price per option: ${formatUnits(pricePerOption, 18)} WXDAI`);
  
  // Check current option balance
  const optionBalance = await publicClient.readContract({
    address: CONTRACTS.CALL_TOKEN,
    abi: ERC1155_ABI,
    functionName: 'balanceOf',
    args: [makerAccount.address, seriesId],
  });
  
  if (optionBalance < optionsToSell) {
    throw new Error(
      `Insufficient options to sell. Have ${optionBalance}, trying to sell ${optionsToSell}`
    );
  }
  
  // Step 1: Approve ERC1155 for the proxy
  const isApprovedForProxy = await publicClient.readContract({
    address: CONTRACTS.CALL_TOKEN,
    abi: ERC1155_ABI,
    functionName: 'isApprovedForAll',
    args: [makerAccount.address, CONTRACTS.ERC1155_PROXY],
  });
  
  if (!isApprovedForProxy) {
    console.log("📝 Approving ERC1155 for ERC1155Proxy...");
    const approveTx = await makerClient.writeContract({
      address: CONTRACTS.CALL_TOKEN,
      abi: ERC1155_ABI,
      functionName: 'setApprovalForAll',
      args: [CONTRACTS.ERC1155_PROXY, true],
    });
    
    await waitForTx(approveTx, "ERC1155 Approval for Proxy", publicClient);
    console.log("✅ ERC1155 approved for proxy");
  }
  
  // Step 2: Wrap ERC1155 tokens to ERC20 via proxy
  console.log("📦 Wrapping ERC1155 options to ERC20...");
  const wrapTx = await makerClient.writeContract({
    address: CONTRACTS.ERC1155_PROXY,
    abi: ERC1155_PROXY_ABI,
    functionName: 'wrapToken',
    args: [seriesId, optionsToSell],
  });
  
  await waitForTx(wrapTx, "ERC1155 Wrapping", publicClient);
  
  // Verify wrapping worked
  const wrappedBalance = await publicClient.readContract({
    address: CONTRACTS.ERC1155_PROXY,
    abi: ERC1155_PROXY_ABI,
    functionName: 'balanceOf',
    args: [makerAccount.address, seriesId],
  });
  
  if (wrappedBalance < optionsToSell) {
    throw new Error(`Wrapping failed. Expected ${optionsToSell}, got ${wrappedBalance}`);
  }
  
  console.log(`✅ Wrapped ${optionsToSell} ERC1155 options to ERC20`);
  
  // Step 3: Approve wrapped tokens for 1inch
  console.log("📝 Approving wrapped tokens for 1inch...");
  const approveForOneinchTx = await makerClient.writeContract({
    address: CONTRACTS.ERC1155_PROXY,
    abi: ERC1155_PROXY_ABI,
    functionName: 'approve',
    args: [CONTRACTS.ONEINCH_LOP, optionsToSell * 2n], // Approve double for safety
  });
  
  await waitForTx(approveForOneinchTx, "Wrapped Token Approval for 1inch", publicClient);
  console.log("✅ Wrapped tokens approved for 1inch");
  
  // Step 4: Build the order (now using ERC20 wrapped tokens)
  const salt = generateSalt();
  const order = buildOrder({
    salt,
    makerAsset: CONTRACTS.ERC1155_PROXY, // Selling wrapped ERC20 tokens
    takerAsset: CONTRACTS.WXDAI_TOKEN,   // Receiving WXDAI
    maker: makerAccount.address,
    receiver: makerAccount.address,
    makingAmount: optionsToSell,         // Amount of wrapped tokens to sell
    takingAmount: totalPrice,            // Amount of WXDAI to receive
  });
  
  console.log("📝 Order details:");
  console.log(`  Salt: ${salt}`);
  console.log(`  Making (Wrapped Options): ${order.makingAmount}`);
  console.log(`  Taking (WXDAI): ${formatUnits(order.takingAmount, 18)}`);
  
  // Step 5: Sign the order
  console.log("✍️  Signing order...");
  const signature = await signOrder(order, makerAccount, gnosis.id, CONTRACTS.ONEINCH_LOP);
  
  // Step 6: Get order hash
  const orderHash = await publicClient.readContract({
    address: CONTRACTS.ONEINCH_LOP,
    abi: ONEINCH_LOP_ABI,
    functionName: 'hashOrder',
    args: [order],
  });
  
  console.log(`✅ Order created and signed`);
  console.log(`Order hash: ${orderHash}`);
  console.log(`Signature: ${signature.slice(0, 20)}...`);
  
  return { order, orderHash, signature };
}

// ═══════════════════════════════════════════════════════════════════════════════
//                            TAKER SIDE FUNCTIONS
// ═══════════════════════════════════════════════════════════════════════════════

async function step8_TakerSetup(): Promise<{
  takerClient: any;
  takerAccount: any;
  publicClient: any;
}> {
  logStepHeader(8, "Taker - Environment Setup");
  
  if (!TAKER_PRIVATE_KEY || !TAKER_PRIVATE_KEY.startsWith('0x')) {
    throw new Error("TAKER_PRIVATE_KEY environment variable is required and must start with '0x'");
  }
  
  const publicClient = createPublicClient({
    chain: gnosis,
    transport: http(RPC_URL),
  });
  
  const takerAccount = privateKeyToAccount(TAKER_PRIVATE_KEY as `0x${string}`);
  const takerClient = createWalletClient({
    account: takerAccount,
    chain: gnosis,
    transport: http(RPC_URL),
  });
  
  console.log(`✅ Taker account: ${takerAccount.address}`);
  
  return { takerClient, takerAccount, publicClient };
}

async function step9_TakerBalanceValidation(publicClient: any, takerAccount: any): Promise<void> {
  logStepHeader(9, "Taker - Balance Validation");
  
  console.log("💰 Checking taker account balances...");
  
  const [wxdaiBalance, xdaiBalance] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.WXDAI_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address],
    }),
    publicClient.getBalance({ address: takerAccount.address })
  ]);
  
  console.log(`Taker WXDAI balance: ${formatUnits(wxdaiBalance, 18)}`);
  console.log(`Taker xDAI balance: ${formatUnits(xdaiBalance, 18)}`);
  
  if (wxdaiBalance < TEST_CONFIG.MIN_WXDAI_BALANCE) {
    throw new Error(
      `Insufficient WXDAI balance. Need ${formatUnits(TEST_CONFIG.MIN_WXDAI_BALANCE, 18)} WXDAI, ` +
      `have ${formatUnits(wxdaiBalance, 18)} WXDAI`
    );
  }
  
  if (xdaiBalance < TEST_CONFIG.MIN_GAS_BALANCE) {
    throw new Error(
      `Insufficient xDAI for gas. Need ${formatUnits(TEST_CONFIG.MIN_GAS_BALANCE, 18)} xDAI, ` +
      `have ${formatUnits(xdaiBalance, 18)} xDAI`
    );
  }
  
  console.log("✅ Taker balances validated");
}

async function step10_PrepareForOrderFill(
  publicClient: any,
  takerClient: any,
  takerAccount: any,
  order: any
): Promise<void> {
  logStepHeader(10, "Taker - Prepare for Order Fill");
  
  const totalCost = order.takingAmount;
  
  console.log(`Order requires ${formatUnits(totalCost, 18)} WXDAI`);
  
  // Check WXDAI allowance for 1inch
  const currentAllowance = await publicClient.readContract({
    address: CONTRACTS.WXDAI_TOKEN,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [takerAccount.address, CONTRACTS.ONEINCH_LOP],
  });
  
  console.log(`Current WXDAI allowance: ${formatUnits(currentAllowance, 18)}`);
  
  if (currentAllowance < totalCost) {
    console.log("📝 Approving WXDAI for 1inch...");
    const approveAmount = totalCost * 2n; // Approve double for safety
    
    const approveTx = await takerClient.writeContract({
      address: CONTRACTS.WXDAI_TOKEN,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.ONEINCH_LOP, approveAmount],
    });
    
    await waitForTx(approveTx, "WXDAI Approval for 1inch", publicClient);
    
    // Verify approval
    const newAllowance = await publicClient.readContract({
      address: CONTRACTS.WXDAI_TOKEN,
      abi: ERC20_ABI,
      functionName: 'allowance',
      args: [takerAccount.address, CONTRACTS.ONEINCH_LOP],
    });
    
    if (newAllowance < totalCost) {
      throw new Error("Approval transaction succeeded but allowance is still insufficient");
    }
    
    console.log("✅ WXDAI approved for 1inch");
  }
  
  console.log("✅ Taker prepared for order fill");
}

async function step11_FillOrderAndUnwrap(
  publicClient: any,
  takerClient: any,
  takerAccount: any,
  order: any,
  signature: string,
  seriesId: bigint
): Promise<void> {
  logStepHeader(11, "Taker - Fill Order & Unwrap ERC1155");
  
  const makingAmount = order.makingAmount; // Wrapped tokens to receive
  const takingAmount = order.takingAmount; // WXDAI to pay
  
  console.log(`Filling order:`);
  console.log(`  Paying: ${formatUnits(takingAmount, 18)} WXDAI`);
  console.log(`  Receiving: ${makingAmount} wrapped option tokens`);
  
  // Check order status before filling
  const orderHash = await publicClient.readContract({
    address: CONTRACTS.ONEINCH_LOP,
    abi: ONEINCH_LOP_ABI,
    functionName: 'hashOrder',
    args: [order],
  });
  
  const orderStatus = await publicClient.readContract({
    address: CONTRACTS.ONEINCH_LOP,
    abi: ONEINCH_LOP_ABI,
    functionName: 'orderStatus',
    args: [orderHash],
  });
  
  console.log(`Order hash: ${orderHash}`);
  console.log(`Order status: ${orderStatus} (0 = not filled)`);
  
  if (orderStatus !== 0n) {
    throw new Error(`Order cannot be filled. Status: ${orderStatus}`);
  }
  
  // Get initial balances
  const [initialWxdaiBalance, initialOptionBalance] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.WXDAI_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address],
    }),
    publicClient.readContract({
      address: CONTRACTS.CALL_TOKEN,
      abi: ERC1155_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address, seriesId],
    })
  ]);
  
  console.log(`Initial taker WXDAI: ${formatUnits(initialWxdaiBalance, 18)}`);
  console.log(`Initial taker options: ${initialOptionBalance}`);
  
  // Fill the order
  console.log("📝 Filling order on 1inch...");
  const fillTx = await takerClient.writeContract({
    address: CONTRACTS.ONEINCH_LOP,
    abi: ONEINCH_LOP_ABI,
    functionName: 'fillOrder',
    args: [
      order,
      signature,
      '0x', // No interaction
      makingAmount, // Full amount
      takingAmount, // Full amount
    ],
  });
  
  await waitForTx(fillTx, "Order Fill", publicClient);
  
  // Check wrapped token balance after fill
  const wrappedBalance = await publicClient.readContract({
    address: CONTRACTS.ERC1155_PROXY,
    abi: ERC1155_PROXY_ABI,
    functionName: 'balanceOf',
    args: [takerAccount.address, seriesId],
  });
  
  console.log(`Wrapped tokens received: ${wrappedBalance}`);
  
  if (wrappedBalance > 0) {
    // Unwrap the tokens back to ERC1155
    console.log("📦 Unwrapping ERC20 tokens back to ERC1155...");
    const unwrapTx = await takerClient.writeContract({
      address: CONTRACTS.ERC1155_PROXY,
      abi: ERC1155_PROXY_ABI,
      functionName: 'unwrapToken',
      args: [seriesId, wrappedBalance],
    });
    
    await waitForTx(unwrapTx, "Token Unwrapping", publicClient);
    console.log("✅ Tokens unwrapped back to ERC1155");
  }
  
  // Verify the final result
  const [finalWxdaiBalance, finalOptionBalance] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.WXDAI_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address],
    }),
    publicClient.readContract({
      address: CONTRACTS.CALL_TOKEN,
      abi: ERC1155_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address, seriesId],
    })
  ]);
  
  const wxdaiSpent = initialWxdaiBalance - finalWxdaiBalance;
  const optionsReceived = finalOptionBalance - initialOptionBalance;
  
  console.log(`✅ Order filled and unwrapped successfully!`);
  console.log(`WXDAI spent: ${formatUnits(wxdaiSpent, 18)}`);
  console.log(`ERC1155 options received: ${optionsReceived}`);
  
  if (wxdaiSpent !== takingAmount) {
    console.log(`⚠️  Expected to spend ${formatUnits(takingAmount, 18)} WXDAI, actually spent ${formatUnits(wxdaiSpent, 18)}`);
  }
  
  if (optionsReceived !== makingAmount) {
    console.log(`⚠️  Expected to receive ${makingAmount} options, actually received ${optionsReceived}`);
  }
}

async function step12_OraclePriceValidation(
  publicClient: any,
  ORACLE_ABI: any,
  strike: bigint
): Promise<void> {
  logStepHeader(12, "Oracle Price Validation");
  
  console.log("📊 Fetching current GNO price from oracle...");
  
  try {
    const currentPrice = await publicClient.readContract({
      address: CONTRACTS.ORACLE,
      abi: ORACLE_ABI,
      functionName: 'latestAnswer',
      args: [],
    });
    
    console.log(`Current GNO price: ${formatUnits(currentPrice, 18)} WXDAI`);
    console.log(`Strike price: ${formatUnits(strike, 18)} WXDAI`);
    
    const priceDiff = currentPrice - strike;
    const priceDiffPercent = Number((priceDiff * 100n) / strike);
    
    if (currentPrice > strike) {
      console.log(`✅ Option is IN-THE-MONEY by ${formatUnits(priceDiff, 18)} WXDAI (${priceDiffPercent.toFixed(2)}%)`);
    } else if (currentPrice === strike) {
      console.log(`⚖️  Option is AT-THE-MONEY`);
    } else {
      const deficit = strike - currentPrice;
      const deficitPercent = Number((deficit * 100n) / strike);
      console.log(`📉 Option is OUT-OF-THE-MONEY by ${formatUnits(deficit, 18)} WXDAI (${deficitPercent.toFixed(2)}%)`);
    }
    
    if (currentPrice === 0n) {
      throw new Error("Oracle returned zero price - invalid price feed");
    }
    
    const maxReasonablePrice = parseUnits("10000", 18); // 10,000 WXDAI max
    if (currentPrice > maxReasonablePrice) {
      throw new Error(`Oracle price seems unreasonably high: ${formatUnits(currentPrice, 18)} WXDAI`);
    }
    
    console.log("✅ Oracle price validated");
    
  } catch (error: any) {
    throw new Error(`Oracle price validation failed: ${error.message}`);
  }
}

async function step13_ExerciseOptions(
  publicClient: any,
  takerClient: any,
  takerAccount: any,
  VAULT_ABI: any,
  seriesId: bigint,
  strike: bigint,
  ORACLE_ABI: any
): Promise<void> {
  logStepHeader(13, "Taker - Exercise Options (if profitable)");
  
  // Check current price vs strike
  const currentPrice = await publicClient.readContract({
    address: CONTRACTS.ORACLE,
    abi: ORACLE_ABI,
    functionName: 'latestAnswer',
    args: [],
  });
  
  console.log(`Current price: ${formatUnits(currentPrice, 18)} WXDAI`);
  console.log(`Strike price: ${formatUnits(strike, 18)} WXDAI`);
  
  if (currentPrice <= strike) {
    console.log("❌ Options are out-of-the-money, not exercising");
    return;
  }
  
  const profit = currentPrice - strike;
  console.log(`✅ Options are in-the-money! Potential profit: ${formatUnits(profit, 18)} WXDAI per option`);
  
  // Check how many options taker has
  const optionBalance = await publicClient.readContract({
    address: CONTRACTS.CALL_TOKEN,
    abi: ERC1155_ABI,
    functionName: 'balanceOf',
    args: [takerAccount.address, seriesId],
  });
  
  if (optionBalance === 0n) {
    console.log("❌ No options to exercise");
    return;
  }
  
  console.log(`Exercising ${optionBalance} options...`);
  
  // Need to approve WXDAI for exercise (to pay strike price)
  const strikePayment = strike * optionBalance;
  
  const currentAllowance = await publicClient.readContract({
    address: CONTRACTS.WXDAI_TOKEN,
    abi: ERC20_ABI,
    functionName: 'allowance',
    args: [takerAccount.address, CONTRACTS.VAULT],
  });
  
  if (currentAllowance < strikePayment) {
    console.log("📝 Approving WXDAI for exercise...");
    const approveTx = await takerClient.writeContract({
      address: CONTRACTS.WXDAI_TOKEN,
      abi: ERC20_ABI,
      functionName: "approve",
      args: [CONTRACTS.VAULT, strikePayment * 2n],
    });
    
    await waitForTx(approveTx, "WXDAI Approval for Exercise", publicClient);
  }
  
  // Get initial balances
  const [initialGnoBalance, initialWxdaiBalance] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.GNO_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address],
    }),
    publicClient.readContract({
      address: CONTRACTS.WXDAI_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address],
    })
  ]);
  
  console.log(`Initial GNO balance: ${formatUnits(initialGnoBalance, 18)}`);
  console.log(`Initial WXDAI balance: ${formatUnits(initialWxdaiBalance, 18)}`);
  
  // Exercise options
  console.log("📝 Exercising options...");
  const exerciseTx = await takerClient.writeContract({
    address: CONTRACTS.VAULT,
    abi: VAULT_ABI,
    functionName: 'exerciseOptions',
    args: [seriesId, optionBalance],
  });
  
  await waitForTx(exerciseTx, "Option Exercise", publicClient);
  
  // Check final balances
  const [finalGnoBalance, finalWxdaiBalance, finalOptionBalance] = await Promise.all([
    publicClient.readContract({
      address: CONTRACTS.GNO_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address],
    }),
    publicClient.readContract({
      address: CONTRACTS.WXDAI_TOKEN,
      abi: ERC20_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address],
    }),
    publicClient.readContract({
      address: CONTRACTS.CALL_TOKEN,
      abi: ERC1155_ABI,
      functionName: 'balanceOf',
      args: [takerAccount.address, seriesId],
    })
  ]);
  
  const gnoReceived = finalGnoBalance - initialGnoBalance;
  const wxdaiSpent = initialWxdaiBalance - finalWxdaiBalance;
  
  console.log(`✅ Options exercised successfully!`);
  console.log(`GNO received: ${formatUnits(gnoReceived, 18)}`);
  console.log(`WXDAI spent: ${formatUnits(wxdaiSpent, 18)}`);
  console.log(`Remaining options: ${finalOptionBalance}`);
  
  const actualProfit = (gnoReceived * currentPrice / parseUnits("1", 18)) - wxdaiSpent;
  console.log(`Net profit: ${formatUnits(actualProfit, 18)} WXDAI equivalent`);
}

async function step14_FinalStateVerification(
  publicClient: any,
  makerAccount: any,
  takerAccount: any,
  VAULT_ABI: any,
  seriesId: bigint
): Promise<void> {
  logStepHeader(14, "Final State Verification");
  
  console.log("🔍 Gathering final state information...");
  
  try {
    const [
      makerCollateralBalance,
      makerTotalLocked,
      makerFreeCollateral,
      makerOptionBalance,
      makerWxdaiBalance,
      takerOptionBalance,
      takerGnoBalance,
      takerWxdaiBalance,
      seriesInfo
    ] = await Promise.all([
      publicClient.readContract({
        address: CONTRACTS.VAULT,
        abi: VAULT_ABI,
        functionName: 'collateralBalance',
        args: [makerAccount.address],
      }),
      publicClient.readContract({
        address: CONTRACTS.VAULT,
        abi: VAULT_ABI,
        functionName: 'totalLocked',
        args: [makerAccount.address],
      }),
      publicClient.readContract({
        address: CONTRACTS.VAULT,
        abi: VAULT_ABI,
        functionName: 'freeCollateralOf',
        args: [makerAccount.address],
      }),
      publicClient.readContract({
        address: CONTRACTS.CALL_TOKEN,
        abi: ERC1155_ABI,
        functionName: 'balanceOf',
        args: [makerAccount.address, seriesId],
      }),
      publicClient.readContract({
        address: CONTRACTS.WXDAI_TOKEN,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [makerAccount.address],
      }),
      publicClient.readContract({
        address: CONTRACTS.CALL_TOKEN,
        abi: ERC1155_ABI,
        functionName: 'balanceOf',
        args: [takerAccount.address, seriesId],
      }),
      publicClient.readContract({
        address: CONTRACTS.GNO_TOKEN,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [takerAccount.address],
      }),
      publicClient.readContract({
        address: CONTRACTS.WXDAI_TOKEN,
        abi: ERC20_ABI,
        functionName: 'balanceOf',
        args: [takerAccount.address],
      }),
      publicClient.readContract({
        address: CONTRACTS.VAULT,
        abi: VAULT_ABI,
        functionName: 'series',
        args: [seriesId],
      })
    ]);
    
    console.log("\n📊 FINAL MAKER STATE:");
    console.log(`├─ Account: ${makerAccount.address}`);
    console.log(`├─ Total Collateral: ${formatUnits(makerCollateralBalance, 18)} GNO`);
    console.log(`├─ Locked Collateral: ${formatUnits(makerTotalLocked, 18)} GNO`);
    console.log(`├─ Free Collateral: ${formatUnits(makerFreeCollateral, 18)} GNO`);
    console.log(`├─ Remaining Options: ${makerOptionBalance} tokens`);
    console.log(`└─ WXDAI Balance: ${formatUnits(makerWxdaiBalance, 18)} WXDAI`);
    
    console.log("\n📊 FINAL TAKER STATE:");
    console.log(`├─ Account: ${takerAccount.address}`);
    console.log(`├─ Option Balance: ${takerOptionBalance} tokens`);
    console.log(`├─ GNO Balance: ${formatUnits(takerGnoBalance, 18)} GNO`);
    console.log(`└─ WXDAI Balance: ${formatUnits(takerWxdaiBalance, 18)} WXDAI`);
    
    console.log("\n📋 SERIES INFORMATION:");
    console.log(`├─ Series ID: ${seriesId.toString()}`);
    console.log(`├─ Underlying: ${seriesInfo.underlying}`);
    console.log(`├─ Strike: ${formatUnits(seriesInfo.strike, 18)} WXDAI`);
    console.log(`├─ Expiry: ${new Date(Number(seriesInfo.expiry) * 1000).toISOString()}`);
    console.log(`├─ Collateral/Option: ${formatUnits(seriesInfo.collateralPerOption, 18)} GNO`);
    console.log(`└─ Settled: ${seriesInfo.settled}`);
    
    console.log("\n📈 TRADE SUMMARY:");
    console.log(`├─ Options Minted: ${TEST_CONFIG.OPTIONS_TO_MINT}`);
    console.log(`├─ Options Sold: ${TEST_CONFIG.OPTIONS_TO_SELL}`);
    console.log(`├─ Premium per Option: ${formatUnits(TEST_CONFIG.OPTION_PREMIUM, 18)} WXDAI`);
    console.log(`├─ Total Premium: ${formatUnits(TEST_CONFIG.OPTIONS_TO_SELL * TEST_CONFIG.OPTION_PREMIUM, 18)} WXDAI`);
    console.log(`└─ Strike Price: ${formatUnits(TEST_CONFIG.STRIKE_PRICE, 18)} WXDAI`);
    
    // Validate final state makes sense
    if (makerCollateralBalance !== makerTotalLocked + makerFreeCollateral) {
      throw new Error(
        `Maker collateral balance mismatch. Total: ${formatUnits(makerCollateralBalance, 18)}, ` +
        `Locked + Free: ${formatUnits(makerTotalLocked + makerFreeCollateral, 18)}`
      );
    }
    
    console.log("✅ Final state verification passed");
    
  } catch (error: any) {
    throw new Error(`Final state verification failed: ${error.message}`);
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//                                MAIN EXECUTION
// ═══════════════════════════════════════════════════════════════════════════════

async function main() {
  console.log("🚀 COMPLETE END-TO-END OPTIONS TRADING SCRIPT WITH 1INCH");
  console.log("═".repeat(80));
  console.log("This script executes the full options trading lifecycle:");
  console.log("1. MAKER: Creates options, lists on 1inch");
  console.log("2. TAKER: Buys options, exercises if profitable");
  console.log("═".repeat(80));
  
  let currentStep = 0;
  let sharedData: any = {};
  
  try {
    // ═══════════════════════════════════════════════════════════════════════════
    //                              MAKER SIDE
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Step 1: Maker Environment & ABI Validation
    currentStep = 1;
    const { VAULT_ABI, CALL_TOKEN_ABI, ORACLE_ABI, publicClient, makerClient, makerAccount } = 
      await step1_MakerEnvironmentValidation();
    sharedData = { VAULT_ABI, CALL_TOKEN_ABI, ORACLE_ABI, publicClient, makerAccount };
    
    // Step 2: Maker Account & Balance Validation
    currentStep = 2;
    await step2_MakerAccountValidation(publicClient, makerAccount);
    
    // Step 3: Admin Role Verification (REQUIRED)
    currentStep = 3;
    await step3_AdminRoleValidation(publicClient, makerAccount, VAULT_ABI);
    
    // Step 4: Series Definition
    currentStep = 4;
    const { seriesId, expiry, strike } = await step4_SeriesDefinition(publicClient, makerClient, VAULT_ABI);
    sharedData.seriesId = seriesId;
    sharedData.expiry = expiry;
    sharedData.strike = strike;
    
    // Step 5: Collateral Deposit
    currentStep = 5;
    await step5_CollateralDeposit(publicClient, makerClient, makerAccount, VAULT_ABI);
    
    // Step 6: Option Minting
    currentStep = 6;
    await step6_OptionMinting(publicClient, makerClient, makerAccount, VAULT_ABI, CALL_TOKEN_ABI, seriesId);
    
    // Step 7: Wrap and Create 1inch Order
    currentStep = 7;
    const { order, orderHash, signature } = await step7_WrapAndCreate1inchOrder(
      publicClient, makerClient, makerAccount, seriesId
    );
    sharedData.order = order;
    sharedData.orderHash = orderHash;
    sharedData.signature = signature;
    
    // ═══════════════════════════════════════════════════════════════════════════
    //                              TAKER SIDE
    // ═══════════════════════════════════════════════════════════════════════════
    
    // Step 8: Taker Setup
    currentStep = 8;
    const { takerClient, takerAccount } = await step8_TakerSetup();
    sharedData.takerAccount = takerAccount;
    
    // Step 9: Taker Balance Validation
    currentStep = 9;
    await step9_TakerBalanceValidation(publicClient, takerAccount);
    
    // Step 10: Prepare for Order Fill
    currentStep = 10;
    await step10_PrepareForOrderFill(publicClient, takerClient, takerAccount, order);
    
    // Step 11: Fill Order and Unwrap
    currentStep = 11;
    await step11_FillOrderAndUnwrap(publicClient, takerClient, takerAccount, order, signature, seriesId);
    
    // Step 12: Oracle Price Validation
    currentStep = 12;
    await step12_OraclePriceValidation(publicClient, ORACLE_ABI, strike);
    
    // Step 13: Exercise Options (if profitable)
    currentStep = 13;
    await step13_ExerciseOptions(publicClient, takerClient, takerAccount, VAULT_ABI, seriesId, strike, ORACLE_ABI);
    
    // Step 14: Final State Verification
    currentStep = 14;
    await step14_FinalStateVerification(publicClient, makerAccount, takerAccount, VAULT_ABI, seriesId);
    
    // Step 8: Taker Setup
    currentStep = 8;
    const { takerClient, takerAccount } = await step8_TakerSetup();
    sharedData.takerAccount = takerAccount;
    
    // Step 9: Taker Balance Validation
    currentStep = 9;
    await step9_TakerBalanceValidation(publicClient, takerAccount);
    
    // Step 10: Prepare for Order Fill
    currentStep = 10;
    await step10_PrepareForOrderFill(publicClient, takerClient, takerAccount, order);
    
    // Step 11: Fill 1inch Order
    currentStep = 11;
    await step11_Fill1inchOrder(publicClient, takerClient, takerAccount, order, signature, seriesId);
    
    // Step 12: Oracle Price Validation
    currentStep = 12;
    await step12_OraclePriceValidation(publicClient, ORACLE_ABI, strike);
    
    // Step 13: Exercise Options (if profitable)
    currentStep = 13;
    await step13_ExerciseOptions(publicClient, takerClient, takerAccount, VAULT_ABI, seriesId, strike, ORACLE_ABI);
    
    // Step 14: Final State Verification
    currentStep = 14;
    await step14_FinalStateVerification(publicClient, makerAccount, takerAccount, VAULT_ABI, seriesId);
    
    // ═══════════════════════════════════════════════════════════════════════════
    //                              SUCCESS SUMMARY
    // ═══════════════════════════════════════════════════════════════════════════
    
    console.log("\n" + "🎉".repeat(20));
    console.log("🎉          COMPLETE OPTIONS TRADING FLOW SUCCESS!          🎉");
    console.log("🎉".repeat(20));
    
    console.log("\n📊 EXECUTION SUMMARY:");
    console.log(`✅ Options Series Created: ${seriesId.toString()}`);
    console.log(`✅ Maker Deposited: ${formatUnits(TEST_CONFIG.DEPOSIT_AMOUNT, 18)} GNO`);
    console.log(`✅ Options Minted: ${TEST_CONFIG.OPTIONS_TO_MINT}`);
    console.log(`✅ Options Sold on 1inch: ${TEST_CONFIG.OPTIONS_TO_SELL}`);
    console.log(`✅ Premium Earned: ${formatUnits(TEST_CONFIG.OPTIONS_TO_SELL * TEST_CONFIG.OPTION_PREMIUM, 18)} WXDAI`);
    console.log(`✅ Taker Bought and Exercised Options`);
    
    console.log("\n🏁 All steps completed successfully!");
    
  } catch (error: any) {
    logError(currentStep, getStepTitle(currentStep), error);
    
    console.log("\n" + "❌".repeat(20));
    console.log("❌          SCRIPT EXECUTION FAILED                    ❌");
    console.log("❌".repeat(20));
    
    console.log(`\n🛑 FAILED AT STEP ${currentStep}: ${getStepTitle(currentStep)}`);
    console.log(`📝 Error Details: ${error.message || error}`);
    
    console.log("\n📋 STEPS COMPLETED BEFORE FAILURE:");
    for (let i = 1; i < currentStep; i++) {
      console.log(`✅ Step ${i}: ${getStepTitle(i)}`);
    }
    
    if (currentStep > 1) {
      console.log("\n💡 TIP: Fix the issue and re-run the script. Some steps may be skipped if state is valid.");
    }
    
    process.exit(1);
  }
}

function getStepTitle(step: number): string {
  const titles = {
    1: "Maker - Environment & ABI Validation",
    2: "Maker - Account & Balance Validation", 
    3: "Maker - Admin Role Verification",
    4: "Maker - Option Series Definition",
    5: "Maker - Collateral Deposit",
    6: "Maker - Option Minting",
    7: "Maker - Wrap ERC1155 & Create 1inch Order",
    8: "Taker - Environment Setup",
    9: "Taker - Balance Validation",
    10: "Taker - Prepare for Order Fill",
    11: "Taker - Fill Order & Unwrap ERC1155",
    12: "Oracle Price Validation",
    13: "Taker - Exercise Options",
    14: "Final State Verification"
  };
  return titles[step as keyof typeof titles] || "Unknown Step";
}

// Export for potential module usage
export { 
  main, 
  CONTRACTS, 
  TEST_CONFIG, 
  loadABI, 
  buildSeriesId, 
  generateSalt, 
  buildOrder, 
  signOrder 
};

// Run the script if called directly
if (require.main === module) {
  main().catch((error) => {
    console.error("\n💥 UNEXPECTED ERROR DURING SCRIPT EXECUTION:");
    console.error(error);
    process.exit(1);
  });
}
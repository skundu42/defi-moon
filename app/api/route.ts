// app/api/route.ts
import { NextRequest, NextResponse } from "next/server";

// API metadata and health check endpoint
export async function GET(request: NextRequest) {
  try {
    // Get basic system info
    const timestamp = new Date().toISOString();
    const uptime = process.uptime();
    
    // Check if orders storage is initialized
    const ordersStorageStatus = global.ordersStorage ? 
      `Initialized with ${global.ordersStorage.size} orders` : 
      "Not initialized";

    const apiInfo = {
      name: "DeFi Moon Options API",
      version: "1.0.0",
      description: "Decentralized covered call options trading API",
      timestamp,
      uptime: `${Math.floor(uptime)} seconds`,
      status: "healthy",
      endpoints: {
        orders: {
          base: "/api/orders",
          methods: ["GET", "POST"],
          description: "Manage limit orders for ERC-1155 options"
        },
        "orders/fill": {
          base: "/api/orders/fill",
          methods: ["POST"],
          description: "Mark orders as filled"
        },
        "orders/cancel": {
          base: "/api/orders/cancel",
          methods: ["POST"],
          description: "Cancel active orders"
        },
        "orders/cleanup": {
          base: "/api/orders/cleanup",
          methods: ["POST"],
          description: "Clean up expired orders"
        }
      },
      storage: {
        orders: ordersStorageStatus
      },
      network: {
        chainId: process.env.NEXT_PUBLIC_CHAIN_ID || "100",
        name: "Gnosis Chain"
      },
      contracts: {
        vault: process.env.NEXT_PUBLIC_VAULT_ADDRESS || "0xB4048ce69523CF463bC37b648279e6EF66CaEBAf",
        callToken: process.env.NEXT_PUBLIC_CALLTOKEN_ADDRESS || "0x7b964e3dC49DAcB3971CA49f53629e2e11885016",
        oneInchLOP: "0x111111125421ca6dc452d289314280a0f8842a65"
      }
    };

    return NextResponse.json(apiInfo, {
      status: 200,
      headers: {
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0'
      }
    });

  } catch (error: any) {
    console.error("API health check failed:", error);
    
    return NextResponse.json({
      name: "DeFi Moon Options API",
      status: "error",
      timestamp: new Date().toISOString(),
      error: error.message || "Internal server error"
    }, { 
      status: 500 
    });
  }
}

// Handle unsupported methods
export async function POST(request: NextRequest) {
  return NextResponse.json({
    error: "Method not allowed",
    message: "This endpoint only supports GET requests",
    availableEndpoints: ["/api/orders", "/api/orders/fill", "/api/orders/cancel", "/api/orders/cleanup"]
  }, { 
    status: 405,
    headers: {
      'Allow': 'GET'
    }
  });
}

export async function PUT(request: NextRequest) {
  return NextResponse.json({
    error: "Method not allowed",
    message: "This endpoint only supports GET requests"
  }, { 
    status: 405,
    headers: {
      'Allow': 'GET'
    }
  });
}

export async function DELETE(request: NextRequest) {
  return NextResponse.json({
    error: "Method not allowed", 
    message: "This endpoint only supports GET requests"
  }, { 
    status: 405,
    headers: {
      'Allow': 'GET'
    }
  });
}
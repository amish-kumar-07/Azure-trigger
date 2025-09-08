"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
Object.defineProperty(exports, "__esModule", { value: true });
// HttpStart/index.ts
const service_bus_1 = require("@azure/service-bus");
const functions_1 = require("@azure/functions");
const dotenv = __importStar(require("dotenv"));
dotenv.config();
// Create ServiceBus client once and reuse it
let sbClient;
function getServiceBusClient() {
    if (!sbClient) {
        const connectionString = process.env.SERVICE_BUS_CONNECTION_STRING;
        if (!connectionString) {
            throw new Error("SERVICEBUS_CONNECTION_STRING environment variable is not set");
        }
        sbClient = new service_bus_1.ServiceBusClient(connectionString);
    }
    return sbClient;
}
// Azure Functions v4 HTTP trigger function
const httpTrigger = (request, context) => __awaiter(void 0, void 0, void 0, function* () {
    context.log("HTTP trigger function processed a request.");
    context.log(`Http function processed request for url "${request.url}"`);
    context.log("Environment check:", {
        hasConnectionString: !!process.env.SERVICEBUS_CONNECTION_STRING,
        queueName: process.env.QUEUE,
    });
    // Extract route parameters from URL
    const url = new URL(request.url);
    const pathSegments = url.pathname.split('/').filter(segment => segment);
    const lastSegment = pathSegments[pathSegments.length - 1] || "";
    const method = request.method.toLowerCase();
    // Only handle process route
    if (lastSegment !== "process") {
        return {
            status: 404,
            headers: { "Content-Type": "application/json" },
            jsonBody: {
                error: "Not found",
                available_endpoints: [
                    "POST /process"
                ],
            },
        };
    }
    // Only allow POST method
    if (method !== "post") {
        return {
            status: 405,
            headers: { "Content-Type": "application/json" },
            jsonBody: {
                error: "Method not allowed. Only POST is supported.",
            },
        };
    }
    const queueName = process.env.QUEUE;
    if (!queueName) {
        context.log("QUEUE environment variable is not set");
        return {
            status: 500,
            headers: { "Content-Type": "application/json" },
            jsonBody: { error: "Server configuration error" },
        };
    }
    let sender;
    try {
        context.log("Attempting to create ServiceBus client...");
        const client = getServiceBusClient();
        context.log("ServiceBus client created successfully");
        // Parse request body
        const body = yield request.json();
        const { url: crawlUrl, callbackUrl, projectId, target } = body;
        if (!crawlUrl || !projectId || !callbackUrl || !target) {
            return {
                status: 400,
                headers: { "Content-Type": "application/json" },
                jsonBody: {
                    success: false,
                    error: "Missing required fields: url, projectId, callbackUrl, and target are required",
                },
            };
        }
        // Validate URLs
        try {
            new URL(crawlUrl);
            new URL(callbackUrl);
        }
        catch (_a) {
            return {
                status: 400,
                headers: { "Content-Type": "application/json" },
                jsonBody: {
                    success: false,
                    error: "Invalid URL format. URLs must include protocol (http:// or https://)",
                },
            };
        }
        // Send message to Service Bus
        sender = client.createSender(queueName);
        context.log("ServiceBus sender created successfully");
        const messagePayload = {
            url: crawlUrl,
            projectId,
            callbackUrl: callbackUrl,
            target: target,
            timestamp: new Date().toISOString(),
        };
        context.log(`🔨 [${projectId}] Queuing crawl request:`);
        context.log(`   🎯 Target: ${target}`);
        context.log(`   🕷️ Crawler: ${crawlUrl}`);
        context.log(`   📞 Callback: ${callbackUrl}`);
        yield sender.sendMessages({
            body: messagePayload,
            messageId: `${projectId}-${Date.now()}`
        });
        context.log(`✅ [${projectId}] Request queued successfully at ${messagePayload.timestamp}`);
        return {
            status: 200,
            headers: { "Content-Type": "application/json" },
            jsonBody: {
                success: true,
                message: "Request queued successfully",
                queuedAt: messagePayload.timestamp,
                projectId: projectId,
            },
        };
    }
    catch (error) {
        context.error("Error processing request:", error);
        return {
            status: 500,
            headers: { "Content-Type": "application/json" },
            jsonBody: {
                success: false,
                error: "Internal server error",
                details: error instanceof Error ? error.message : String(error),
            },
        };
    }
    finally {
        // Clean up resources
        if (sender) {
            try {
                yield sender.close();
                context.log("ServiceBus sender closed successfully");
            }
            catch (closeError) {
                context.error("Error closing ServiceBus sender:", closeError);
            }
        }
    }
});
// Register the HTTP trigger with Azure Functions v4
functions_1.app.http('httpTrigger', {
    methods: ['POST'],
    route: 'process', // This makes the function available at /api/process
    authLevel: 'anonymous',
    handler: httpTrigger,
});
exports.default = httpTrigger;
//# sourceMappingURL=index.js.map
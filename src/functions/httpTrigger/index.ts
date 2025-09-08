// HttpStart/index.ts
import { ServiceBusClient, ServiceBusSender } from "@azure/service-bus";
import { app, HttpRequest, HttpResponseInit, InvocationContext } from "@azure/functions";
import * as dotenv from "dotenv";

dotenv.config();

// Create ServiceBus client once and reuse it
let sbClient: ServiceBusClient;

function getServiceBusClient(): ServiceBusClient {
  if (!sbClient) {
    const connectionString = process.env.SERVICE_BUS_CONNECTION_STRING;
    if (!connectionString) {
      throw new Error(
        "SERVICEBUS_CONNECTION_STRING environment variable is not set"
      );
    }
    sbClient = new ServiceBusClient(connectionString);
  }
  return sbClient;
}

// Azure Functions v4 HTTP trigger function
const httpTrigger = async (request: HttpRequest, context: InvocationContext): Promise<HttpResponseInit> => {
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

  let sender: ServiceBusSender | undefined;

  try {
    context.log("Attempting to create ServiceBus client...");
    const client = getServiceBusClient();
    context.log("ServiceBus client created successfully");

    // Parse request body
    const body = await request.json() as any;
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
    } catch {
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

    await sender.sendMessages({
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

  } catch (error) {
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
  } finally {
    // Clean up resources
    if (sender) {
      try {
        await sender.close();
        context.log("ServiceBus sender closed successfully");
      } catch (closeError) {
        context.error("Error closing ServiceBus sender:", closeError);
      }
    }
  }
};

// Register the HTTP trigger with Azure Functions v4
app.http('httpTrigger', {
  methods: ['POST'],
  route: 'process', // This makes the function available at /api/process
  authLevel: 'anonymous',
  handler: httpTrigger,
});

export default httpTrigger;
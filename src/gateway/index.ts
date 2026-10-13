import { createGatewayConnector } from "./client";
import { loadConfig } from "./config";
import { GatewayService } from "./service";

/**
 * The one Gateway connection shared by every action. Built from the config on
 * disk at plugin start; the Setup action swaps the transport after the user
 * saves new settings.
 */
export const gatewayService = new GatewayService(createGatewayConnector(loadConfig().config));

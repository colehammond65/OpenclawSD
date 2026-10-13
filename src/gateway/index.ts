import streamDeck from "@elgato/streamdeck";

import { createGatewayConnector, type ConnectorLogger } from "./client";
import { loadConfig, type AppConfig } from "./config";
import { GatewayService, type GatewayConnector } from "./service";

/**
 * Streams the connector's progress into the plugin log, so "why is the key red"
 * is answerable from `com.encrypt.openclaw.sdPlugin/logs/`.
 */
const logger: ConnectorLogger = {
	debug: (message) => streamDeck.logger.debug(`[gateway] ${message}`),
	info: (message) => streamDeck.logger.info(`[gateway] ${message}`),
	error: (message) => streamDeck.logger.error(`[gateway] ${message}`),
};

export function createLoggedConnector(config: AppConfig): GatewayConnector {
	return createGatewayConnector(config, logger);
}

/**
 * The one Gateway connection shared by every action. Built from the config on
 * disk at plugin start; the Setup action swaps the transport after the user
 * saves new settings.
 */
export const gatewayService = new GatewayService(createLoggedConnector(loadConfig().config));

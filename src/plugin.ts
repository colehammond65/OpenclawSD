import streamDeck from "@elgato/streamdeck";

import { RunAutomation } from "./actions/run-automation";
import { Setup } from "./actions/setup";
import { Status } from "./actions/status";
import { gatewayService } from "./gateway";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new Setup());
streamDeck.actions.registerAction(new Status());
streamDeck.actions.registerAction(new RunAutomation());

// Start talking to the Gateway before the Stream Deck handshake, so the first
// key faces already have state to render.
gatewayService.start();

// Must be last: opens the connection to the Stream Deck software.
streamDeck.connect();

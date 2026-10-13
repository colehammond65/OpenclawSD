import streamDeck from "@elgato/streamdeck";

import { Approvals } from "./actions/approvals";
import { RunAutomation } from "./actions/run-automation";
import { SendPrompt } from "./actions/send-prompt";
import { Setup } from "./actions/setup";
import { Status } from "./actions/status";
import { Usage } from "./actions/usage";
import { gatewayService } from "./gateway";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new Setup());
streamDeck.actions.registerAction(new Status());
streamDeck.actions.registerAction(new RunAutomation());
streamDeck.actions.registerAction(new Usage());
streamDeck.actions.registerAction(new SendPrompt());
streamDeck.actions.registerAction(new Approvals());

// Start talking to the Gateway before the Stream Deck handshake, so the first
// key faces already have state to render.
gatewayService.start();

// Must be last: opens the connection to the Stream Deck software.
streamDeck.connect();

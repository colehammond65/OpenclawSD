import streamDeck from "@elgato/streamdeck";

import { Approvals } from "./actions/approvals";
import { RunAutomation } from "./actions/run-automation";
import { SendPrompt } from "./actions/send-prompt";
import { Status } from "./actions/status";
import { Stop } from "./actions/stop";
import { Usage } from "./actions/usage";
import { gatewayService } from "./gateway";
import { registerConnectionHandlers } from "./setup/handler";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new Status());
streamDeck.actions.registerAction(new RunAutomation());
streamDeck.actions.registerAction(new Usage());
streamDeck.actions.registerAction(new SendPrompt());
streamDeck.actions.registerAction(new Approvals());
streamDeck.actions.registerAction(new Stop());

// Serves the connection panel and the setup window, whichever action owns the
// visible property inspector.
registerConnectionHandlers();

// Start talking to the Gateway before the Stream Deck handshake, so the first
// key faces already have state to render.
gatewayService.start();

// Must be last: opens the connection to the Stream Deck software.
streamDeck.connect();

import streamDeck from "@elgato/streamdeck";

import { Status } from "./actions/status";

streamDeck.logger.setLevel("trace");

streamDeck.actions.registerAction(new Status());

// Must be last: opens the connection to the Stream Deck software.
streamDeck.connect();

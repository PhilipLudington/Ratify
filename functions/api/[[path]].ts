// Pages Function entry point for the whole API surface.
//
// This file is a doorway, not a door: Pages requires the handler to live under
// functions/, but the logic lives in src/worker/doorman.ts so it can be tested
// and read without Pages' file-routing conventions in the way.

import { handleRequest, type DoormanEnv } from '../../src/worker/doorman';

export const onRequest: PagesFunction<DoormanEnv> = (context) =>
  handleRequest(context.request, context.env);

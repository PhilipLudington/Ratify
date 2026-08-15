// Entry point for the ratify-log Worker.
//
// This Worker exists solely to host the LogDO class, because Pages Functions
// can bind to a Durable Object but cannot define one. Its only real export is
// the class; the fetch handler is here because a Worker must have one.
//
// It is deployed with `workers_dev = false` and no routes, so the fetch
// handler below should never be reached in production. If it is, something is
// addressing this Worker directly instead of going through the Pages doorman.

export { LogDO } from './LogDO';

export default {
  fetch(): Response {
    return new Response(
      'ratify-log hosts the LogDO Durable Object class and serves no traffic of its own.\n',
      { status: 404, headers: { 'Content-Type': 'text/plain; charset=utf-8' } },
    );
  },
};

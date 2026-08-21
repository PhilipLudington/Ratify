// The sandbox starter log — PLAN.md Phase 1 "Seed the sandbox".
//
// Six ADRs for Latchkey, a fictional four-person team building appointment
// scheduling for independent repair shops. The history is authored so the
// decisions a reviewer is most likely to bring to the demo trip a *natural*
// precedent conflict with a quotable line, not a contrived one:
//
// - "let's use Kafka / SQS / Redis for jobs"  → ADR-4 (no dedicated broker)
// - "let's add MongoDB / DynamoDB / a cache as truth" → ADR-3 (one datastore)
// - "let's move to Kubernetes"                → ADR-5 (no Kubernetes)
// - "let's self-host X"                       → ADR-2 (managed-first rule)
//
// ADR-1 → ADR-3 is the seeded supersession chain (the early datastore call,
// overturned), and ADR-6 carries the log's one open objection — so a fresh
// sandbox demonstrates every record state the log view can render.
//
// Records are authored as `AdrRecord` values, not as Markdown text, so the
// serializer validates every seed on its way to disk; the wiring (next task)
// stores `serializeRecord(seed.record)` and gets canonical bytes by
// construction. Scrutiny stamps are kept mechanically consistent with the
// authored sections — coverage `none` iff the section is empty, the
// alternatives count matches the bullets — because the gauge never lies, not
// even in fiction. `tests/seeds.test.ts` pins all of this.

import type { AdrRecord, Index } from '../shared/record';

/** A starter record plus the one-sentence decision its index line carries. */
export interface Seed {
  record: AdrRecord;
  /** Denormalized for the index — the tier-1 line the precedent check scans. */
  decision: string;
}

export const SEEDS: readonly Seed[] = [
  {
    decision: 'Use DynamoDB for all persistent data.',
    record: {
      number: 1,
      status: 'superseded',
      date: '2026-06-02',
      supersedes: [],
      supersededBy: 3,
      scrutiny: {
        context: 'partial',
        alternatives: 1,
        precedent: 'checked',
        consequences: 'none',
        objections: { open: 0, addressed: 0 },
      },
      title: 'Store everything in DynamoDB',
      sections: {
        context:
          'Week one of Latchkey. We need somewhere to put users, shops, and ' +
          'appointments before the first demo, and nobody has time to argue ' +
          'about schemas.',
        decision:
          'Use DynamoDB for all persistent data. Single-table design, one ' +
          'key schema for everything.',
        alternativesConsidered:
          '- Postgres on RDS — deferred; nobody wanted to own migrations in ' +
          'week one.',
        consequences: '',
        objections: '',
      },
      history: [
        { date: '2026-06-02', note: 'ratified (v1)' },
        { date: '2026-07-14', note: 'superseded by ADR-3' },
      ],
    },
  },
  {
    decision:
      'Buy managed services by default; self-hosting requires a ratified ' +
      'exception.',
    record: {
      number: 2,
      status: 'ratified',
      date: '2026-06-09',
      supersedes: [],
      supersededBy: null,
      scrutiny: {
        context: 'full',
        alternatives: 2,
        precedent: 'checked',
        consequences: 'full',
        objections: { open: 0, addressed: 1 },
      },
      title: 'Prefer managed services over self-hosting',
      sections: {
        context:
          'Four engineers, no ops hire planned for at least a year. Every ' +
          'hour spent patching a VM is an hour not spent on the product. The ' +
          'DynamoDB call in ADR-1 was made partly on these grounds, but the ' +
          'reasoning was never written down as a rule, so it gets ' +
          're-litigated on every infrastructure choice.',
        decision:
          'Buy managed services by default. Self-hosting anything — ' +
          'databases, queues, search, CI runners — requires a ratified ' +
          'exception that names the person who operates it and the pager ' +
          'they answer.',
        alternativesConsidered:
          '- Self-host on VMs for cost control — rejected; the savings are ' +
          'smaller than one engineer-day a month, and maintenance costs ' +
          'more than that.\n' +
          '- Decide case by case with no standing rule — rejected; that is ' +
          'what we were already doing, and it produced the same debate four ' +
          'times in five weeks.',
        consequences:
          'Higher unit costs at scale, accepted while scale is ' +
          'hypothetical. Some lock-in per provider, mitigated by preferring ' +
          'services with open protocols. Exceptions are visible in this log ' +
          'as records, so drift from the rule is auditable.',
        objections: '',
      },
      history: [{ date: '2026-06-09', note: 'ratified (v1)' }],
    },
  },
  {
    decision:
      'PostgreSQL is the system of record; no second primary datastore.',
    record: {
      number: 3,
      status: 'ratified',
      date: '2026-07-14',
      supersedes: [1],
      supersededBy: null,
      scrutiny: {
        context: 'full',
        alternatives: 3,
        precedent: 'conflict-resolved',
        consequences: 'full',
        objections: { open: 0, addressed: 1 },
      },
      title: 'PostgreSQL is the system of record',
      sections: {
        context:
          'Six weeks into DynamoDB (ADR-1), the single-table design has ' +
          'been remodeled three times as access patterns shifted, and the ' +
          'shop-billing report needs a join DynamoDB cannot express — today ' +
          'we export to CSV and join in a spreadsheet. Access patterns are ' +
          'still changing weekly; we picked a datastore that punishes ' +
          'exactly that.',
        decision:
          'PostgreSQL, managed, is the system of record for all Latchkey ' +
          'data. A new service must not introduce a second primary ' +
          'datastore; caches and search indexes are fine, but they are ' +
          'projections, never the truth.',
        alternativesConsidered:
          '- Stay on DynamoDB and model harder — rejected; the remodeling ' +
          'cost is recurring, not a one-time learning fee.\n' +
          '- MongoDB Atlas — rejected; flexible documents solve the wrong ' +
          'problem. The pain is relational queries, not schema rigidity.\n' +
          '- Split: appointments stay in DynamoDB, billing goes to ' +
          'Postgres — rejected; two sources of truth for one appointment is ' +
          'how the books stop balancing.',
        consequences:
          'A real migration with a two-week dual-write window. Schema ' +
          'migrations become a skill we maintain instead of avoid. Conforms ' +
          'to ADR-2: managed Postgres, nobody carries a database pager.',
        objections: '',
      },
      history: [{ date: '2026-07-14', note: 'ratified (v1)' }],
    },
  },
  {
    decision:
      'Background jobs run on a Postgres jobs table; no dedicated message ' +
      'broker.',
    record: {
      number: 4,
      status: 'ratified',
      date: '2026-07-21',
      supersedes: [],
      supersededBy: null,
      scrutiny: {
        context: 'full',
        alternatives: 3,
        precedent: 'checked',
        consequences: 'partial',
        objections: { open: 0, addressed: 2 },
      },
      title: 'Run background jobs on Postgres, not a broker',
      sections: {
        context:
          'Appointment reminders and shop-owner digest emails send inline ' +
          'in request handlers today; a slow SMTP round-trip can time out a ' +
          'booking. We need background jobs. Volume is well under one job ' +
          'per second, projected peak under ten.',
        decision:
          'Background jobs run on a jobs table in Postgres, claimed with ' +
          'SELECT ... FOR UPDATE SKIP LOCKED. We will not add a dedicated ' +
          'message broker until job volume demonstrably exceeds what ' +
          'Postgres serves.',
        alternativesConsidered:
          '- SQS — rejected for now; a second system to configure, monitor, ' +
          'and mock in tests, bought to solve a scale we do not have.\n' +
          '- Redis with BullMQ — rejected; jobs are truth, and ADR-3 ' +
          'forbids a second datastore holding truth.\n' +
          '- RabbitMQ, self-hosted — rejected outright under ADR-2.',
        consequences:
          'The jobs table shares the database\'s fate: a Postgres outage ' +
          'stops jobs too. Queue depth is a SQL query away. The revisit ' +
          'trigger is written into the decision.',
        objections: '',
      },
      history: [{ date: '2026-07-21', note: 'ratified (v1)' }],
    },
  },
  {
    decision: 'Services deploy as containers to Cloud Run; no Kubernetes.',
    record: {
      number: 5,
      status: 'ratified',
      date: '2026-07-28',
      supersedes: [],
      supersededBy: null,
      scrutiny: {
        context: 'full',
        alternatives: 3,
        precedent: 'checked',
        consequences: 'full',
        objections: { open: 0, addressed: 1 },
      },
      title: 'Deploy to Cloud Run; no Kubernetes',
      sections: {
        context:
          'The first paying shop wants uptime we cannot promise off a ' +
          'free-tier VM. We need a deploy target for three containerized ' +
          'services. Under ADR-2 the shortlist is managed platforms only.',
        decision:
          'All services deploy as containers to Google Cloud Run. We will ' +
          'not run Kubernetes, managed or otherwise, at our current team ' +
          'size.',
        alternativesConsidered:
          '- GKE Autopilot — rejected; even managed Kubernetes prices in a ' +
          'platform team we do not have.\n' +
          '- Fly.io — close second; rejected on managed-Postgres network ' +
          'peering maturity and existing team familiarity with GCP.\n' +
          '- Plain VMs behind a load balancer — rejected under ADR-2.',
        consequences:
          'Deploys are a container push; rollback is a revision pin. Cold ' +
          'starts are acceptable at our traffic. GCP lock-in accepted — ' +
          'containers keep the exit cost bounded. Scale-to-zero keeps the ' +
          'staging bill near zero.',
        objections: '',
      },
      history: [{ date: '2026-07-28', note: 'ratified (v1)' }],
    },
  },
  {
    decision: 'All code moves into a single monorepo.',
    record: {
      number: 6,
      status: 'ratified',
      date: '2026-08-04',
      supersedes: [],
      supersededBy: null,
      scrutiny: {
        context: 'full',
        alternatives: 2,
        precedent: 'checked',
        consequences: 'partial',
        objections: { open: 1, addressed: 0 },
      },
      title: 'Adopt a single monorepo',
      sections: {
        context:
          'Four repos (api, web, worker, shared-types) mean every ' +
          'cross-cutting change is four pull requests and a version dance ' +
          'in shared-types. Last week a reminder-email fix waited two days ' +
          'on a types release.',
        decision:
          'All Latchkey code moves into a single monorepo with one ' +
          'lockfile and one CI pipeline. Shared types are imported ' +
          'directly; the shared-types package is retired.',
        alternativesConsidered:
          '- Keep four repos and automate the version dance — rejected; ' +
          'the automation is a second job, and the dance remains.\n' +
          '- Two repos, product and infra — rejected; the painful boundary ' +
          'is api/web/worker, which that split keeps.',
        consequences:
          'One PR per change, including cross-cutting ones. CI must learn ' +
          'path filtering or run everything on every push; we start with ' +
          'run-everything and accept the minutes.',
        objections:
          '> CI time grows with the repo, and per-package caching on our ' +
          'CI provider is unproven at our scale. We are trading a four-repo ' +
          'setup that works today for tooling promises. If CI crosses ten ' +
          'minutes, this decision should be reopened.\n\n' +
          'Raised at ratification; unresolved.',
      },
      history: [{ date: '2026-08-04', note: 'ratified (v1)' }],
    },
  },
];

/** The number the counter starts at after seeding: one past the last seed. */
export const SEED_NEXT_NUMBER =
  SEEDS[SEEDS.length - 1]!.record.number + 1;

/**
 * The index a freshly seeded sandbox carries — one line per seed, in record
 * order, denormalized from the records above.
 */
export function seedIndex(): Index {
  return SEEDS.map(({ record, decision }) => ({
    number: record.number,
    title: record.title,
    status: record.status,
    decision,
  }));
}

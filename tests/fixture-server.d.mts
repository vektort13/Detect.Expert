// Type surface of tests/fixture-server.mjs for the TypeScript harness and specs.
import type { IncomingMessage, ServerResponse } from 'node:http';

export interface FixtureServerStats {
  requests: number;
  slowRequests: number;
  slowAborted: number;
  rejected: number;
}

export interface FixtureServerOptions {
  slowDelayMs?: number;
}

export interface FixtureServer {
  origins: string[];
  ports: number[];
  stats: FixtureServerStats;
  close(): Promise<void>;
}

export const repoRoot: string;
export const fixturesDir: string;
export const FIXTURE_PORTS: readonly number[];
export const SLOW_DELAY_MS: number;

export function createFixtureHandler(
  stats: FixtureServerStats,
  options?: FixtureServerOptions & { timers?: Set<NodeJS.Timeout> },
): (req: IncomingMessage, res: ServerResponse) => void;

export function startFixtureServer(ports?: readonly number[], options?: FixtureServerOptions): Promise<FixtureServer>;

import { readFileSync } from 'node:fs';
import { parse as parseYaml } from 'yaml';
import { z } from 'zod';

export class ScenarioError extends Error {
  constructor(message: string, readonly details?: unknown) {
    super(message);
    this.name = 'ScenarioError';
  }
}

const duration = z.string().transform((value, ctx) => {
  const match = value.trim().match(/^(\d+)(ms|s|m|h)?$/);
  if (!match) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, message: `Invalid duration "${value}"` });
    return z.NEVER;
  }
  const amount = Number(match[1]);
  const unit = match[2] ?? 's';
  const multiplier = unit === 'ms' ? 1 : unit === 's' ? 1000 : unit === 'm' ? 60_000 : 3_600_000;
  return amount * multiplier;
});

const rampStep = z.union([
  z
    .object({ at: duration, users: z.number().int().nonnegative() })
    .transform((step) => ({ kind: 'target' as const, atMs: step.at, users: step.users })),
  z.object({ hold: duration }).transform((step) => ({ kind: 'hold' as const, holdMs: step.hold })),
]);

const mix = z
  .object({
    signaling: z.object({ weight: z.number().nonnegative() }).default({ weight: 100 }),
    media: z
      .object({
        weight: z.number().nonnegative(),
        audio: z.boolean().optional(),
        video: z.boolean().optional(),
        videoProfile: z.string().optional(),
      })
      .optional(),
    browser: z
      .object({
        weight: z.number().nonnegative(),
        browsers: z.array(z.enum(['chromium', 'firefox'])).optional(),
      })
      .optional(),
  })
  .default({ signaling: { weight: 100 } });

export const scenarioSchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  target: z.object({
    url: z.string().min(1),
    secret: z.string().min(1),
    version: z.string().default('auto'),
  }),
  meeting: z
    .object({
      count: z.number().int().positive().default(1),
      usersPerMeeting: z.number().int().positive().optional(),
    })
    .default({ count: 1 }),
  ramp: z.array(rampStep).min(1),
  mix,
  behaviour: z
    .object({
      chatMessagesPerMinute: z.number().nonnegative().optional(),
      raiseHandProbability: z.number().min(0).max(1).optional(),
    })
    .optional(),
  slo: z
    .object({
      joinLatencyP95: duration.optional(),
      audioFailureRate: z.number().min(0).max(1).optional(),
    })
    .optional(),
});

export type Scenario = z.infer<typeof scenarioSchema>;
export type RampStep = Scenario['ramp'][number];

const ENV_PATTERN = /\$\{([A-Za-z_][A-Za-z0-9_]*)(?::-([^}]*))?\}/g;

export function interpolateEnv(raw: string, env: NodeJS.ProcessEnv = process.env): string {
  const missing: string[] = [];
  const result = raw.replace(ENV_PATTERN, (_match, name: string, fallback?: string) => {
    const value = env[name];
    if (value !== undefined) return value;
    if (fallback !== undefined) return fallback;
    missing.push(name);
    return '';
  });
  if (missing.length > 0) {
    throw new ScenarioError(`Missing environment variable(s) referenced in scenario: ${[...new Set(missing)].join(', ')}`);
  }
  return result;
}

export function parseScenario(text: string, env?: NodeJS.ProcessEnv): Scenario {
  const interpolated = interpolateEnv(text, env);
  let doc: unknown;
  try {
    doc = parseYaml(interpolated);
  } catch (error) {
    throw new ScenarioError('Failed to parse scenario YAML', error);
  }
  const result = scenarioSchema.safeParse(doc);
  if (!result.success) {
    const summary = result.error.issues
      .map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('; ');
    throw new ScenarioError(`Invalid scenario: ${summary}`, result.error.issues);
  }
  return result.data;
}

export function loadScenario(filePath: string, env?: NodeJS.ProcessEnv): Scenario {
  let raw: string;
  try {
    raw = readFileSync(filePath, 'utf8');
  } catch (error) {
    throw new ScenarioError(`Cannot read scenario file "${filePath}"`, error);
  }
  return parseScenario(raw, env);
}

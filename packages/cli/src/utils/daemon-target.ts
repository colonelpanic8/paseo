import { resolvePaseoPaths, type PaseoPaths } from "@getpaseo/server";

export type DaemonTarget =
  | { kind: "instance"; home: string; paths?: PaseoPaths }
  | { kind: "endpoint"; host: string };

function selectInstanceTarget(home: string | undefined, env: NodeJS.ProcessEnv): DaemonTarget {
  const paths = resolvePaseoPaths(home === undefined ? env : { ...env, PASEO_HOME: home });
  return { kind: "instance", home: paths.home, paths };
}

export function selectDaemonTarget(
  options: { home?: string; host?: string },
  env: NodeJS.ProcessEnv = process.env,
  localOnly = false,
): DaemonTarget {
  for (const key of ["home", "host"] as const) {
    if (options[key] !== undefined && !options[key]!.trim())
      throw { code: "TARGET_INVALID", message: `--${key} requires a non-empty value.` };
  }
  if (options.home !== undefined && options.host !== undefined)
    throw { code: "TARGET_AMBIGUOUS", message: "Choose either --home or --host, not both." };
  if (localOnly) {
    if (options.host !== undefined)
      throw {
        code: "LOCAL_OPERATION",
        message: "This is a local operation; use --home. --host is not supported.",
      };
    return selectInstanceTarget(options.home, env);
  }
  if (options.home !== undefined) return selectInstanceTarget(options.home, env);
  if (options.host !== undefined) return { kind: "endpoint", host: options.host };
  if (env.PASEO_HOME && env.PASEO_HOST)
    throw {
      code: "TARGET_AMBIGUOUS",
      message: "PASEO_HOME and PASEO_HOST are both set. Choose --home or --host explicitly.",
    };
  if (env.PASEO_HOST) return { kind: "endpoint", host: env.PASEO_HOST };
  return selectInstanceTarget(undefined, env);
}

export function describeDaemonTarget(target: DaemonTarget): string {
  if (target.kind === "instance") return `home ${target.home}`;
  try {
    const url = new URL(target.host);
    if (url.password) url.password = "REDACTED";
    for (const key of url.searchParams.keys())
      if (/password|token|secret/i.test(key)) url.searchParams.set(key, "REDACTED");
    if (url.hash) url.hash = "REDACTED";
    return url.toString();
  } catch {
    return target.host.replace(/([?&](?:password|token|secret)=)[^&]*/gi, "$1REDACTED");
  }
}

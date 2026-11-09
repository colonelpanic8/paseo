import type { ProviderLaunch, ProviderSessionConfig } from "@getpaseo/plugin/server/provider";

export function withSessionEnvironment(
  launch: ProviderLaunch,
  env: ProviderSessionConfig["env"],
): ProviderLaunch {
  return {
    ...launch,
    env: Object.fromEntries(
      Object.entries({ ...launch.env, ...env }).filter(
        (entry): entry is [string, string] => typeof entry[1] === "string",
      ),
    ),
  };
}

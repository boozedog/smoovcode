export function parseCliOptions(
  args: readonly string[],
  env: { SMOOV_VERBOSE?: string | undefined } = process.env,
): { verbose: boolean } {
  const envVerbose = env.SMOOV_VERBOSE?.toLowerCase();
  return { verbose: args.includes("--verbose") || envVerbose === "true" || envVerbose === "1" };
}

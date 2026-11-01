export function readAgentModel(args: string[]) {
  let model = "";
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") break;
    if (args[i] === "--model" || args[i] === "-m") model = args[++i] ?? "";
    else if (args[i].startsWith("--model=")) model = args[i].slice("--model=".length);
  }
  return model;
}

export function withoutAgentModel(args: string[]) {
  const result: string[] = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--") { result.push(...args.slice(i)); break; }
    if (args[i] === "--model" || args[i] === "-m") { i++; continue; }
    if (args[i].startsWith("--model=")) continue;
    result.push(args[i]);
  }
  return result;
}

export function withAgentModel(args: string[], model: string) {
  if (!model.trim()) return args;
  const result = withoutAgentModel(args);
  const index = result.findIndex((arg) => arg === "--" || arg.includes("{prompt}"));
  result.splice(index < 0 ? result.length : index, 0, "--model", model.trim());
  return result;
}

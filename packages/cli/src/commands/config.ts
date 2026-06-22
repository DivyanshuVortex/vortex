import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import * as dotenv from "dotenv";

const envPath = path.resolve(os.homedir(), ".vortexenv");

function readEnv(): Record<string, string> {
  if (!fs.existsSync(envPath)) return {};
  const content = fs.readFileSync(envPath, "utf-8");
  return dotenv.parse(content);
}

function writeEnv(env: Record<string, string>) {
  const content = Object.entries(env)
    .map(([k, v]) => `${k}="${v.replace(/"/g, '\\"')}"`)
    .join("\n");
  fs.writeFileSync(envPath, content + "\n", { mode: 0o600 });
}

export async function configSet(provider: string, value: string) {
  const { default: chalk } = await import("chalk");
  
  const providerUpper = provider.toUpperCase();
  let envKey = "";
  
  if (providerUpper === "GEMINI") {
    envKey = "GEMINI_API_KEY";
  } else if (providerUpper === "GROQ") {
    envKey = "GROQ_API_KEY";
  } else if (providerUpper === "OPENROUTER") {
    envKey = "OPENROUTER_API_KEY";
  } else {
    console.log(chalk.red(`Invalid option: ${chalk.bold(provider)}. Supported options are 'gemini', 'groq', and 'openrouter'.`));
    console.log(chalk.gray(`Usage: vortex config set openrouter <your-key>`));
    process.exit(1);
  }

  const env = readEnv();
  env[envKey] = value;
  writeEnv(env);
  console.log(chalk.green(`✓ Successfully set ${chalk.bold(envKey)}`));
}

export async function configGet(key: string) {
  const { default: chalk } = await import("chalk");
  const env = readEnv();
  if (env[key]) {
    console.log(env[key]);
  } else {
    console.log(chalk.gray(`Key ${chalk.bold(key)} is not set.`));
  }
}

export async function configList() {
  const { default: chalk } = await import("chalk");
  const env = readEnv();
  const keys = Object.keys(env);
  if (keys.length === 0) {
    console.log(chalk.gray("No configuration values set in ~/.vortexenv"));
    return;
  }
  
  console.log(chalk.blue.bold("\nVortex Global Configuration:\n"));
  for (const [k, v] of Object.entries(env)) {
    let masked = "***";
    if (v.length > 10) {
      masked = `${v.substring(0, 4)}...${v.substring(v.length - 4)}`;
    } else if (v.length > 0) {
      masked = v;
    }
    console.log(`  ${chalk.cyan.bold(k)}: ${chalk.gray(masked)}`);
  }
  console.log(`\nLocation: ${chalk.gray(envPath)}\n`);
}

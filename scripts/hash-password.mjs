#!/usr/bin/env node
/** Generate an APP_PASSWORD_HASH value: npm run hash-password */
import { scryptSync, randomBytes } from "crypto";
import { createInterface } from "readline";

const rl = createInterface({ input: process.stdin, output: process.stdout });
rl.question("Password to hash: ", (password) => {
  rl.close();
  if (!password || password.length < 8) {
    console.error("Use at least 8 characters.");
    process.exit(1);
  }
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  console.log("\nAdd this to your environment:\n");
  console.log(`APP_PASSWORD_HASH=scrypt$${salt}$${hash}\n`);
  console.log("(and remove any plain APP_PASSWORD)");
});

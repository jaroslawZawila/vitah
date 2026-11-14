import { dropScratchDatabases } from "../src/ops/connection";
import { SCRATCH_PREFIX, SERVER_URL } from "./scratch";

// Tests drop their own scratch databases; this sweeps what a killed run of
// this checkout left behind, before and after.
const sweep = async () => {
  await dropScratchDatabases(SERVER_URL, `${SCRATCH_PREFIX}_`);
};

export default async function setup() {
  await sweep();
  return sweep;
}

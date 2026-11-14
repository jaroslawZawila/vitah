// `pnpm db:seed:volume [scale]`: fills the scratch database POSTGRES_URL names
// (never the dev one, never a remote one) with the volume dataset (./volume).

import { assertVolumeTarget, seedVolume } from "./volume";

async function run() {
  assertVolumeTarget(process.env.POSTGRES_URL);
  const scale = process.argv[2] === undefined ? 1 : Number(process.argv[2]);
  const startedAt = Date.now();
  await seedVolume({ scale, log: (line) => console.log(line) });
  console.log(`Volume dataset ready in ${Math.round((Date.now() - startedAt) / 1000)} s`);
}

run()
  .then(() => process.exit(0))
  .catch((error: unknown) => {
    console.error(error);
    process.exit(1);
  });

import { recreateTestDatabase } from "./testing";

export default () => recreateTestDatabase(process.env.POSTGRES_URL!);

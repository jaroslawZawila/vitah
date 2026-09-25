import { getClients } from "../../actions/clients";
import ClientsScreen from "./ClientsScreen";

export default async function ClientsPage() {
  const clients = await getClients();
  return <ClientsScreen clients={clients} />;
}

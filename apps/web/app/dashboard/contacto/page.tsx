import { notFound } from "next/navigation";
import { getOfficeContact } from "../../actions/contact";
import ContactoScreen from "./ContactoScreen";

/** Contacto para clientes: the office the client's app shows on Contacto (admins, from the rail's settings menu). */
export default async function OfficeContactPage() {
  const office = await getOfficeContact();
  if (!office) notFound();
  return <ContactoScreen office={office} />;
}

import { Text } from "react-native";
import { type } from "../constants/theme";
import { useI18n } from "../lib/i18n";
import { useObra } from "../lib/use-obra";
import { LoadState } from "./load-state";
import { PushedScreen } from "./pushed-screen";

/**
 * A screen pushed from the Obra tab while it has nothing to show: the obra is
 * loading, couldn't be loaded (with a retry), or doesn't have what the screen
 * is about (`missing`, e.g. "No encontramos este pago.").
 */
export function ObraPending({ back, missing }: { back: string; missing: string }) {
  const { t } = useI18n();
  const { obra, error, retry } = useObra();
  const loaded = obra !== undefined;
  return (
    <PushedScreen back={back}>
      <LoadState
        loaded={loaded}
        error={error}
        loadingLabel={t("obra.loading")}
        failedText={t("obra.loadFailed")}
        onRetry={retry}
      />
      {loaded && <Text style={type.subhead}>{missing}</Text>}
    </PushedScreen>
  );
}

import { useCallback, useState } from "react";
import { useTranslation } from "react-i18next";
import { WorkspacePruningSheet } from "@/components/workspace-pruning-sheet";
import { useHostChooser } from "@/hosts/host-chooser";

export function useWorkspacePruning() {
  const { t } = useTranslation();
  const chooseHost = useHostChooser();
  const [serverId, setServerId] = useState<string | null>(null);
  const open = useCallback(() => {
    chooseHost({ title: t("workspacePruning.title"), onChooseHost: setServerId });
  }, [chooseHost, t]);
  const close = useCallback(() => setServerId(null), []);

  return {
    open,
    sheet: serverId ? (
      <WorkspacePruningSheet key={serverId} serverId={serverId} onClose={close} />
    ) : null,
  };
}

import { useTranslation } from "react-i18next";
import { View } from "react-native";
import { StyleSheet } from "react-native-unistyles";
import {
  type HostRuntimeConnectionStatus,
  useHostRuntimeConnectionStatus,
} from "@/runtime/host-runtime";

// Shape carries the status, color only reinforces it: filled disc online, hollow ring
// connecting, flat dash offline. Most surfaces show this dot with no status text next to it,
// and green-vs-red is the one pair a large share of people cannot tell apart.
//
// Colors come from the statusDot* band, not status*: this is a few points of color on a row of
// text, which is the case that band exists for.
export function HostStatusDot({ serverId }: { serverId: string }) {
  const { t } = useTranslation();
  const status = useHostRuntimeConnectionStatus(serverId);

  return (
    <View style={styles.box} accessibilityLabel={t(`common.connectionStatus.${status}`)}>
      <View style={shapeStyle(status)} />
    </View>
  );
}

function shapeStyle(status: HostRuntimeConnectionStatus) {
  if (status === "online") return styles.online;
  if (status === "connecting") return styles.connecting;
  return styles.offline;
}

const DOT_SIZE = 8;

const styles = StyleSheet.create((theme) => ({
  box: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    alignItems: "center",
    justifyContent: "center",
  },
  online: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotSuccess,
  },
  connecting: {
    width: DOT_SIZE,
    height: DOT_SIZE,
    borderRadius: theme.borderRadius.full,
    borderWidth: theme.borderWidth[2],
    borderColor: theme.colors.statusDotWarning,
  },
  offline: {
    width: DOT_SIZE,
    height: 3,
    borderRadius: theme.borderRadius.full,
    backgroundColor: theme.colors.statusDotDanger,
  },
}));

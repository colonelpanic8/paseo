import { useMemo } from "react";
import {
  Image,
  type ImageStyle,
  type StyleProp,
  Text,
  type TextStyle,
  View,
  type ViewStyle,
} from "react-native";
import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
import { SvgXml } from "react-native-svg";
import { canRenderProjectIconImage, projectIconSvgXml } from "@/utils/project-icon-source";

const WHITE_TEXT = { color: "#ffffff" } as const;
const SVG_CONTAINER = { overflow: "hidden" } as const;

export function ProjectIconView({
  iconDataUri,
  initial,
  projectViewKey,
  imageStyle,
  fallbackStyle,
  textStyle,
}: {
  iconDataUri: string | null;
  initial: string;
  projectViewKey: string;
  imageStyle: StyleProp<ImageStyle>;
  fallbackStyle: StyleProp<ViewStyle>;
  textStyle: StyleProp<TextStyle>;
}) {
  const imageSource = useMemo(() => ({ uri: iconDataUri ?? "" }), [iconDataUri]);
  const svgXml = useMemo(
    () => (iconDataUri ? projectIconSvgXml(iconDataUri) : null),
    [iconDataUri],
  );
  const svgContainerStyles = useMemo(() => [imageStyle, SVG_CONTAINER], [imageStyle]);
  const fallbackStyles = useMemo(
    () => [
      fallbackStyle,
      { backgroundColor: identityColor(deriveIdentityColorName(projectViewKey)) },
    ],
    [fallbackStyle, projectViewKey],
  );
  const textStyles = useMemo(() => [textStyle, WHITE_TEXT], [textStyle]);

  if (svgXml) {
    return (
      <View style={svgContainerStyles}>
        <SvgXml xml={svgXml} width="100%" height="100%" />
      </View>
    );
  }
  if (iconDataUri && canRenderProjectIconImage(iconDataUri)) {
    return <Image source={imageSource} style={imageStyle} />;
  }
  return (
    <View style={fallbackStyles}>
      <Text style={textStyles}>{initial}</Text>
    </View>
  );
}

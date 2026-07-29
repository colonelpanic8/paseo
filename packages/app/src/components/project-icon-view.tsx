import { useMemo } from "react";
import { Image, type StyleProp, Text, type TextStyle, View } from "react-native";
import { deriveIdentityColorName, identityColor } from "@/styles/identity-colors";
// SvgCss, not SvgXml: favicon SVGs commonly style paths via <style> blocks,
// which SvgXml silently ignores — paths then render with default (black) fill.
import { SvgCss } from "react-native-svg/css";
import { canRenderProjectIconImage, projectIconSvgXml } from "@/utils/project-icon-source";

const WHITE_TEXT = { color: "#ffffff" } as const;
const FALLBACK_LAYOUT = { alignItems: "center", justifyContent: "center" } as const;
const SVG_CONTAINER = { overflow: "hidden" } as const;

/**
 * Corner radius of the *generated* project icon — the colored square with an initial — as a
 * fraction of the box, so it reads as the same shape at 16pt in the sidebar and 40pt in the edit
 * sheet. Fixed tokens did not give that: the radius scale is coarse at the bottom, so small icons
 * landed on 2pt and looked square while large ones were visibly rounder.
 *
 * This is ours to shape. A **user-uploaded icon is never rounded** — it is someone's mark, and
 * clipping its corners distorts branding we don't own. A square logo stays square, a round one is
 * already round.
 */
const RADIUS_RATIO = 0.25;

export function projectIconRadius(size: number): number {
  return Math.round(size * RADIUS_RATIO);
}

function ignoreSvgParseError() {
  // A repo's icon is arbitrary user data; a malformed SVG just falls back.
}

/**
 * A project's icon: its chosen image, or a colored square carrying its initial.
 *
 * Geometry lives here, not at the call site. It used to be five copies of the same
 * width/height/radius/centering block, which is how the radius drifted apart in the first
 * place — pass a `size` and the shape follows.
 */

export function ProjectIconView({
  iconDataUri,
  initial,
  projectViewKey,
  size,
  textStyle,
}: {
  iconDataUri: string | null;
  initial: string;
  projectViewKey: string;
  size: number;
  textStyle: StyleProp<TextStyle>;
}) {
  const imageSource = useMemo(() => ({ uri: iconDataUri ?? "" }), [iconDataUri]);
  // The uploaded image is sized but never clipped — see projectIconRadius.
  const box = useMemo(() => ({ width: size, height: size }), [size]);
  const svgXml = useMemo(
    () => (iconDataUri ? projectIconSvgXml(iconDataUri) : null),
    [iconDataUri],
  );
  const svgContainerStyles = useMemo(() => [box, SVG_CONTAINER], [box]);
  const fallbackStyles = useMemo(
    () => [
      box,
      { borderRadius: projectIconRadius(size) },
      FALLBACK_LAYOUT,
      { backgroundColor: identityColor(deriveIdentityColorName(projectViewKey)) },
    ],
    [box, size, projectViewKey],
  );
  const textStyles = useMemo(() => [textStyle, WHITE_TEXT], [textStyle]);

  const fallback = useMemo(
    () => (
      <View style={fallbackStyles}>
        <Text style={textStyles}>{initial}</Text>
      </View>
    ),
    [fallbackStyles, initial, textStyles],
  );

  if (svgXml) {
    return (
      <View style={svgContainerStyles}>
        <SvgCss
          xml={svgXml}
          width="100%"
          height="100%"
          fallback={fallback}
          onError={ignoreSvgParseError}
        />
      </View>
    );
  }
  if (iconDataUri && canRenderProjectIconImage(iconDataUri)) {
    return <Image source={imageSource} style={box} />;
  }
  return fallback;
}

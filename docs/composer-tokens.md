# Composer Tokens

Command and skill names typed into the web composer render as pills. This note covers
the model, the web renderer, and why native deliberately stays plain text.

## The model: tokens are a view, never state

A token is re-derived from the composer's plain text on every render. Nothing about a
token is stored anywhere.

```
"please run $release-beta"  →  collectComposerTokens()  →  [{ type: "skill", name: "release-beta", start: 11, end: 24 }]
```

`packages/app/src/composer/tokens/tokens.ts` owns this. `collectComposerTokens` finds
token-shaped text and keeps only names present in the current command/skill catalog;
`segmentComposerText` splits the draft into alternating plain/token segments covering
the whole string, each carrying its source offset.

Because text is still the only source of truth, drafts, dictation and undo need no
parallel token state. Deleting the sigil deletes the pill. Submission runs that string
through `normalizeComposerTokensForSubmission()` once so configurable UI triggers use
the canonical `/name` syntax understood by the daemon and providers. Queueing stores
the normalized string. **Do not add a parallel token array to composer state.**

Detection rules:

- The command trigger means a command only at the start of the prompt.
- Either trigger means a skill after whitespace. This preserves inline `/skill`
  completion while adding a dedicated skills trigger.
- A trigger glued to a preceding word is prose, and slash-delimited paths are not
  tokens. `40$usd` and `/tmp/project` therefore stay plain text.
- A name is `[A-Za-z][A-Za-z0-9:_-]*`. A bare sigil with no name is not a token.
- A syntactically valid name that is absent from the current command catalog is prose.
  This is the safety boundary that keeps shell variables such as `$HOME` and `$project`
  from being rendered as skills or rewritten on submission.

## Sigils are configurable

`packages/app/src/composer/tokens/sigils.ts`. Two settings — `commandTriggerSigil` and
`skillTriggerSigil` — default to `/` and `$`. The choices are an allowlist
(`COMPOSER_SIGIL_CHOICES`), not free text: a letter or digit would open the menu
constantly, and `@` is reserved for file mentions.

`resolveComposerSigils()` coerces a stored pair into a valid, collision-free one, and
**every consumer must go through it** (or through `useComposerSigils()`, which wraps it)
rather than reading the two settings directly. A stored pair can go stale — a choice
removed from the allowlist, or two clients writing the same character — and the composer
still needs a usable pair. On collision the command sigil wins because it is the older,
more load-bearing of the two.

In the settings UI, picking the character the _other_ menu already uses swaps the two
rather than rejecting the choice.

The sigils configure editing, not the provider protocol. Before a prompt is sent,
recognized catalog entries are normalized to `/name`. If the catalog has not loaded,
submission preserves the user's exact text. Without those boundaries, choosing `!` for
commands would silently turn executable provider and client commands into ordinary
prompt text, while `$` could silently rewrite shell variables.

## Web: a mirror layer

`token-highlight.web.tsx`. A div sits behind the `<textarea>` rendering the same string
with pills. The textarea paints its own text transparent (`color: transparent` plus
`caretColor`) so the mirror is what the user reads, while the textarea keeps the caret,
selection, IME and the native context menu.

**THE INVARIANT: the mirror must lay out character-for-character identically to the
textarea.** Two consequences, both load-bearing:

1. Every property affecting line breaking is _copied from the live textarea_ via
   `getComputedStyle` (`COPIED_STYLES`), not restated in a stylesheet. The composer's
   font size is user-configurable and its width changes with panel layout; a stylesheet
   drifts, a copy cannot.
2. **A pill may not change the advance width of the text it decorates.** Horizontal
   padding is cancelled by an equal negative margin, so the pill grows visually around
   the glyphs without moving them. Never change one without the other.

Consequence (2) is why the pill shows the literal draft text (`$release-beta`) rather
than an icon plus a prettified display name — either would add width and desynchronise
the wrap, putting the caret off the glyphs. Submission may canonicalize the leading
sigil, but it never changes the token name. Getting icons and display names on web
means replacing the textarea with a contenteditable editor; it cannot be done with a
mirror.

### Colors

Fill, border and text all derive from **`accentBright`**, not `accent`. `accent`
(`#20744A`) is the dark fill green; a tint of it under foreground-colored text goes
muddy on dark and harsh on light. `accentBright` is the theme's accent-as-text token —
the same one markdown links use — and reads in both themes.

Colors reach this component as props via `withUnistyles` (alternative 3 in
[unistyles.md](unistyles.md)), because it draws raw DOM rather than `style`-tracked RN
views. **Do not reach for `var(--colors-*)`:** nothing in Unistyles emits those
variables. `install-web-scrollbar-styles.web.ts` still references
`var(--colors-scrollbar-handle)`, which therefore resolves to nothing — treat that as a
bug to fix, not a pattern to copy.

Two smaller details that are easy to lose:

- The textarea sits _above_ the mirror, so its selection rectangle would paint over the
  mirror's glyphs. A translucent `::selection` (installed once, scoped to
  `[data-composer-tokenized]`) lets them read through. Without it, selecting tokenised
  text blanks it out.
- A trailing newline collapses unless something follows it, which would shift the
  mirror's last line relative to the textarea's. Hence the zero-width span.

To re-verify alignment after touching any of this: render the same string in both
layers with the textarea's text a visible color instead of transparent. The two sets of
glyphs must coincide exactly, and the wrap point must match, including when a token
straddles the wrap boundary.

## Native: plain text by design

`token-highlight.native.tsx` is intentionally a no-op. Android React Native throws when
a `TextInput` receives both a controlled `value` and children; iOS ignores those
children. Dropping `value` would sacrifice the controlled-input contract and make
selection, dictation and external draft updates unreliable.

A native mirror would also have to reproduce the input's font metrics, wrapping and
scroll exactly to keep the caret on the glyphs. Native pills therefore require a real
attributed-input implementation or custom text view. Until then, native keeps the
existing controlled plain-text path.

## The web renderer opts out when there is no token

Web keeps rendering through the plain textarea instead of the mirror when the draft has
no token. `ComposerTokenHighlightLayer` takes an `enabled` prop and installs no
observers in that common path.

## Sent messages: canonical data, configured presentation

Submitted and queued text use the provider-compatible `/name` form. Sent-message
bubbles recover token type from position — a leading slash is a command and a slash
after whitespace is a skill — then display the token with the current configured
command or skill sigil. The copy action, rewind, persistence and provider history still
use the canonical text; only the rendered `Text` spans change.

Unlike the controlled composer input, a sent message can safely use nested React Native
`Text` spans, so pills render on web, Electron, iOS and Android without a mirror layer.
Changing trigger settings consequently updates the presentation of existing history
without rewriting that history.

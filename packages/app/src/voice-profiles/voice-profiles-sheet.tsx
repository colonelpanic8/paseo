import {
  useCallback,
  useEffect,
  useMemo,
  useState,
  useSyncExternalStore,
  type ReactElement,
} from "react";
import { Text, View, type PressableStateCallbackType } from "react-native";
import { StyleSheet, withUnistyles } from "react-native-unistyles";
import { useTranslation } from "react-i18next";
import { Check, MoreVertical } from "lucide-react-native";
import type { VoiceProfile, VoiceThread } from "@getpaseo/protocol/voice-profiles";
import { AdaptiveModalSheet, type SheetHeader } from "@/components/adaptive-modal-sheet";
import { HostFilter } from "@/components/hosts/host-filter";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { isNative } from "@/constants/platform";
import { useCompactTimeAgo } from "@/hooks/use-compact-time-ago";
import { useLiveVoiceHostAvailability } from "@/live-voice/live-voice-availability";
import { useLiveVoiceBackendModelOptions } from "@/live-voice/live-voice-backend-model-catalog";
import { useLiveVoiceVoiceOptions } from "@/hooks/use-live-voice-voice-options";
import { useHosts } from "@/runtime/host-runtime";
import type { Theme } from "@/styles/theme";
import { confirmDialog } from "@/utils/confirm-dialog";
import { toErrorMessage } from "@/utils/error-messages";
import { openVoiceProfileForm, type VoiceProfileFormModel } from "./voice-profile-form-model";
import { VoiceProfileFormView } from "./voice-profile-form-view";
import { VoiceThreadHistoryView } from "./voice-thread-history-view";
import { useVoiceProfileMutations } from "./voice-profile-mutations";
import { useVoiceProfiles, useVoiceThreads } from "./voice-profile-queries";
import { useVoiceSelectionStore } from "./voice-selection-store";
import { resolveVoiceThreadTitle } from "./voice-thread-title";

const ThemedKebab = withUnistyles(MoreVertical);
const ThemedCheck = withUnistyles(Check);
const mutedMapping = (theme: Theme) => ({ color: theme.colors.foregroundMuted });
const foregroundMapping = (theme: Theme) => ({ color: theme.colors.foreground });
const successMapping = (theme: Theme) => ({ color: theme.colors.statusSuccess });
const ROW_ICON_SIZE = 14;

type SheetView =
  | { kind: "list" }
  | { kind: "form"; model: VoiceProfileFormModel; title: string }
  | { kind: "history"; thread: VoiceThread };

export interface VoiceProfilesSheetProps {
  visible: boolean;
  onClose: () => void;
  /** Which host to open on. Falls back to the first host with profiles. */
  initialServerId?: string | null;
}

/**
 * Profiles and threads for one host, and everything done to them: create or
 * edit a profile, pick what the launcher starts, read and compact a thread's
 * history, delete. Three views in one sheet, reached through the header's back
 * arrow, so the user is never left on a stale list while a second modal edits it.
 */
export function VoiceProfilesSheet(props: VoiceProfilesSheetProps): ReactElement | null {
  return props.visible ? <OpenVoiceProfilesSheet {...props} /> : null;
}

function OpenVoiceProfilesSheet({
  onClose,
  initialServerId = null,
}: VoiceProfilesSheetProps): ReactElement {
  const { t } = useTranslation();
  const hosts = useHosts();
  const availability = useLiveVoiceHostAvailability();
  const capableHosts = useMemo(
    () =>
      hosts.filter((host) =>
        availability.some(
          (candidate) =>
            candidate.serverId === host.serverId &&
            candidate.connectionStatus === "online" &&
            candidate.supportsVoiceProfiles === true,
        ),
      ),
    [availability, hosts],
  );
  const [chosenServerId, setChosenServerId] = useState<string | null>(
    () => initialServerId ?? capableHosts[0]?.serverId ?? null,
  );
  const serverId = chosenServerId;
  useEffect(() => {
    if (chosenServerId === null && capableHosts[0]) setChosenServerId(capableHosts[0].serverId);
  }, [capableHosts, chosenServerId]);

  const [view, setView] = useState<SheetView>({ kind: "list" });

  const {
    profiles,
    defaultProfileId,
    isLoading: isLoadingProfiles,
    error: profilesError,
  } = useVoiceProfiles(serverId);
  const { threads, isLoading: isLoadingThreads, error: threadsError } = useVoiceThreads(serverId);
  const [actionError, setActionError] = useState<string | null>(null);
  const voiceOptions = useLiveVoiceVoiceOptions();
  const backendModelOptions = useLiveVoiceBackendModelOptions();
  const mutations = useVoiceProfileMutations({ serverId: serverId ?? "" });
  const selectedProfileId = useVoiceSelectionStore((state) =>
    serverId ? (state.profileByServerId[serverId] ?? null) : null,
  );
  const selectedThreadId = useVoiceSelectionStore((state) =>
    serverId ? (state.threadByServerId[serverId] ?? null) : null,
  );
  const selectProfile = useVoiceSelectionStore((state) => state.selectProfile);
  const selectThread = useVoiceSelectionStore((state) => state.selectThread);

  // Late catalog data is an explicit model input, never a reconstruction.
  const formModel = view.kind === "form" ? view.model : null;
  useEffect(() => () => formModel?.close(), [formModel]);
  useEffect(() => {
    formModel?.applyVoiceOptions(voiceOptions);
  }, [formModel, voiceOptions]);
  useEffect(() => {
    formModel?.applyBackendModelOptions(backendModelOptions);
  }, [backendModelOptions, formModel]);

  const showList = useCallback(() => {
    setView((current) => {
      if (current.kind === "form") current.model.close();
      return { kind: "list" };
    });
  }, []);

  const openForm = useCallback(
    (title: string, snapshot: Parameters<typeof openVoiceProfileForm>[0]) => {
      setView((current) => {
        if (current.kind === "form") current.model.close();
        return { kind: "form", title, model: openVoiceProfileForm(snapshot) };
      });
    },
    [],
  );

  const handleNewProfile = useCallback(() => {
    openForm(t("voiceProfiles.form.createTitle"), {
      mode: "create",
      voiceOptions,
      backendModelOptions,
    });
  }, [backendModelOptions, openForm, t, voiceOptions]);
  const handleEditProfile = useCallback(
    (profile: VoiceProfile) => {
      openForm(t("voiceProfiles.form.editTitle"), {
        mode: "edit",
        record: profile,
        voiceOptions,
        backendModelOptions,
      });
    },
    [backendModelOptions, openForm, t, voiceOptions],
  );
  const handleOpenHistory = useCallback((thread: VoiceThread) => {
    setView({ kind: "history", thread });
  }, []);

  const handleUseProfile = useCallback(
    (profile: VoiceProfile | null) => {
      if (serverId) selectProfile(serverId, profile?.id ?? null);
    },
    [selectProfile, serverId],
  );
  const handleContinueThread = useCallback(
    (thread: VoiceThread | null) => {
      if (!serverId) return;
      if (thread) selectProfile(serverId, thread.profileId);
      selectThread(serverId, thread?.id ?? null);
    },
    [selectProfile, selectThread, serverId],
  );

  const handleDeleteProfile = useCallback(
    async (profile: VoiceProfile) => {
      const confirmed = await confirmDialog({
        title: t("voiceProfiles.actions.deleteProfileTitle", { name: profile.name }),
        message: t("voiceProfiles.actions.deleteProfileMessage"),
        confirmLabel: t("voiceProfiles.actions.delete"),
        destructive: true,
      });
      if (!confirmed) return;
      setActionError(null);
      try {
        await mutations.deleteProfile(profile.id);
      } catch (error) {
        setActionError(toErrorMessage(error));
      }
    },
    [mutations, t],
  );
  const handleDeleteThread = useCallback(
    async (thread: VoiceThread) => {
      const confirmed = await confirmDialog({
        title: t("voiceProfiles.actions.deleteThreadTitle", {
          title: resolveVoiceThreadTitle(thread, t),
        }),
        message: t("voiceProfiles.actions.deleteThreadMessage"),
        confirmLabel: t("voiceProfiles.actions.delete"),
        destructive: true,
      });
      if (!confirmed) return;
      setActionError(null);
      try {
        await mutations.deleteThread(thread.id);
      } catch (error) {
        setActionError(toErrorMessage(error));
      }
    },
    [mutations, t],
  );

  const handleCompact = useCallback(
    async (input: { thread: VoiceThread; summary: string; throughSeq: number }) => {
      await mutations.compactThread({
        threadId: input.thread.id,
        expectedRevision: input.thread.revision,
        throughSeq: input.throughSeq,
        summary: input.summary,
      });
    },
    [mutations],
  );

  const submitForm = useCallback(async () => {
    if (view.kind !== "form") return;
    const { model } = view;
    const state = model.getState();
    if (!state.canSubmit) return;
    model.setSubmitError(null);
    try {
      await mutations.saveProfile(model.buildSaveInput());
      showList();
    } catch (error) {
      model.setSubmitError(toErrorMessage(error));
    }
  }, [mutations, showList, view]);
  const handleSubmitPress = useCallback(() => {
    void submitForm();
  }, [submitForm]);

  const header = useMemo<SheetHeader>(() => {
    if (view.kind === "form") {
      return { title: view.title, back: { onPress: showList } };
    }
    if (view.kind === "history") {
      return { title: resolveVoiceThreadTitle(view.thread, t), back: { onPress: showList } };
    }
    return { title: t("voiceProfiles.manage.title") };
  }, [showList, t, view]);

  const footer = useMemo(
    () =>
      view.kind === "form" ? (
        <VoiceProfileFormFooter
          model={view.model}
          isSaving={mutations.isSaving}
          onCancel={showList}
          onSubmit={handleSubmitPress}
        />
      ) : undefined,
    [view, mutations.isSaving, showList, handleSubmitPress],
  );

  const profileNames = useMemo(
    () => new Map(profiles.map((profile) => [profile.id, profile.name])),
    [profiles],
  );

  return (
    <AdaptiveModalSheet
      visible
      onClose={onClose}
      header={header}
      footer={footer}
      sizeContentToCurrentSnapPoint
      testID="voice-profiles-sheet"
    >
      {view.kind === "form" ? (
        <VoiceProfileFormView model={view.model} disabled={mutations.isSaving} />
      ) : null}
      {view.kind === "history" && serverId ? (
        <VoiceThreadHistoryView
          key={`${serverId}:${view.thread.id}`}
          serverId={serverId}
          threadId={view.thread.id}
          disabled={mutations.isSaving}
          onCompact={handleCompact}
        />
      ) : null}
      {view.kind === "list" ? (
        <View style={styles.list}>
          {actionError ? <Text style={styles.error}>{actionError}</Text> : null}
          {capableHosts.length > 1 && serverId ? (
            <HostFilter
              hosts={capableHosts}
              selectedHost={serverId}
              onSelectHost={setChosenServerId}
              includeAllHost={false}
              triggerTestID="voice-profiles-sheet-host"
            />
          ) : null}
          {!serverId ? <Text style={styles.muted}>{t("voiceProfiles.manage.noHosts")}</Text> : null}
          {serverId ? (
            <>
              <View style={styles.sectionHeader}>
                <Text style={styles.sectionTitle}>{t("voiceProfiles.manage.profiles")}</Text>
                <Button
                  size="sm"
                  variant="secondary"
                  onPress={handleNewProfile}
                  disabled={mutations.isSaving}
                  testID="voice-profiles-sheet-new-profile"
                >
                  {t("voiceProfiles.actions.newProfile")}
                </Button>
              </View>
              {profilesError ? (
                <Text style={styles.error}>{toErrorMessage(profilesError)}</Text>
              ) : null}
              {profiles.length === 0 && !isLoadingProfiles ? (
                <Text style={styles.muted}>{t("voiceProfiles.manage.profilesEmpty")}</Text>
              ) : null}
              {profiles.map((profile) => (
                <ProfileRow
                  key={profile.id}
                  profile={profile}
                  isDefault={profile.id === defaultProfileId}
                  isSelected={profile.id === selectedProfileId}
                  disabled={mutations.isDeleting}
                  onUse={handleUseProfile}
                  onEdit={handleEditProfile}
                  onDelete={handleDeleteProfile}
                />
              ))}

              <View style={[styles.sectionHeader, styles.sectionHeaderSpaced]}>
                <Text style={styles.sectionTitle}>{t("voiceProfiles.manage.threads")}</Text>
              </View>
              {threadsError ? (
                <Text style={styles.error}>{toErrorMessage(threadsError)}</Text>
              ) : null}
              {threads.length === 0 && !isLoadingThreads ? (
                <Text style={styles.muted}>{t("voiceProfiles.manage.threadsEmpty")}</Text>
              ) : null}
              {threads.map((thread) => (
                <ThreadRow
                  key={thread.id}
                  thread={thread}
                  profileName={
                    thread.profileId ? (profileNames.get(thread.profileId) ?? null) : null
                  }
                  isSelected={thread.id === selectedThreadId}
                  disabled={mutations.isDeleting}
                  onContinue={handleContinueThread}
                  onOpenHistory={handleOpenHistory}
                  onDelete={handleDeleteThread}
                />
              ))}
            </>
          ) : null}
        </View>
      ) : null}
    </AdaptiveModalSheet>
  );
}

function VoiceProfileFormFooter({
  model,
  isSaving,
  onCancel,
  onSubmit,
}: {
  model: VoiceProfileFormModel;
  isSaving: boolean;
  onCancel: () => void;
  onSubmit: () => void;
}): ReactElement {
  const { t } = useTranslation();
  const state = useSyncExternalStore(model.subscribe, model.getState, model.getState);
  return (
    <View style={styles.footer}>
      <Button
        style={styles.footerButton}
        variant="secondary"
        onPress={onCancel}
        disabled={isSaving}
      >
        {t("common.actions.cancel")}
      </Button>
      <Button
        style={styles.footerButton}
        variant="default"
        onPress={onSubmit}
        disabled={!state.canSubmit || isSaving}
        loading={isSaving}
        testID="voice-profile-form-submit"
      >
        {state.mode === "edit" ? t("voiceProfiles.form.save") : t("voiceProfiles.form.create")}
      </Button>
    </View>
  );
}

function renderKebabTriggerIcon({ hovered }: { hovered?: boolean }): ReactElement {
  return <ThemedKebab size={ROW_ICON_SIZE} uniProps={hovered ? foregroundMapping : mutedMapping} />;
}

function kebabTriggerStyle({
  hovered = false,
}: PressableStateCallbackType & { hovered?: boolean }) {
  return [styles.kebabTrigger, hovered && styles.kebabTriggerHovered];
}

function ProfileRow({
  profile,
  isDefault,
  isSelected,
  disabled,
  onUse,
  onEdit,
  onDelete,
}: {
  profile: VoiceProfile;
  isDefault: boolean;
  isSelected: boolean;
  disabled: boolean;
  onUse: (profile: VoiceProfile | null) => void;
  onEdit: (profile: VoiceProfile) => void;
  onDelete: (profile: VoiceProfile) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const editable = profile.source === "user";
  let hint = profile.configuration.instructions || t("voiceProfiles.manage.noInstructions");
  if (!editable) hint = t("voiceProfiles.manage.fromConfig");
  if (isDefault) hint = t("voiceProfiles.manage.hostDefault");
  if (isSelected) hint = t("voiceProfiles.manage.selectedForCalls");
  const handleUse = useCallback(
    () => onUse(isSelected ? null : profile),
    [onUse, isSelected, profile],
  );
  const handleEdit = useCallback(() => onEdit(profile), [onEdit, profile]);
  const handleDelete = useCallback(() => {
    void onDelete(profile);
  }, [onDelete, profile]);
  return (
    <View style={styles.row} testID={`voice-profile-row-${profile.id}`}>
      <View style={styles.rowContent}>
        <View style={styles.rowTitleLine}>
          {isSelected ? <ThemedCheck size={ROW_ICON_SIZE} uniProps={successMapping} /> : null}
          <Text style={styles.rowTitle} numberOfLines={1}>
            {profile.name}
          </Text>
        </View>
        <Text style={styles.rowHint} numberOfLines={1}>
          {hint}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={kebabTriggerStyle}
          accessibilityRole={isNative ? "button" : undefined}
          accessibilityLabel={t("voiceProfiles.actions.menu", { name: profile.name })}
          testID={`voice-profile-kebab-${profile.id}`}
        >
          {renderKebabTriggerIcon}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={240}>
          <DropdownMenuItem onSelect={handleUse} testID={`voice-profile-menu-use-${profile.id}`}>
            {isSelected
              ? t("voiceProfiles.actions.stopUsing")
              : t("voiceProfiles.actions.useForCalls")}
          </DropdownMenuItem>
          {editable ? (
            <>
              <DropdownMenuItem onSelect={handleEdit}>
                {t("voiceProfiles.actions.edit")}
              </DropdownMenuItem>
              <DropdownMenuSeparator />
              <DropdownMenuItem
                destructive
                disabled={disabled}
                onSelect={handleDelete}
                testID={`voice-profile-menu-delete-${profile.id}`}
              >
                {t("voiceProfiles.actions.delete")}
              </DropdownMenuItem>
            </>
          ) : null}
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

function ThreadRow({
  thread,
  profileName,
  isSelected,
  disabled,
  onContinue,
  onOpenHistory,
  onDelete,
}: {
  thread: VoiceThread;
  profileName: string | null;
  isSelected: boolean;
  disabled: boolean;
  onContinue: (thread: VoiceThread | null) => void;
  onOpenHistory: (thread: VoiceThread) => void;
  onDelete: (thread: VoiceThread) => Promise<void>;
}): ReactElement {
  const { t } = useTranslation();
  const timeAgo = useCompactTimeAgo(new Date(thread.updatedAt));
  const title = resolveVoiceThreadTitle(thread, t);
  const hint = [profileName, timeAgo, t("voiceProfiles.manage.entries", { n: thread.lastSeq })]
    .filter(Boolean)
    .join(" · ");
  const handleContinue = useCallback(
    () => onContinue(isSelected ? null : thread),
    [onContinue, isSelected, thread],
  );
  const handleHistory = useCallback(() => onOpenHistory(thread), [onOpenHistory, thread]);
  const handleDelete = useCallback(() => {
    void onDelete(thread);
  }, [onDelete, thread]);
  return (
    <View style={styles.row} testID={`voice-thread-row-${thread.id}`}>
      <View style={styles.rowContent}>
        <View style={styles.rowTitleLine}>
          {isSelected ? <ThemedCheck size={ROW_ICON_SIZE} uniProps={successMapping} /> : null}
          <Text style={styles.rowTitle} numberOfLines={1}>
            {title}
          </Text>
        </View>
        <Text style={styles.rowHint} numberOfLines={1}>
          {isSelected ? t("voiceProfiles.manage.continuing") : hint}
        </Text>
      </View>
      <DropdownMenu>
        <DropdownMenuTrigger
          style={kebabTriggerStyle}
          accessibilityRole={isNative ? "button" : undefined}
          accessibilityLabel={t("voiceProfiles.actions.menu", { name: title })}
          testID={`voice-thread-kebab-${thread.id}`}
        >
          {renderKebabTriggerIcon}
        </DropdownMenuTrigger>
        <DropdownMenuContent align="end" width={240}>
          <DropdownMenuItem
            onSelect={handleContinue}
            testID={`voice-thread-menu-continue-${thread.id}`}
          >
            {isSelected
              ? t("voiceProfiles.actions.stopContinuing")
              : t("voiceProfiles.actions.continueThread")}
          </DropdownMenuItem>
          <DropdownMenuItem onSelect={handleHistory}>
            {t("voiceProfiles.actions.openHistory")}
          </DropdownMenuItem>
          <DropdownMenuSeparator />
          <DropdownMenuItem
            destructive
            disabled={disabled}
            onSelect={handleDelete}
            testID={`voice-thread-menu-delete-${thread.id}`}
          >
            {t("voiceProfiles.actions.delete")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </View>
  );
}

const styles = StyleSheet.create((theme) => ({
  list: {
    gap: theme.spacing[2],
  },
  sectionHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: theme.spacing[2],
  },
  sectionHeaderSpaced: {
    marginTop: theme.spacing[4],
  },
  sectionTitle: {
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
    fontWeight: theme.fontWeight.medium,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[2],
    paddingVertical: theme.spacing[2],
    borderBottomWidth: 1,
    borderBottomColor: theme.colors.border,
  },
  rowContent: {
    flex: 1,
    minWidth: 0,
    gap: theme.spacing[1],
  },
  rowTitleLine: {
    flexDirection: "row",
    alignItems: "center",
    gap: theme.spacing[1],
  },
  rowTitle: {
    flexShrink: 1,
    color: theme.colors.foreground,
    fontSize: theme.fontSize.base,
  },
  rowHint: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  kebabTrigger: {
    padding: theme.spacing[1],
    borderRadius: theme.borderRadius.base,
  },
  kebabTriggerHovered: {
    backgroundColor: theme.colors.surface2,
  },
  muted: {
    color: theme.colors.foregroundMuted,
    fontSize: theme.fontSize.sm,
  },
  error: {
    color: theme.colors.destructive,
    fontSize: theme.fontSize.sm,
  },
  footer: {
    flex: 1,
    flexDirection: "row",
    gap: theme.spacing[3],
  },
  footerButton: {
    flex: 1,
  },
}));

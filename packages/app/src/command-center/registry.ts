import type {
  CommandCenterContribution,
  CommandCenterContributionSnapshot,
  CommandCenterRegistration,
  CommandCenterRegistrationOwner,
} from "./contributions";

export interface CommandCenterRegistry {
  getSnapshot(): CommandCenterContributionSnapshot;
  subscribe(listener: () => void): () => void;
  replace(registration: CommandCenterRegistration): void;
  remove(owner: CommandCenterRegistrationOwner): void;
  runShortcut(shortcutId: string): boolean;
}

interface ActiveRegistration {
  owner: CommandCenterRegistrationOwner;
  contributions: readonly CommandCenterContribution[];
  enabled?: boolean;
}

const EMPTY_SNAPSHOT: CommandCenterContributionSnapshot = {
  contributions: [],
  shortcutCatalog: [],
};

function contributionId(sourceId: string, id: string): string {
  return `${sourceId}:${id}`;
}

function compareContributions(
  left: CommandCenterContribution,
  right: CommandCenterContribution,
): number {
  if (left.groupRank !== right.groupRank) return left.groupRank - right.groupRank;
  const groupDelta = left.group.localeCompare(right.group);
  if (groupDelta !== 0) return groupDelta;
  if (left.rank !== right.rank) return left.rank - right.rank;
  return left.id.localeCompare(right.id);
}

function sameContributions(
  left: readonly CommandCenterContribution[],
  right: readonly CommandCenterContribution[],
): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

export function getResolvableShortcutIds(
  contributions: readonly CommandCenterContribution[],
): string[] {
  const counts = new Map<string, number>();
  for (const contribution of contributions) {
    if (!contribution.shortcutId) continue;
    counts.set(contribution.shortcutId, (counts.get(contribution.shortcutId) ?? 0) + 1);
  }
  return [...counts].flatMap(([shortcutId, count]) => (count === 1 ? [shortcutId] : []));
}

export function createCommandCenterRegistry(): CommandCenterRegistry {
  const registrations = new Map<string, ActiveRegistration>();
  const listeners = new Set<() => void>();
  let snapshot = EMPTY_SNAPSHOT;

  function publish(): void {
    const contributions: CommandCenterContribution[] = [];
    const shortcutCatalog: CommandCenterContribution[] = [];
    const ids = new Set<string>();

    for (const registration of registrations.values()) {
      for (const contribution of registration.contributions) {
        const id = contributionId(registration.owner.sourceId, contribution.id);
        if (ids.has(id)) {
          throw new Error(`Duplicate Command Center contribution id: ${id}`);
        }
        ids.add(id);
        const registeredContribution = { ...contribution, id };
        if (registration.enabled !== false) {
          contributions.push(registeredContribution);
        }
        if (registeredContribution.shortcutId) {
          shortcutCatalog.push(registeredContribution);
        }
      }
    }
    contributions.sort(compareContributions);
    shortcutCatalog.sort(compareContributions);

    if (
      sameContributions(snapshot.contributions, contributions) &&
      sameContributions(snapshot.shortcutCatalog, shortcutCatalog)
    ) {
      return;
    }
    snapshot =
      contributions.length === 0 && shortcutCatalog.length === 0
        ? EMPTY_SNAPSHOT
        : { contributions, shortcutCatalog };
    for (const listener of listeners) listener();
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    replace(registration) {
      const current = registrations.get(registration.owner.sourceId);
      if (
        current?.owner.token === registration.owner.token &&
        current.enabled === registration.enabled &&
        sameContributions(current.contributions, registration.contributions)
      ) {
        return;
      }
      const ids = new Set<string>();
      for (const contribution of registration.contributions) {
        const id = contributionId(registration.owner.sourceId, contribution.id);
        if (ids.has(id)) throw new Error(`Duplicate Command Center contribution id: ${id}`);
        ids.add(id);
      }
      registrations.set(registration.owner.sourceId, registration);
      publish();
    },
    remove(owner) {
      const current = registrations.get(owner.sourceId);
      if (current?.owner.token !== owner.token) return;
      registrations.delete(owner.sourceId);
      publish();
    },
    runShortcut(shortcutId) {
      const matches = snapshot.contributions.filter(
        (contribution) => contribution.shortcutId === shortcutId,
      );
      if (matches.length !== 1) return false;
      void matches[0].run();
      return true;
    },
  };
}

"use client";

import { useEffect, useMemo, useState } from "react";
import { createId } from "@/lib/policyEngine";
import { cloneSeedPolicies } from "@/lib/seed";
import type { DecisionKind, DecisionQueueItem, DecisionRun, Policy, Principle } from "@/lib/types";

const policyStorageKey = "opsgym-policies-v1";
const legacyStorageKey = "opsgym-workflows-v2";
const legacyIdKey = "workflow" + "Id";
const publicAppUrl = process.env.NEXT_PUBLIC_OPSGYM_APP_URL ?? "https://opsgym.pdt.dev";

type Screen = "dashboard" | "policy";
type DirectorySection = "overview" | "policy" | "principles" | "endpoint" | "queue" | "runs";
type DrawerState =
  | { type: "createPolicy" }
  | { type: "policyDetails" }
  | { type: "policy" }
  | { type: "principles" }
  | { type: "run"; id: string }
  | { type: "queue"; id: string }
  | null;

type LegacyDecisionRun = Omit<DecisionRun, "policyId"> & {
  policyId?: string;
  [key: string]: unknown;
};

type LegacyDecisionQueueItem = Omit<DecisionQueueItem, "policyId"> & {
  policyId?: string;
  [key: string]: unknown;
};

type StoredPolicy = Omit<Policy, "endpointPath" | "runs" | "decisionQueue"> & {
  endpointPath?: string;
  runs?: LegacyDecisionRun[];
  decisionQueue?: LegacyDecisionQueueItem[];
};

type CreatePolicyDraft = {
  name: string;
  description: string;
  policy: string;
  principles: string;
};

const starterAction = "Refund a VIP customer's damaged order from 45 days ago without manager approval.";

const defaultPolicyText =
  "Wait when policy coverage is unclear. Pass only when the action is explicitly covered. Fail when it violates a boundary.";

const defaultPrincipleText = "Prefer safe decisions: When the policy cannot safely decide, wait for review.";

const sectionLabels: Record<DirectorySection, string> = {
  overview: "Overview",
  policy: "Policy",
  principles: "Principles",
  endpoint: "Endpoint",
  queue: "Queue",
  runs: "Runs"
};

function endpointPathFor(policyId: string) {
  return `/api/policies/${policyId}/decision`;
}

function createPolicyDraft(): CreatePolicyDraft {
  return {
    name: "New Policy",
    description: "Policy-backed decision endpoint.",
    policy: defaultPolicyText,
    principles: defaultPrincipleText
  };
}

function slugify(value: string) {
  const slug = value
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");

  return slug || "policy";
}

function parsePrinciples(value: string): Principle[] {
  const lines = value
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  const sourceLines = lines.length > 0 ? lines : [defaultPrincipleText];

  return sourceLines.map((line) => {
    const [title, ...bodyParts] = line.split(":");
    const body = bodyParts.join(":").trim();

    return {
      id: createId("principle"),
      title: title.trim() || "Principle",
      body: body || "Describe the operating principle."
    };
  });
}

function policyFromDraft(draft: CreatePolicyDraft): Policy {
  const createdAt = new Date().toISOString();
  const id = `${slugify(draft.name)}-${Date.now().toString(36)}`;

  return {
    id,
    name: draft.name.trim() || "New Policy",
    description: draft.description.trim() || "Policy-backed decision endpoint.",
    policy: draft.policy.trim() || defaultPolicyText,
    principles: parsePrinciples(draft.principles),
    endpointPath: endpointPathFor(id),
    runs: [],
    decisionQueue: [],
    createdAt,
    updatedAt: createdAt
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
}

function normalizeString(value: unknown, fallback: string) {
  return typeof value === "string" && value.trim().length > 0 ? value : fallback;
}

function coercePrinciples(value: unknown): Principle[] {
  if (!Array.isArray(value)) {
    return parsePrinciples(defaultPrincipleText);
  }

  const principles = value.flatMap((item) => {
    const record = asRecord(item);
    if (!record) return [];

    return [
      {
        id: normalizeString(record.id, createId("principle")),
        title: normalizeString(record.title, "Principle"),
        body: normalizeString(record.body, "Describe the operating principle.")
      }
    ];
  });

  return principles.length > 0 ? principles : parsePrinciples(defaultPrincipleText);
}

function coerceStoredPolicy(value: unknown): StoredPolicy | null {
  const record = asRecord(value);
  if (!record || typeof record.id !== "string" || record.id.trim().length === 0) {
    return null;
  }

  return {
    id: record.id,
    name: normalizeString(record.name, "Policy"),
    description: normalizeString(record.description, "Policy-backed decision endpoint."),
    policy: normalizeString(record.policy, defaultPolicyText),
    principles: coercePrinciples(record.principles),
    endpointPath: typeof record.endpointPath === "string" ? record.endpointPath : undefined,
    runs: Array.isArray(record.runs) ? (record.runs as LegacyDecisionRun[]) : [],
    decisionQueue: Array.isArray(record.decisionQueue) ? (record.decisionQueue as LegacyDecisionQueueItem[]) : [],
    createdAt: normalizeString(record.createdAt, new Date().toISOString()),
    updatedAt: normalizeString(record.updatedAt, new Date().toISOString())
  };
}

function parseStoredPolicies(raw: string | null) {
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];

    return parsed.flatMap((item) => {
      const policy = coerceStoredPolicy(item);
      return policy ? [normalizePolicy(policy)] : [];
    });
  } catch {
    return [];
  }
}

function normalizePolicy(record: StoredPolicy): Policy {
  const id = record.id;
  const runs = (record.runs ?? []).map((run) => {
    const rest = { ...run };
    const legacyId = rest[legacyIdKey];
    delete rest[legacyIdKey];

    return {
      ...(rest as Omit<DecisionRun, "policyId"> & { policyId?: string }),
      policyId: run.policyId ?? (typeof legacyId === "string" ? legacyId : id)
    };
  });
  const decisionQueue = (record.decisionQueue ?? []).map((item) => {
    const rest = { ...item };
    const legacyId = rest[legacyIdKey];
    delete rest[legacyIdKey];

    return {
      ...(rest as Omit<DecisionQueueItem, "policyId"> & { policyId?: string }),
      policyId: item.policyId ?? (typeof legacyId === "string" ? legacyId : id)
    };
  });

  return {
    ...record,
    endpointPath: endpointPathFor(id),
    runs,
    decisionQueue
  };
}

function loadStoredPolicies(): Policy[] {
  const current = parseStoredPolicies(window.localStorage.getItem(policyStorageKey));
  if (current.length > 0) return current;

  const migrated = parseStoredPolicies(window.localStorage.getItem(legacyStorageKey));
  if (migrated.length > 0) {
    try {
      window.localStorage.setItem(policyStorageKey, JSON.stringify(migrated));
    } catch {
      // Storage can be disabled or full; keep the in-memory migration usable.
    }
    return migrated;
  }

  return cloneSeedPolicies();
}

function decisionClass(decision: DecisionKind) {
  return `badge ${decision}`;
}

function formatTime(value: string) {
  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit"
  }).format(new Date(value));
}

function mergeById<T extends { id: string; createdAt: string }>(incoming: T[], existing: T[]) {
  const seen = new Set(incoming.map((item) => item.id));
  return [...incoming, ...existing.filter((item) => !seen.has(item.id))].sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

function openQueueCount(policy: Policy) {
  return policy.decisionQueue.filter((item) => item.status === "open").length;
}

function isApiError(value: unknown): value is { error?: string } {
  return !!value && typeof value === "object" && "error" in value;
}

export default function Home() {
  const [policies, setPolicies] = useState<Policy[]>(() => cloneSeedPolicies());
  const [screen, setScreen] = useState<Screen>("dashboard");
  const [selectedPolicyId, setSelectedPolicyId] = useState("refund-policy");
  const [section, setSection] = useState<DirectorySection>("overview");
  const [drawer, setDrawer] = useState<DrawerState>(null);
  const [createDraft, setCreateDraft] = useState<CreatePolicyDraft>(() => createPolicyDraft());
  const [endpointAction, setEndpointAction] = useState(starterAction);
  const [apiStatus, setApiStatus] = useState("");
  const [improvingQueueItemId, setImprovingQueueItemId] = useState<string | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"all" | "review" | "active" | "quiet">("all");
  const [sortBy, setSortBy] = useState<"updated" | "alphabetical" | "runs" | "queue">("updated");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const [overviewTab, setOverviewTab] = useState<"queue" | "runs" | "policy">("queue");
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [selectedQueueItemId, setSelectedQueueItemId] = useState<string | null>(null);

  useEffect(() => {
    const storedPolicies = loadStoredPolicies();
    if (storedPolicies.length > 0) {
      setPolicies(storedPolicies);
      setSelectedPolicyId(storedPolicies[0].id);
    }
  }, []);

  useEffect(() => {
    const policyId = new URLSearchParams(window.location.search).get("policy");
    if (!policyId) return;

    let cancelled = false;

    fetch(`/api/policies/${policyId}`)
      .then((response) => response.ok ? response.json() : null)
      .then((policy: Policy | null) => {
        if (cancelled || !policy?.id) return;

        setPolicies((current) => {
          const exists = current.some((item) => item.id === policy.id);
          return exists
            ? current.map((item) => (item.id === policy.id ? policy : item))
            : [policy, ...current];
        });
        setSelectedPolicyId(policy.id);
        setScreen("policy");
        setSection("overview");
      })
      .catch(() => {
        if (!cancelled) setApiStatus("Policy link could not be loaded");
      });

    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(policyStorageKey, JSON.stringify(policies));
    } catch {
      setApiStatus("Local storage is unavailable");
    }
  }, [policies]);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "k") {
        e.preventDefault();
        const input = document.getElementById("searchInputField");
        if (input) {
          input.focus();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  const selectedPolicy = policies.find((policy) => policy.id === selectedPolicyId) ?? policies[0];
  const openQueue = selectedPolicy.decisionQueue.filter((item) => item.status === "open");




  const filteredPolicies = useMemo(() => {
    return policies.filter((policy) => {
      const query = searchQuery.toLowerCase().trim();
      const matchesSearch =
        !query ||
        policy.name.toLowerCase().includes(query) ||
        policy.description.toLowerCase().includes(query) ||
        policy.id.toLowerCase().includes(query);

      if (!matchesSearch) return false;

      const queueCount = openQueueCount(policy);
      const runsCount = policy.runs.length;

      if (statusFilter === "review") {
        return queueCount > 0;
      }
      if (statusFilter === "active") {
        return queueCount === 0 && runsCount > 0;
      }
      if (statusFilter === "quiet") {
        return queueCount === 0 && runsCount === 0;
      }
      return true;
    });
  }, [policies, searchQuery, statusFilter]);

  const sortedPolicies = useMemo(() => {
    return [...filteredPolicies].sort((a, b) => {
      if (sortBy === "alphabetical") {
        return a.name.localeCompare(b.name);
      }
      if (sortBy === "runs") {
        return b.runs.length - a.runs.length;
      }
      if (sortBy === "queue") {
        return openQueueCount(b) - openQueueCount(a);
      }
      return new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime();
    });
  }, [filteredPolicies, sortBy]);

  const counts = useMemo(() => {
    return {
      all: policies.length,
      review: policies.filter((p) => openQueueCount(p) > 0).length,
      active: policies.filter((p) => openQueueCount(p) === 0 && p.runs.length > 0).length,
      quiet: policies.filter((p) => openQueueCount(p) === 0 && p.runs.length === 0).length
    };
  }, [policies]);

  const handleCopyEndpoint = (e: React.MouseEvent, policyId: string, endpointPath: string) => {
    e.stopPropagation();
    const fullUrl = `${window.location.origin}${endpointPath}`;
    navigator.clipboard.writeText(fullUrl).then(() => {
      setCopiedId(policyId);
      setTimeout(() => setCopiedId(null), 2000);
    });
  };

  function updatePolicy(policy: Policy) {
    setPolicies((current) => current.map((item) => (item.id === policy.id ? policy : item)));
  }

  function updateSelectedPolicy(patch: Partial<Policy>) {
    updatePolicy({
      ...selectedPolicy,
      ...patch,
      updatedAt: new Date().toISOString()
    });
  }

  function openCreateDrawer() {
    setCreateDraft(createPolicyDraft());
    setDrawer({ type: "createPolicy" });
  }

  async function saveCreatedPolicy() {
    const policy = policyFromDraft(createDraft);
    setPolicies((current) => [policy, ...current]);
    setSelectedPolicyId(policy.id);
    setSection("overview");
    setScreen("policy");
    setDrawer(null);
    setApiStatus("");
    await syncPolicyToServer(policy);
  }

  function openPolicy(id: string) {
    setSelectedPolicyId(id);
    setSection("overview");
    setScreen("policy");
    setDrawer(null);
    setApiStatus("");
  }

  async function syncPolicyToServer(policy: Policy) {
    await fetch(`/api/policies/${policy.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(policy)
    });
  }

  async function refreshRuns(policy = selectedPolicy) {
    setApiStatus("Refreshing runs");
    const response = await fetch(`/api/policies/${policy.id}/runs`);
    if (!response.ok) {
      setApiStatus("Refresh failed");
      return;
    }

    const data = (await response.json()) as {
      runs: DecisionRun[];
      decisionQueue: DecisionQueueItem[];
    };

    const updated = {
      ...policy,
      runs: mergeById(data.runs, policy.runs),
      decisionQueue: mergeById(data.decisionQueue, policy.decisionQueue),
      updatedAt: new Date().toISOString()
    };

    updatePolicy(updated);
    setApiStatus("Runs refreshed");
  }

  async function callEndpoint() {
    const action = endpointAction.trim();
    if (!action) {
      setApiStatus("Enter an action first");
      return;
    }

    setApiStatus("Calling endpoint");
    await syncPolicyToServer(selectedPolicy);
    const response = await fetch(selectedPolicy.endpointPath, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action })
    });

    if (!response.ok) {
      setApiStatus("Endpoint call failed");
      return;
    }

    await refreshRuns(selectedPolicy);
    setSection("overview");
    setApiStatus("Decision recorded");
  }

  async function approveQueueItem(queueItemId: string) {
    setApiStatus("Approving policy change");
    await syncPolicyToServer(selectedPolicy);

    const response = await fetch(`/api/policies/${selectedPolicy.id}/queue/${queueItemId}/approve`, {
      method: "POST"
    });
    const updated = (await response.json().catch(() => null)) as Policy | { error?: string } | null;

    if (!response.ok || !updated || isApiError(updated)) {
      setApiStatus(isApiError(updated) ? updated.error ?? "Approval failed" : "Approval failed");
      return;
    }

    updatePolicy(updated);
    setDrawer(null);
    setSection("overview");
    setApiStatus("Policy change approved");
  }

  async function rejectQueueItem(queueItemId: string) {
    setApiStatus("Rejecting policy change");
    await syncPolicyToServer(selectedPolicy);

    const response = await fetch(`/api/policies/${selectedPolicy.id}/queue/${queueItemId}/reject`, {
      method: "POST"
    });
    const updated = (await response.json().catch(() => null)) as Policy | { error?: string } | null;

    if (!response.ok || !updated || isApiError(updated)) {
      setApiStatus(isApiError(updated) ? updated.error ?? "Rejection failed" : "Rejection failed");
      return;
    }

    updatePolicy(updated);
    setDrawer(null);
    setApiStatus("Policy change rejected");
  }

  async function improveQueueItem(queueItemId: string) {
    setImprovingQueueItemId(queueItemId);
    setApiStatus("Drafting policy improvement");

    try {
      await syncPolicyToServer(selectedPolicy);
      const response = await fetch(`/api/policies/${selectedPolicy.id}/queue/${queueItemId}/improve`, {
        method: "POST"
      });

      const data = (await response.json().catch(() => null)) as { policy?: Policy; error?: string } | null;

      if (!response.ok || !data?.policy) {
        setApiStatus(data?.error ?? "Agent proposal failed");
        return;
      }

      updatePolicy(data.policy);
      setApiStatus("Agent proposal drafted");
    } finally {
      setImprovingQueueItemId(null);
    }
  }

  function updatePrinciple(id: string, patch: Partial<Principle>) {
    updateSelectedPolicy({
      principles: selectedPolicy.principles.map((principle) =>
        principle.id === id ? { ...principle, ...patch } : principle
      )
    });
  }

  function addPrinciple() {
    updateSelectedPolicy({
      principles: [
        ...selectedPolicy.principles,
        {
          id: createId("principle"),
          title: "New principle",
          body: "Describe the operating principle."
        }
      ]
    });
  }

  const createDrawer = drawer?.type === "createPolicy" ? (
    <aside className="drawer dashboardDrawer">
      <div className="drawerTop">
        <strong>New Policy</strong>
        <button onClick={() => setDrawer(null)}>Cancel</button>
      </div>
      <div className="drawerBody">
        <label>
          Name
          <input
            value={createDraft.name}
            onChange={(event) => setCreateDraft((draft) => ({ ...draft, name: event.target.value }))}
          />
        </label>
        <label>
          Description
          <textarea
            value={createDraft.description}
            onChange={(event) => setCreateDraft((draft) => ({ ...draft, description: event.target.value }))}
          />
        </label>
        <label>
          Initial policy text
          <textarea
            className="largeInput"
            value={createDraft.policy}
            onChange={(event) => setCreateDraft((draft) => ({ ...draft, policy: event.target.value }))}
          />
        </label>
        <label>
          Principles
          <textarea
            value={createDraft.principles}
            onChange={(event) => setCreateDraft((draft) => ({ ...draft, principles: event.target.value }))}
          />
        </label>
        <div className="drawerActions">
          <button className="primary" onClick={saveCreatedPolicy}>
            Save
          </button>
          <button onClick={() => setDrawer(null)}>Cancel</button>
        </div>
      </div>
    </aside>
  ) : null;

  function renderSidePanel() {
    if (section === "overview") {
      if (overviewTab === "queue" && selectedQueueItemId) {
        const item = selectedPolicy.decisionQueue.find((i) => i.id === selectedQueueItemId);
        if (item) {
          return (
            <div className="panelContent">
              <div className="panelHeader">
                <h2>Queue Item Details</h2>
                <button className="closePanelBtn" onClick={() => setSelectedQueueItemId(null)}>Close</button>
              </div>
              <QueueDetail
                item={item}
                onApprove={approveQueueItem}
                onReject={rejectQueueItem}
                onImprove={improveQueueItem}
                isImproving={improvingQueueItemId === item.id}
              />
            </div>
          );
        }
      }
      if (overviewTab === "runs" && selectedRunId) {
        const run = selectedPolicy.runs.find((r) => r.id === selectedRunId);
        if (run) {
          return (
            <div className="panelContent">
              <div className="panelHeader">
                <h2>Run Details</h2>
                <button className="closePanelBtn" onClick={() => setSelectedRunId(null)}>Close</button>
              </div>
              <RunDetail run={run} />
            </div>
          );
        }
      }

      return (
        <div className="panelContent">
          <div className="panelHeader">
            <h2>Policy Settings</h2>
          </div>
          <div className="metadataEditor">
            <label>
              Policy Name
              <input
                value={selectedPolicy.name}
                onChange={(event) => updateSelectedPolicy({ name: event.target.value })}
              />
            </label>
            <label>
              Description
              <textarea
                value={selectedPolicy.description}
                onChange={(event) => updateSelectedPolicy({ description: event.target.value })}
              />
            </label>
            <div className="metadataInfo">
              <div className="infoRow">
                <span>Policy ID</span>
                <code>{selectedPolicy.id}</code>
              </div>
              <div className="infoRow">
                <span>Created</span>
                <span>{formatTime(selectedPolicy.createdAt)}</span>
              </div>
              <div className="infoRow">
                <span>Last Updated</span>
                <span>{formatTime(selectedPolicy.updatedAt)}</span>
              </div>
            </div>
          </div>
        </div>
      );
    }

    if (section === "policy") {
      return (
        <div className="panelContent">
          <div className="panelHeader">
            <h2>Edit Policy Text</h2>
          </div>
          <p className="panelHelpText">Modify the core rules governing how decisions are made for this endpoint.</p>
          <textarea
            className="largeInput"
            value={selectedPolicy.policy}
            onChange={(event) => updateSelectedPolicy({ policy: event.target.value })}
            placeholder="Enter policy instructions..."
          />
        </div>
      );
    }

    if (section === "principles") {
      return (
        <div className="panelContent">
          <div className="panelHeader">
            <h2>Manage Principles</h2>
          </div>
          <p className="panelHelpText">Principles are guidelines that the decision engine uses when rules are ambiguous.</p>
          <div className="principlesEditorList">
            {selectedPolicy.principles.map((principle) => (
              <div className="principleEditorBlock" key={principle.id}>
                <label>
                  Title
                  <input
                    value={principle.title}
                    onChange={(event) => updatePrinciple(principle.id, { title: event.target.value })}
                  />
                </label>
                <label>
                  Body
                  <textarea
                    value={principle.body}
                    onChange={(event) => updatePrinciple(principle.id, { body: event.target.value })}
                  />
                </label>
              </div>
            ))}
            <button className="addPrincipleBtn" onClick={addPrinciple}>
              + Add Principle
            </button>
          </div>
        </div>
      );
    }

    if (section === "endpoint") {
      return (
        <div className="panelContent">
          <div className="panelHeader">
            <h2>Test Endpoint</h2>
          </div>
          <p className="panelHelpText">Simulate a request payload to verify decision outcomes and confidence scores.</p>
          <div className="testerBlock">
            <label>
              Action Request
              <textarea
                value={endpointAction}
                onChange={(event) => setEndpointAction(event.target.value)}
                placeholder="e.g. Refund a damaged order from 5 days ago"
              />
            </label>
            <div className="actionLine">
              <button className="primary" onClick={callEndpoint}>
                Execute Test
              </button>
            </div>
            {apiStatus && (
              <div className="testStatus">
                <span>Status:</span>
                <strong>{apiStatus}</strong>
              </div>
            )}
          </div>
        </div>
      );
    }

    if (section === "queue") {
      const selectedItem = selectedQueueItemId
        ? selectedPolicy.decisionQueue.find((i) => i.id === selectedQueueItemId)
        : null;

      if (selectedItem) {
        return (
          <div className="panelContent">
            <div className="panelHeader">
              <h2>Queue Item Details</h2>
              <button className="closePanelBtn" onClick={() => setSelectedQueueItemId(null)}>Deselect</button>
            </div>
            <QueueDetail
              item={selectedItem}
              onApprove={approveQueueItem}
              onReject={rejectQueueItem}
              onImprove={improveQueueItem}
              isImproving={improvingQueueItemId === selectedItem.id}
            />
          </div>
        );
      }

      return (
        <div className="panelContent emptyPanel">
          <p>Select a queue item from the table to review details and approve/reject proposed change.</p>
        </div>
      );
    }

    if (section === "runs") {
      const selectedRun = selectedRunId
        ? selectedPolicy.runs.find((r) => r.id === selectedRunId)
        : null;

      if (selectedRun) {
        return (
          <div className="panelContent">
            <div className="panelHeader">
              <h2>Run Details</h2>
              <button className="closePanelBtn" onClick={() => setSelectedRunId(null)}>Deselect</button>
            </div>
            <RunDetail run={selectedRun} />
          </div>
        );
      }

      return (
        <div className="panelContent emptyPanel">
          <p>Select a run from the history table to view details, decision reasons, and confidence scores.</p>
        </div>
      );
    }

    return null;
  }

  return (
    <main className={screen === "dashboard" ? "app dashboardOnly" : "app"}>
      {screen === "dashboard" ? (
        <>
          <section className="dashboard">
            <header className="dashboardHeader">
              <h1>OpsGym</h1>
              <button className="primary" onClick={openCreateDrawer}>
                New Policy
              </button>
            </header>

            {/* Controls Bar for Search, Filter, Sort */}
            <div className="controlsBar">
              <div className="searchWrapper">
                <svg className="searchIcon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <circle cx="11" cy="11" r="8" />
                  <line x1="21" y1="21" x2="16.65" y2="16.65" />
                </svg>
                <input
                  type="text"
                  placeholder="Search policies... (⌘K)"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="searchInput"
                  id="searchInputField"
                />
                {searchQuery && (
                  <button className="clearSearch" onClick={() => setSearchQuery("")} title="Clear Search">
                    &times;
                  </button>
                )}
              </div>

              <div className="filterGroup">
                <button
                  className={statusFilter === "all" ? "filterTab active" : "filterTab"}
                  onClick={() => setStatusFilter("all")}
                >
                  All <span className="tabCount">{counts.all}</span>
                </button>
                <button
                  className={statusFilter === "review" ? "filterTab active" : "filterTab"}
                  onClick={() => setStatusFilter("review")}
                >
                  Needs Review <span className="tabCount review">{counts.review}</span>
                </button>
                <button
                  className={statusFilter === "active" ? "filterTab active" : "filterTab"}
                  onClick={() => setStatusFilter("active")}
                >
                  Active <span className="tabCount active">{counts.active}</span>
                </button>
                <button
                  className={statusFilter === "quiet" ? "filterTab active" : "filterTab"}
                  onClick={() => setStatusFilter("quiet")}
                >
                  Quiet <span className="tabCount quiet">{counts.quiet}</span>
                </button>
              </div>

              <div className="rightControls">
                <div className="selectWrapper">
                  <select
                    value={sortBy}
                    onChange={(e) => setSortBy(e.target.value as "updated" | "alphabetical" | "runs" | "queue")}
                    className="sortSelect"
                    aria-label="Sort policies by"
                  >
                    <option value="updated">Recently Updated</option>
                    <option value="alphabetical">Alphabetical (A-Z)</option>
                    <option value="runs">Most Runs</option>
                    <option value="queue">Most Decisions</option>
                  </select>
                </div>
              </div>
            </div>

            {/* Policies Container */}
            <div className="policiesContainer">
              {sortedPolicies.length > 0 ? (
                <div className="policiesTableWrapper">
                  <table className="policiesTable">
                    <thead>
                      <tr>
                        <th>Policy Name & Description</th>
                        <th>Status</th>
                        <th>Endpoint Path</th>
                        <th className="numCol">Open Reviews</th>
                        <th className="numCol">Total Runs</th>
                        <th>Last Updated</th>
                        <th style={{ textAlign: "right" }}>Actions</th>
                      </tr>
                    </thead>
                    <tbody>
                      {sortedPolicies.map((policy) => (
                        <PolicyTableRow
                          key={policy.id}
                          policy={policy}
                          onOpen={openPolicy}
                          onCopy={handleCopyEndpoint}
                          isCopied={copiedId === policy.id}
                        />
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="emptyState">
                  <svg className="emptyIcon" width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                    <circle cx="11" cy="11" r="8" />
                    <line x1="21" y1="21" x2="16.65" y2="16.65" />
                  </svg>
                  <h3>No policies matched your criteria</h3>
                  <p>Try clearing your search terms or choosing a different status filter.</p>
                  <button className="primary" onClick={() => { setSearchQuery(""); setStatusFilter("all"); }}>
                    Reset Filters
                  </button>
                </div>
              )}
            </div>
          </section>
          {createDrawer}
        </>
      ) : (
        <>
          <aside className="directory">
            <button className="backButton" onClick={() => setScreen("dashboard")}>
              Dashboard
            </button>
            <div className="policyTitle">
              <strong>{selectedPolicy.name}</strong>
              <small>{selectedPolicy.id}</small>
            </div>
            <nav>
              {(["overview", "policy", "principles", "endpoint", "queue", "runs"] as DirectorySection[]).map((item) => (
                <button
                  key={item}
                  className={section === item ? "active" : ""}
                  onClick={() => {
                    setSection(item);
                    setSelectedRunId(null);
                    setSelectedQueueItemId(null);
                  }}
                >
                  {sectionLabels[item]}
                  {item === "queue" && openQueue.length > 0 ? <span>{openQueue.length}</span> : null}
                </button>
              ))}
            </nav>
          </aside>

          <section className="mainPanel">
            <header className="pageHeader">
              <div>
                <h1>{selectedPolicy.name}</h1>
                <p>{selectedPolicy.description}</p>
              </div>
            </header>

            {section === "overview" && (
              <div className="overviewTabbedContainer">
                <div className="overviewTabBar">
                  <button
                    className={overviewTab === "queue" ? "overviewTabBtn active" : "overviewTabBtn"}
                    onClick={() => setOverviewTab("queue")}
                  >
                    Queue <span className="tabBadge">{openQueue.length}</span>
                  </button>
                  <button
                    className={overviewTab === "runs" ? "overviewTabBtn active" : "overviewTabBtn"}
                    onClick={() => setOverviewTab("runs")}
                  >
                    Run History <span className="tabBadge">{selectedPolicy.runs.length}</span>
                  </button>
                  <button
                    className={overviewTab === "policy" ? "overviewTabBtn active" : "overviewTabBtn"}
                    onClick={() => setOverviewTab("policy")}
                  >
                    Policy & Goal
                  </button>
                </div>

                <div className="overviewTabContent">
                  {overviewTab === "queue" && (
                    <section className="panel full">
                      <div className="panelTop">
                        <div>
                          <h2>Decision Queue</h2>
                          <p>{openQueue.length} open decisions require review</p>
                        </div>
                        <button onClick={() => refreshRuns()}>Refresh</button>
                      </div>
                      <QueueList
                        items={openQueue}
                        emptyText="No open decisions"
                        onOpen={(id) => setSelectedQueueItemId(id)}
                      />
                    </section>
                  )}

                  {overviewTab === "runs" && (
                    <section className="panel full">
                      <div className="panelTop">
                        <div>
                          <h2>Run History</h2>
                          <p>{selectedPolicy.runs.length} recorded runs</p>
                        </div>
                        <button onClick={() => refreshRuns()}>Refresh</button>
                      </div>
                      <RunList
                        runs={selectedPolicy.runs}
                        onOpen={(id) => setSelectedRunId(id)}
                      />
                    </section>
                  )}

                  {overviewTab === "policy" && (
                    <section className="panel full">
                      <div className="panelTop">
                        <div>
                          <h2>Policy & Goal</h2>
                          <p>{selectedPolicy.principles.length} operating principles active</p>
                        </div>
                      </div>
                      <div className="policyGoalContent">
                        <div className="policySectionBox">
                          <h3>Policy Text</h3>
                          <p className="longText">{selectedPolicy.policy}</p>
                        </div>
                        <div className="principlesSectionBox">
                          <h3>Operating Principles</h3>
                          <div className="principleList">
                            {selectedPolicy.principles.map((principle) => (
                              <article key={principle.id}>
                                <strong>{principle.title}</strong>
                                <p>{principle.body}</p>
                              </article>
                            ))}
                          </div>
                        </div>
                      </div>
                    </section>
                  )}
                </div>
              </div>
            )}

            {section === "policy" && (
              <section className="panel full">
                <div className="panelTop">
                  <div>
                    <h2>Policy</h2>
                    <p>Policy decision boundary</p>
                  </div>
                </div>
                <p className="longText">{selectedPolicy.policy}</p>
              </section>
            )}

            {section === "principles" && (
              <section className="panel full">
                <div className="panelTop">
                  <div>
                    <h2>Principles</h2>
                    <p>{selectedPolicy.principles.length} defined</p>
                  </div>
                </div>
                <div className="principleList">
                  {selectedPolicy.principles.map((principle) => (
                    <article key={principle.id}>
                      <strong>{principle.title}</strong>
                      <p>{principle.body}</p>
                    </article>
                  ))}
                </div>
              </section>
            )}

            {section === "endpoint" && (
              <section className="panel full endpointPanel">
                <div className="panelTop">
                  <div>
                    <h2>Endpoint Reference</h2>
                    <code>POST {publicAppUrl}{selectedPolicy.endpointPath}</code>
                  </div>
                </div>
                <pre>{`curl -X POST ${publicAppUrl}${selectedPolicy.endpointPath} \\
  -H "Content-Type: application/json" \\
  -d '{"action":"${endpointAction.replaceAll("'", "\\'")}"}'`}</pre>
                <div className="apiSchemaBox">
                  <h3>Payload Format</h3>
                  <pre>{`{\n  "action": "string (the natural language request to evaluate)"\n}`}</pre>
                </div>
                <div className="apiSchemaBox">
                  <h3>Self-Improvement Endpoint</h3>
                  <pre>{`curl -X POST ${publicAppUrl}/api/policies/${selectedPolicy.id}/queue/${openQueue[0]?.id ?? "{queueItemId}"}/improve`}</pre>
                </div>
              </section>
            )}

            {section === "queue" && (
              <section className="panel full">
                <div className="panelTop">
                  <div>
                    <h2>Decision Queue</h2>
                    <p>{openQueue.length} open decisions</p>
                  </div>
                  <button onClick={() => refreshRuns()}>Refresh</button>
                </div>
                <QueueList
                  items={selectedPolicy.decisionQueue}
                  emptyText="No decisions in queue"
                  onOpen={(id) => setSelectedQueueItemId(id)}
                />
              </section>
            )}

            {section === "runs" && (
              <section className="panel full">
                <div className="panelTop">
                  <div>
                    <h2>Run History</h2>
                    <p>{selectedPolicy.runs.length} recorded runs</p>
                  </div>
                  <button onClick={() => refreshRuns()}>Refresh</button>
                </div>
                <RunList runs={selectedPolicy.runs} onOpen={(id) => setSelectedRunId(id)} />
              </section>
            )}
          </section>

          <aside className="sidePanel">
            {renderSidePanel()}
          </aside>
        </>
      )}
    </main>
  );
}

interface PolicyItemProps {
  policy: Policy;
  onOpen: (id: string) => void;
  onCopy: (e: React.MouseEvent, id: string, endpoint: string) => void;
  isCopied: boolean;
}



function PolicyTableRow({ policy, onOpen, onCopy, isCopied }: PolicyItemProps) {
  const queueCount = openQueueCount(policy);
  const runsCount = policy.runs.length;

  let statusClass = "quiet";
  let statusText = "Quiet";
  if (queueCount > 0) {
    statusClass = "review";
    statusText = "Needs Review";
  } else if (runsCount > 0) {
    statusClass = "active";
    statusText = "Active";
  }

  return (
    <tr className="tableRow" onClick={() => onOpen(policy.id)}>
      <td>
        <div className="policyNameCol">
          <strong>{policy.name}</strong>
          <p className="policyDescTruncate">{policy.description}</p>
        </div>
      </td>
      <td>
        <span className={`statusIndicator ${statusClass} inline`}>
          <span className="dot"></span>
          {statusText}
        </span>
      </td>
      <td>
        <div className="endpointCol">
          <code className="endpointCode">{policy.endpointPath}</code>
          <button
            className={isCopied ? "copyIconBtn copied" : "copyIconBtn"}
            onClick={(e) => onCopy(e, policy.id, policy.endpointPath)}
            title="Copy Endpoint"
          >
            {isCopied ? (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3">
                <polyline points="20 6 9 17 4 12" />
              </svg>
            ) : (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
              </svg>
            )}
          </button>
        </div>
      </td>
      <td className="numCol">
        <span className={queueCount > 0 ? "reviewBadge active" : "reviewBadge"}>{queueCount}</span>
      </td>
      <td className="numCol">{runsCount}</td>
      <td>
        <span className="updatedTime">{formatTime(policy.updatedAt)}</span>
      </td>
      <td style={{ textAlign: "right" }}>
        <div className="tableActions">
          <button className="rowActionBtn" onClick={(e) => { e.stopPropagation(); onOpen(policy.id); }}>
            Configure
          </button>
        </div>
      </td>
    </tr>
  );
}

function RunList({ runs, onOpen }: { runs: DecisionRun[]; onOpen: (id: string) => void }) {
  if (runs.length === 0) {
    return <div className="empty">No runs yet</div>;
  }

  return (
    <div className="runList">
      {runs.map((run) => (
        <button key={run.id} className="runRow" onClick={() => onOpen(run.id)}>
          <span className={decisionClass(run.decision)}>{run.decision}</span>
          <span>{run.action}</span>
          <small>{formatTime(run.createdAt)}</small>
        </button>
      ))}
    </div>
  );
}

function QueueList({
  items,
  emptyText,
  onOpen
}: {
  items: DecisionQueueItem[];
  emptyText: string;
  onOpen: (id: string) => void;
}) {
  if (items.length === 0) {
    return <div className="empty">{emptyText}</div>;
  }

  return (
    <div className="queueList">
      {items.map((item) => (
        <button key={item.id} className="queueRow" onClick={() => onOpen(item.id)}>
          <span className="badge wait">{item.status}</span>
          <span>{item.action}</span>
          <small>{item.gapType.replace("_", " ")}</small>
        </button>
      ))}
    </div>
  );
}

function RunDetail({ run }: { run: DecisionRun }) {
  return (
    <div className="drawerBody">
      <span className={decisionClass(run.decision)}>{run.decision}</span>
      <label>
        Action
        <textarea value={run.action} readOnly />
      </label>
      <dl>
        <div>
          <dt>Confidence</dt>
          <dd>{Math.round(run.confidence * 100)}%</dd>
        </div>
        <div>
          <dt>Source</dt>
          <dd>{run.source}</dd>
        </div>
        <div>
          <dt>Matched</dt>
          <dd>{run.matchedPolicy.join(", ") || "none"}</dd>
        </div>
        <div>
          <dt>Missing</dt>
          <dd>{run.missingContext.join(", ") || "none"}</dd>
        </div>
      </dl>
      <p>{run.rationale}</p>
    </div>
  );
}

function QueueDetail({
  item,
  onApprove,
  onReject,
  onImprove,
  isImproving
}: {
  item: DecisionQueueItem;
  onApprove: (id: string) => void;
  onReject: (id: string) => void;
  onImprove: (id: string) => void;
  isImproving: boolean;
}) {
  const proposal = item.proposedChange;

  return (
    <div className="drawerBody">
      <span className="badge wait">{item.status}</span>
      <label>
        Action
        <textarea value={item.action} readOnly />
      </label>
      <p>{item.rationale}</p>
      <div className="diffBlock">
        <strong>{proposal.title}</strong>
        {proposal.summary ? <p className="agentSummary">{proposal.summary}</p> : null}
        <pre className="before">{proposal.before}</pre>
        <pre className="after">{proposal.after}</pre>
      </div>
      {proposal.agentProvider ? (
        <div className="agentProposalBlock">
          <dl>
            <div>
              <dt>Agent</dt>
              <dd>{proposal.agentProvider} / {proposal.agentId}</dd>
            </div>
            {typeof proposal.confidence === "number" ? (
              <div>
                <dt>Confidence</dt>
                <dd>{Math.round(proposal.confidence * 100)}%</dd>
              </div>
            ) : null}
            {proposal.interactionId ? (
              <div>
                <dt>Interaction</dt>
                <dd>{proposal.interactionId}</dd>
              </div>
            ) : null}
          </dl>
          {proposal.rationale ? <p>{proposal.rationale}</p> : null}
          {proposal.expectedBehavior && proposal.expectedBehavior.length > 0 ? (
            <div className="agentCheckList">
              <strong>Expected behavior</strong>
              {proposal.expectedBehavior.map((expected, index) => (
                <div key={`${expected.expectedDecision}-${index}`}>
                  <span className={decisionClass(expected.expectedDecision)}>{expected.expectedDecision}</span>
                  <p>{expected.action}</p>
                  <small>{expected.reason}</small>
                </div>
              ))}
            </div>
          ) : null}
          {proposal.risks && proposal.risks.length > 0 ? (
            <div className="agentRisks">
              <strong>Risks</strong>
              <ul>
                {proposal.risks.map((risk) => (
                  <li key={risk}>{risk}</li>
                ))}
              </ul>
            </div>
          ) : null}
          {proposal.validatorErrors && proposal.validatorErrors.length > 0 ? (
            <div className="agentRisks">
              <strong>Validation notes</strong>
              <ul>
                {proposal.validatorErrors.map((error) => (
                  <li key={error}>{error}</li>
                ))}
              </ul>
            </div>
          ) : null}
        </div>
      ) : null}
      <div className="drawerActions">
        <button disabled={item.status !== "open" || isImproving} onClick={() => onImprove(item.id)}>
          {isImproving ? "Drafting..." : "Draft with agent"}
        </button>
        <button className="primary" disabled={item.status !== "open"} onClick={() => onApprove(item.id)}>
          Approve
        </button>
        <button disabled={item.status !== "open"} onClick={() => onReject(item.id)}>
          Reject
        </button>
      </div>
    </div>
  );
}

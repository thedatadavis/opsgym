import type { Policy } from "./types";

const createdAt = "2026-06-20T00:00:00.000Z";
const now = "2026-06-28T08:00:00.000Z";

// Base Seed Policy: Refund Policy
export const seedPolicy: Policy = {
  id: "refund-policy",
  name: "Refund Policy",
  description: "Decide whether refund actions should pass, fail, or wait for review.",
  policy:
    "Pass refunds for delivered orders inside 30 days when the item arrived damaged, was not as described, was the wrong item, or the customer was charged twice.\n\nFail refunds for final-sale items, suspected fraud or abuse, consumed digital goods, or orders older than 90 days.\n\nWait on VIP or hardship refunds outside 30 days but inside 90 days unless an approved exception explicitly covers the case.",
  principles: [
    {
      id: "principle-trust",
      title: "Protect customer trust",
      body: "Favor clear, reversible customer outcomes when the facts support eligibility. Do not invent missing facts."
    },
    {
      id: "principle-boundary",
      title: "Preserve refund boundaries",
      body: "Refunds must respect final sale, abuse, fraud, and account-risk boundaries even when a customer is upset."
    }
  ],
  endpointPath: "/api/policies/refund-policy/decision",
  runs: [
    {
      id: "run-refund-1",
      policyId: "refund-policy",
      action: "Refund a VIP customer's damaged order from 45 days ago without manager approval.",
      decision: "wait",
      matchedPolicy: ["policy"],
      rationale: "VIP or hardship refund outside 30 days is an exception path that requires stronger policy coverage.",
      confidence: 0.55,
      missingContext: ["manager approval"],
      gapType: "ambiguous_exception",
      source: "ui",
      createdAt: "2026-06-28T07:45:00.000Z",
      queueItemId: "queue-refund-1"
    },
    {
      id: "run-refund-2",
      policyId: "refund-policy",
      action: "Refund for delivered damaged order, purchased 12 days ago.",
      decision: "pass",
      matchedPolicy: ["policy", "Protect customer trust"],
      rationale: "The refund is inside the standard window and matches a covered item-quality reason.",
      confidence: 0.91,
      missingContext: [],
      source: "api",
      createdAt: "2026-06-27T18:30:00.000Z"
    },
    {
      id: "run-refund-3",
      policyId: "refund-policy",
      action: "Refund for final-sale VIP ticket purchased 2 days ago.",
      decision: "fail",
      matchedPolicy: ["policy", "Preserve refund boundaries"],
      rationale: "The action hits a hard denial boundary: final sale.",
      confidence: 0.95,
      missingContext: [],
      source: "api",
      createdAt: "2026-06-26T14:20:00.000Z"
    }
  ],
  decisionQueue: [
    {
      id: "queue-refund-1",
      policyId: "refund-policy",
      runId: "run-refund-1",
      action: "Refund a VIP customer's damaged order from 45 days ago without manager approval.",
      gapType: "ambiguous_exception",
      missingContext: ["manager approval"],
      rationale: "VIP or hardship refund outside 30 days is an exception path that requires stronger policy coverage.",
      status: "open",
      createdAt: "2026-06-28T07:45:00.000Z",
      proposedChange: {
        id: "change-refund-1",
        queueItemId: "queue-refund-1",
        title: "Harden VIP refund exception",
        before: "VIP or hardship refunds outside 30 days but inside 90 days remain Wait unless an exception is explicit.",
        after: "Pass VIP or hardship refunds for damaged, wrong, defective, or not-as-described orders outside 30 days but inside 90 days when manager approval is present. Fail when manager approval is missing. Source gap: ambiguous exception.",
        status: "pending",
        createdAt: "2026-06-28T07:45:00.000Z"
      }
    }
  ],
  createdAt,
  updatedAt: now
};

// 14 More Policies to make dozens of policies
export const seedPolicies: Policy[] = [
  seedPolicy,
  {
    id: "sla-compensation",
    name: "SLA Breach Compensation",
    description: "Approve payouts and credits when service level agreements are breached.",
    policy:
      "Pass SLA compensations up to $500 in service credits for tier-1 enterprises when system availability drops below 99.9% in a billing cycle.\n\nFail payouts in cash unless explicitly contractually bound. Fail compensations for clients under trial or free tiers.\n\nWait on compensation requests exceeding $500 or for customers with active contract negotiations.",
    principles: [
      {
        id: "principle-sla-1",
        title: "Contractual compliance",
        body: "Ensure compensation matches defined contract terms. Do not exceed authorized credit limits."
      },
      {
        id: "principle-sla-2",
        title: "Protect financial margin",
        body: "Prevent double-compensations and verify system monitoring data before processing credit."
      }
    ],
    endpointPath: "/api/policies/sla-compensation/decision",
    runs: [
      {
        id: "run-sla-1",
        policyId: "sla-compensation",
        action: "Approve SLA compensation of $1200 service credits for Enterprise Client XYZ due to 4-hour outage.",
        decision: "wait",
        matchedPolicy: ["policy"],
        rationale: "Requested credit compensation ($1200) exceeds the maximum auto-approval threshold of $500.",
        confidence: 0.6,
        missingContext: ["VP of Finance approval"],
        gapType: "permission_gap",
        source: "api",
        createdAt: "2026-06-28T06:12:00.000Z",
        queueItemId: "queue-sla-1"
      },
      {
        id: "run-sla-2",
        policyId: "sla-compensation",
        action: "SLA breach payout of $250 credit for Gold Customer ABC, monthly uptime 99.8%.",
        decision: "pass",
        matchedPolicy: ["policy", "Contractual compliance"],
        rationale: "Under standard SLA terms, 99.8% uptime is below the 99.9% tier-1 threshold, credit is under $500 limit.",
        confidence: 0.94,
        missingContext: [],
        source: "api",
        createdAt: "2026-06-27T11:05:00.000Z"
      }
    ],
    decisionQueue: [
      {
        id: "queue-sla-1",
        policyId: "sla-compensation",
        runId: "run-sla-1",
        action: "Approve SLA compensation of $1200 service credits for Enterprise Client XYZ due to 4-hour outage.",
        gapType: "permission_gap",
        missingContext: ["VP of Finance approval"],
        rationale: "Requested credit compensation ($1200) exceeds the maximum auto-approval threshold of $500.",
        status: "open",
        createdAt: "2026-06-28T06:12:00.000Z",
        proposedChange: {
          id: "change-sla-1",
          queueItemId: "queue-sla-1",
          title: "Extend SLA Credit Threshold",
          before: "Pass SLA compensations up to $500 in service credits for tier-1 enterprises.",
          after: "Pass SLA compensations up to $1500 in service credits for Global Platinum Tier-1 partners with account manager co-sign. Source gap: permission gap.",
          status: "pending",
          createdAt: "2026-06-28T06:12:00.000Z"
        }
      }
    ],
    createdAt,
    updatedAt: now
  },
  {
    id: "account-suspension",
    name: "Account Suspension Escalation",
    description: "Decide whether an account should be suspended for suspicious login activity or security alerts.",
    policy:
      "Pass immediate suspensions when concurrent login locations differ by more than 5,000 miles within 1 hour, or if API keys are leaked in public GitHub repositories.\n\nFail suspensions for accounts with a valid VIP support exception, unless active data egress is detected.\n\nWait on security alerts for accounts with minor brute-force patterns but no successful logins.",
    principles: [
      {
        id: "principle-susp-1",
        title: "Fail-safe security",
        body: "Prefer rapid containment of suspected credentials over account uptime when leakage is highly probable."
      },
      {
        id: "principle-susp-2",
        title: "Minimize customer disruption",
        body: "Avoid lockouts on false positives by verifying authentication factors before escalating to full lockout."
      }
    ],
    endpointPath: "/api/policies/account-suspension/decision",
    runs: [
      {
        id: "run-susp-1",
        policyId: "account-suspension",
        action: "Escalate API credential lockout for VIP partner account with concurrent logins in New York and Singapore.",
        decision: "wait",
        matchedPolicy: ["policy"],
        rationale: "Concurrent login mismatch exceeds threshold, but account has active VIP bypass policy.",
        confidence: 0.72,
        missingContext: ["secondary verification status"],
        gapType: "logic_gap",
        source: "api",
        createdAt: "2026-06-28T05:30:00.000Z",
        queueItemId: "queue-susp-1"
      }
    ],
    decisionQueue: [
      {
        id: "queue-susp-1",
        policyId: "account-suspension",
        runId: "run-susp-1",
        action: "Escalate API credential lockout for VIP partner account with concurrent logins in New York and Singapore.",
        gapType: "logic_gap",
        missingContext: ["secondary verification status"],
        rationale: "Concurrent login mismatch exceeds threshold, but account has active VIP bypass policy.",
        status: "open",
        createdAt: "2026-06-28T05:30:00.000Z",
        proposedChange: {
          id: "change-susp-1",
          queueItemId: "queue-susp-1",
          title: "Resolve VIP Bypass Lockout Loophole",
          before: "Fail suspensions for accounts with a valid VIP support exception, unless active data egress is detected.",
          after: "Fail suspensions for accounts with a VIP exception unless active data egress OR simultaneous geographically impossible logins (speed > 500mph) occur. Source gap: logic gap.",
          status: "pending",
          createdAt: "2026-06-28T05:30:00.000Z"
        }
      }
    ],
    createdAt,
    updatedAt: now
  },
  {
    id: "subscription-cancel-save",
    name: "Subscription Cancellation Save",
    description: "Decide whether to offer subscription cancellation retention plans, free trials, or process standard churn.",
    policy:
      "Pass retention offers (e.g. 50% off for 3 months) for users with tenure > 6 months expressing intent to cancel due to price.\n\nFail retention offers for accounts that have already received a discount in the last 12 months, or accounts with active unpaid invoices.\n\nWait when cancellation is requested due to technical bugs or missing features.",
    principles: [
      {
        id: "principle-sub-1",
        title: "Maximize Customer Lifetime Value",
        body: "Offer targeted discounts to viable accounts while preventing serial discount hopping."
      }
    ],
    endpointPath: "/api/policies/subscription-cancel-save/decision",
    runs: [
      {
        id: "run-sub-1",
        policyId: "subscription-cancel-save",
        action: "Customer wants to cancel subscription because the database integration is buggy.",
        decision: "wait",
        matchedPolicy: ["policy"],
        rationale: "Cancellation is due to technical bugs, which requires support routing instead of a discount code.",
        confidence: 0.65,
        missingContext: ["active integration logs"],
        gapType: "missing_context",
        source: "ui",
        createdAt: "2026-06-28T03:15:00.000Z",
        queueItemId: "queue-sub-1"
      }
    ],
    decisionQueue: [
      {
        id: "queue-sub-1",
        policyId: "subscription-cancel-save",
        runId: "run-sub-1",
        action: "Customer wants to cancel subscription because the database integration is buggy.",
        gapType: "missing_context",
        missingContext: ["active integration logs"],
        rationale: "Cancellation is due to technical bugs, which requires support routing instead of a discount code.",
        status: "open",
        createdAt: "2026-06-28T03:15:00.000Z",
        proposedChange: {
          id: "change-sub-1",
          queueItemId: "queue-sub-1",
          title: "Handle Bug-related Cancellation Saves",
          before: "Wait when cancellation is requested due to technical bugs or missing features.",
          after: "Route cancellation requests citing technical bugs to a Senior Integration Engineer immediately. If unresolved in 48 hours, auto-grant 1 month free. Source gap: missing context.",
          status: "pending",
          createdAt: "2026-06-28T03:15:00.000Z"
        }
      }
    ],
    createdAt,
    updatedAt: now
  },
  {
    id: "api-rate-limit-override",
    name: "API Rate Limit Override",
    description: "Approve temporary API rate-limit increases for VIP clients or system testing.",
    policy:
      "Pass temporary rate limit increases of up to 3x standard limit for up to 72 hours for Enterprise Tier accounts with valid justification.\n\nFail requests from Free/Standard accounts, or requests that exceed 50,000 requests per minute.\n\nWait on requests that require permanent overrides or cluster expansions.",
    principles: [
      {
        id: "principle-rate-1",
        title: "Maintain cluster health",
        body: "Do not approve overrides that push service clusters past 80% peak capacity."
      }
    ],
    endpointPath: "/api/policies/api-rate-limit-override/decision",
    runs: [
      {
        id: "run-rate-1",
        policyId: "api-rate-limit-override",
        action: "Request rate limit increase to 20,000 req/min for 24 hours from developer account during app launch.",
        decision: "pass",
        matchedPolicy: ["policy"],
        rationale: "Temporary limit increase is under 50k threshold and requested by a qualified developer team.",
        confidence: 0.88,
        missingContext: [],
        source: "api",
        createdAt: "2026-06-27T10:00:00.000Z"
      }
    ],
    decisionQueue: [],
    createdAt,
    updatedAt: now
  },
  {
    id: "hardware-warranty-claims",
    name: "Hardware Warranty Claims",
    description: "Evaluate return requests and hardware replacements for device defects.",
    policy:
      "Pass replacements for smart-hub models under 1-year warranty when diagnostic reports show hardware-level failure codes.\n\nFail warranty claims where water damage or physical drop marks are noted in inspection.\n\nWait on warranty claims for out-of-warranty hardware showing firmware corruption.",
    principles: [
      {
        id: "principle-hard-1",
        title: "Diagnostic Integrity",
        body: "Confirm device telemetry logs align with user-reported symptoms before issuing return shipping label."
      }
    ],
    endpointPath: "/api/policies/hardware-warranty-claims/decision",
    runs: [
      {
        id: "run-hard-1",
        policyId: "hardware-warranty-claims",
        action: "Smart-hub hub replacement request, purchased 14 months ago, diagnostic shows boot loop.",
        decision: "wait",
        matchedPolicy: ["policy"],
        rationale: "Device is out of the 1-year warranty standard window but diagnostics point to firmware corruption.",
        confidence: 0.51,
        missingContext: ["device purchase details"],
        gapType: "policy_gap",
        source: "api",
        createdAt: "2026-06-26T09:20:00.000Z",
        queueItemId: "queue-hard-1"
      }
    ],
    decisionQueue: [
      {
        id: "queue-hard-1",
        policyId: "hardware-warranty-claims",
        runId: "run-hard-1",
        action: "Smart-hub hub replacement request, purchased 14 months ago, diagnostic shows boot loop.",
        gapType: "policy_gap",
        missingContext: ["device purchase details"],
        rationale: "Device is out of the 1-year warranty standard window but diagnostics point to firmware corruption.",
        status: "open",
        createdAt: "2026-06-26T09:20:00.000Z",
        proposedChange: {
          id: "change-hard-1",
          queueItemId: "queue-hard-1",
          title: "Extend firmware bootloop exception",
          before: "Wait on warranty claims for out-of-warranty hardware showing firmware corruption.",
          after: "Pass warranty claims for hardware up to 18 months old if diagnostics confirm firmware boot loop caused by automatic update push. Source gap: policy gap.",
          status: "pending",
          createdAt: "2026-06-26T09:20:00.000Z"
        }
      }
    ],
    createdAt,
    updatedAt: now
  },
  {
    id: "credit-limit-extension",
    name: "Credit Limit Extension",
    description: "Assess business requests for short-term credit line extensions.",
    policy:
      "Pass credit extensions up to 25% of existing limit for accounts with 100% on-time payment history over 12 consecutive months.\n\nFail requests if credit utilization is currently above 95% or if the account has outstanding disputes.\n\nWait on requests for extensions over $50,000 or for accounts under 6 months old.",
    principles: [
      {
        id: "principle-credit-1",
        title: "Debt Risk Mitigation",
        body: "Prevent credit creep by verifying the client's current accounts receivable status before increasing limits."
      }
    ],
    endpointPath: "/api/policies/credit-limit-extension/decision",
    runs: [],
    decisionQueue: [],
    createdAt,
    updatedAt: now
  },
  {
    id: "high-value-fraud-check",
    name: "High-Value Fraud Check",
    description: "Analyze transactions with high fraud indicator scores to approve, decline, or hold.",
    policy:
      "Pass high-value transactions (> $1,000) only when shipping and billing addresses match, and 3D Secure verification succeeds.\n\nFail transactions where IP geolocation differs by > 3 countries from card-issuing country, or when card is flagged in global chargeback lists.\n\nWait on transactions with mismatched addresses but active 3D Secure passes.",
    principles: [
      {
        id: "principle-fraud-1",
        title: "Prevent Chargebacks",
        body: "Prioritize fraud detection over convenience for transactions exceeding $1,000."
      }
    ],
    endpointPath: "/api/policies/high-value-fraud-check/decision",
    runs: [
      {
        id: "run-fraud-1",
        policyId: "high-value-fraud-check",
        action: "Process purchase of $1,800 server hardware, card issued in US, purchase made from IP in France, shipping to US billing address.",
        decision: "wait",
        matchedPolicy: ["policy"],
        rationale: "France IP address is an international mismatch, but card is shipped to a valid US billing address with 3DS validation.",
        confidence: 0.58,
        missingContext: ["billing match confirmation"],
        gapType: "ambiguous_exception",
        source: "api",
        createdAt: "2026-06-28T01:10:00.000Z",
        queueItemId: "queue-fraud-1"
      }
    ],
    decisionQueue: [
      {
        id: "queue-fraud-1",
        policyId: "high-value-fraud-check",
        runId: "run-fraud-1",
        action: "Process purchase of $1,800 server hardware, card issued in US, purchase made from IP in France, shipping to US billing address.",
        gapType: "ambiguous_exception",
        missingContext: ["billing match confirmation"],
        rationale: "France IP address is an international mismatch, but card is shipped to a valid US billing address with 3DS validation.",
        status: "open",
        createdAt: "2026-06-28T01:10:00.000Z",
        proposedChange: {
          id: "change-fraud-1",
          queueItemId: "queue-fraud-1",
          title: "Harden international transit exception",
          before: "Wait on transactions with mismatched addresses but active 3D Secure passes.",
          after: "Pass high-value transactions with IP mismatch when 3D Secure passes and shipping matches billing, unless the IP is flagged on an active VPN exit node directory. Source gap: ambiguous exception.",
          status: "pending",
          createdAt: "2026-06-28T01:10:00.000Z"
        }
      }
    ],
    createdAt,
    updatedAt: now
  },
  {
    id: "beta-enrollment",
    name: "Beta Access Enrollment",
    description: "Approve application accounts for advanced closed developer beta features.",
    policy:
      "Pass developer accounts with active API usage > 10,000 req/month and a github account linked over 3 months ago.\n\nFail requests from anonymous email domains (e.g. mailinator, tempmail) or accounts with policy violation records.\n\nWait on requests from standard tier developers expressing custom enterprise requirements.",
    principles: [
      {
        id: "principle-beta-1",
        title: "Developer Quality",
        body: "Enroll active developers who can provide structured feedback and file actionable bug reports."
      }
    ],
    endpointPath: "/api/policies/beta-enrollment/decision",
    runs: [
      {
        id: "run-beta-1",
        policyId: "beta-enrollment",
        action: "Enroll developer account with active usage 2,500 req/month requesting database clustering beta access.",
        decision: "wait",
        matchedPolicy: ["policy"],
        rationale: "Developer has active API usage but it is below the 10,000 req/month auto-pass limit.",
        confidence: 0.67,
        missingContext: ["developer github link details"],
        gapType: "policy_gap",
        source: "ui",
        createdAt: "2026-06-27T15:22:00.000Z",
        queueItemId: "queue-beta-1"
      }
    ],
    decisionQueue: [
      {
        id: "queue-beta-1",
        policyId: "beta-enrollment",
        runId: "run-beta-1",
        action: "Enroll developer account with active usage 2,500 req/month requesting database clustering beta access.",
        gapType: "policy_gap",
        missingContext: ["developer github link details"],
        rationale: "Developer has active API usage but it is below the 10,000 req/month auto-pass limit.",
        status: "open",
        createdAt: "2026-06-27T15:22:00.000Z",
        proposedChange: {
          id: "change-beta-1",
          queueItemId: "queue-beta-1",
          title: "Lower Beta Threshold for Active Devs",
          before: "Pass developer accounts with active API usage > 10,000 req/month and a github account linked over 3 months ago.",
          after: "Pass developer accounts with active API usage > 2,000 req/month if they have an active paid subscription tier and zero rate-limit events. Source gap: policy gap.",
          status: "pending",
          createdAt: "2026-06-27T15:22:00.000Z"
        }
      }
    ],
    createdAt,
    updatedAt: now
  },
  {
    id: "gdpr-erasure-validation",
    name: "GDPR Data Erasure Validation",
    description: "Validate deletion requests to comply with legal erasure standards.",
    policy:
      "Pass standard user accounts for automatic erasure when no active balances, unpaid charges, or pending chargebacks exist.\n\nFail erasure requests for accounts under active anti-fraud or financial crime holds.\n\nWait on requests for accounts with historical corporate invoice contracts or active legal holds.",
    principles: [
      {
        id: "principle-gdpr-1",
        title: "Compliance execution",
        body: "Execute erasures cleanly to protect user privacy without violating corporate financial reporting holds."
      }
    ],
    endpointPath: "/api/policies/gdpr-erasure-validation/decision",
    runs: [],
    decisionQueue: [],
    createdAt,
    updatedAt: now
  },
  {
    id: "content-moderation",
    name: "Content Moderation Flags",
    description: "Flag user content violating community guidelines or copyright requirements.",
    policy:
      "Pass content flagging immediately for text strings containing verified credit card numbers or severe hate speech patterns.\n\nFail flagging requests for standard political satire or constructive criticism.\n\nWait on flags targeting controversial images without metadata verification.",
    principles: [
      {
        id: "principle-mod-1",
        title: "Free Speech vs Safety",
        body: "Balance safety constraints with expressive freedom. Default to tag-and-monitor rather than blocking when ambiguous."
      }
    ],
    endpointPath: "/api/policies/content-moderation/decision",
    runs: [
      {
        id: "run-mod-1",
        policyId: "content-moderation",
        action: "Flag forum post uploading credit card details in plain text.",
        decision: "pass",
        matchedPolicy: ["policy", "Free Speech vs Safety"],
        rationale: "Plain text credit card numbers constitute high-risk PII exposure; instant flag is mandated.",
        confidence: 0.98,
        missingContext: [],
        source: "api",
        createdAt: "2026-06-28T00:05:00.000Z"
      }
    ],
    decisionQueue: [],
    createdAt,
    updatedAt: now
  },
  {
    id: "chargeback-dispute-mitigation",
    name: "Chargeback Dispute Mitigation",
    description: "Decide whether to dispute or accept credit card chargebacks.",
    policy:
      "Pass automatic disputes when delivery logs confirm order receipt at customer coordinates with signature.\n\nFail dispute (accept chargeback) for orders where shipment was delayed > 30 days past initial delivery SLA.\n\nWait on disputes exceeding $250 with tracking links but no delivery signature.",
    principles: [
      {
        id: "principle-charge-1",
        title: "Protect Merchant Reputation",
        body: "Prioritize evidence-backed disputes. Avoid disputing chargebacks where operational delay is confirmed."
      }
    ],
    endpointPath: "/api/policies/chargeback-dispute-mitigation/decision",
    runs: [
      {
        id: "run-charge-1",
        policyId: "chargeback-dispute-mitigation",
        action: "Dispute chargeback of $310, shipped via FedEx, tracking shows delivered on porch, no signature.",
        decision: "wait",
        matchedPolicy: ["policy"],
        rationale: "Chargeback value ($310) exceeds standard signature-exempt threshold ($250).",
        confidence: 0.61,
        missingContext: ["delivery coordinates"],
        gapType: "policy_gap",
        source: "api",
        createdAt: "2026-06-27T08:00:00.000Z",
        queueItemId: "queue-charge-1"
      }
    ],
    decisionQueue: [
      {
        id: "queue-charge-1",
        policyId: "chargeback-dispute-mitigation",
        runId: "run-charge-1",
        action: "Dispute chargeback of $310, shipped via FedEx, tracking shows delivered on porch, no signature.",
        gapType: "policy_gap",
        missingContext: ["delivery coordinates"],
        rationale: "Chargeback value ($310) exceeds standard signature-exempt threshold ($250).",
        status: "open",
        createdAt: "2026-06-27T08:00:00.000Z",
        proposedChange: {
          id: "change-charge-1",
          queueItemId: "queue-charge-1",
          title: "Raise signature-exempt dispute threshold",
          before: "Wait on disputes exceeding $250 with tracking links but no delivery signature.",
          after: "Wait on disputes exceeding $500 with tracking links but no delivery signature. Pass disputes under $500 when carrier photo verification is present. Source gap: policy gap.",
          status: "pending",
          createdAt: "2026-06-27T08:00:00.000Z"
        }
      }
    ],
    createdAt,
    updatedAt: now
  },
  {
    id: "vip-routing-escalation",
    name: "VIP Support Routing",
    description: "Determine support queues for high-priority user tickets.",
    policy:
      "Pass tickets directly to Tier-3 engineers if customer tier is Platinum and ticket details mention production system down.\n\nFail premium routing if account has past-due invoices older than 60 days.\n\nWait on accounts with Gold Tier requesting escalation for non-blocking configuration questions.",
    principles: [
      {
        id: "principle-route-1",
        title: "Maximize SLA adherence",
        body: "Route enterprise outages instantly to prevent contractual SLA breaches."
      }
    ],
    endpointPath: "/api/policies/vip-routing-escalation/decision",
    runs: [],
    decisionQueue: [],
    createdAt,
    updatedAt: now
  },
  {
    id: "referral-reward-verification",
    name: "Referral Reward Verification",
    description: "Validate referral bonuses to prevent abuse or gaming of reward programs.",
    policy:
      "Pass referral rewards of standard $25 credits when the referred account has completed verification and spent > $50.\n\nFail rewards for referrals sharing IP addresses, credit cards, or devices with the referrer.\n\nWait on accounts that refer > 10 users in a single week.",
    principles: [
      {
        id: "principle-ref-1",
        title: "Prevent referral sybils",
        body: "Verify unique payment and device configurations to block automated user creation."
      }
    ],
    endpointPath: "/api/policies/referral-reward-verification/decision",
    runs: [],
    decisionQueue: [],
    createdAt,
    updatedAt: now
  },
  {
    id: "partner-reseller-validation",
    name: "Partner Reseller Validation",
    description: "Verify resale certificates and tax IDs for corporate reseller accounts.",
    policy:
      "Pass reseller status requests when Tax ID matches national corporate records database and resale certificate is valid.\n\nFail requests with invalid tax certificates or business registration in blacklisted jurisdictions.\n\nWait on requests with spelling mismatches between taxi registry and account name.",
    principles: [
      {
        id: "principle-partner-1",
        title: "Verify corporate standing",
        body: "Ensure all reseller applications match validated state business registration data."
      }
    ],
    endpointPath: "/api/policies/partner-reseller-validation/decision",
    runs: [],
    decisionQueue: [],
    createdAt,
    updatedAt: now
  }
];

export function cloneSeedPolicy(): Policy {
  return JSON.parse(JSON.stringify(seedPolicy)) as Policy;
}

export function cloneSeedPolicies(): Policy[] {
  return JSON.parse(JSON.stringify(seedPolicies)) as Policy[];
}

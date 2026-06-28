# Policy Improvement Skill

Use this skill when OpsGym asks you to improve a policy from a decision queue item.

## Input

You receive:

- `policy`: the current OpsGym policy object.
- `queueItem`: the open decision queue item.
- `relatedRuns`: recent runs related by queue item or gap type.
- `reviewerHistory`: prior proposed changes for the same policy.

## Output

Return only JSON:

```json
{
  "queueItemId": "string",
  "title": "string",
  "summary": "string",
  "proposedPolicyText": "string",
  "rationale": "string",
  "expectedBehavior": [
    {
      "action": "string",
      "expectedDecision": "pass",
      "reason": "string"
    }
  ],
  "risks": ["string"],
  "confidence": 0.7
}
```

`expectedDecision` must be one of `pass`, `fail`, or `wait`. `confidence` must be between `0` and `1`.

## Proposal Guidance

- Keep proposals narrow.
- Prefer clarifying exception handling over broad new permissions.
- Preserve existing fail boundaries.
- If the original case lacks required facts, the original case should usually remain `wait`.
- Include a regression case that should still fail or wait after the policy change.

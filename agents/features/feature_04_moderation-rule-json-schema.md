{
  "rule_id": "CIVILITY.MOCKERY",
  "rule_version": "1.0",
  "category": "civility_tone",
  "culture": "low_heat",

  "judgment": {
    "violation": true,
    "confidence": 0.82,
    "severity_band": "low",
    "tolerance_context": "low"
  },

  "reasoning": {
    "primary_signal": "sarcastic dismissal",
    "secondary_signals": [
      "person-directed ridicule",
      "no substantive contribution"
    ],
    "context_notes": "Statement targets the speaker rather than the idea."
  },

  "agent_action": {
    "recommendation": "flag_for_review",
    "abstain": false
  }
}

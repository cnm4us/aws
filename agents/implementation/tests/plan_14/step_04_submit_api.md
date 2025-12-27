# Step 04 — API: submit report for a publication

Date: 2025-12-27

Goal:
- Add an authenticated endpoint to submit a single-rule report:
  - `POST /api/publications/:id/report` with `{ "ruleId": <number> }`

Notes:
- Logged via `scripts/auth_curl.sh` (Set-Cookie values are redacted by the script).


### 2025-12-27T22:36:01+00:00
- Profile: `super`
- Request: `POST http://localhost:3300/api/publications/148/report`
- Status: `200`
```
{"ok":true,"reportId":1}
```

### 2025-12-27T22:36:06+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/publications/148/reporting/options`
- Status: `200`
```
{"spacePublicationId":148,"spaceId":29,"reportedByMe":true,"categories":[{"id":2,"name":"Privacy & Identity Abuse","rules":[{"id":14,"slug":"doxxing","title":"Doxxing","shortDescription":"Sharing or enabling the discovery of someone’s real-world identifying information without their consent."},{"id":15,"slug":"impersonation","title":"Impersonation","shortDescription":"Pretending to be another person or entity in a way that misleads others about identity or authority."},{"id":13,"slug":"non-consensual-exposure-personal-information","title":"Non-Consensual Exposure of Personal Information","shortDescription":"Sharing or publishing someone’s private or sensitive personal information without their consent."}]},{"id":3,"name":"Safety & Severe Harm","rules":[{"id":17,"slug":"incitement-of-harm","title":"Incitement or endorsement of harm","shortDescription":"Encouraging, praising, or justifying physical harm or violence against people, groups, or locations."},{"id":18,"slug":"terrorism","title":"Terrorism or Mass-Casualty Advocacy","shortDescription":"Promoting, praising, or encouraging acts intended to cause mass casualties or terrorize populations."},{"id":16,"slug":"threats-of-violence","title":"Threats of Violence","shortDescription":"Expressing an intent to cause physical harm to a person, group, or location."}]},{"id":4,"name":"Sexual Exploitation","rules":[{"id":19,"slug":"sexual-exploitation-minors","title":"Minors","shortDescription":"Sexual exploitation of minors involves any sexual content, interaction, or conduct that targets, involves, or uses a minor in a sexualized way, regardless of intent or perceived consent."},{"id":20,"slug":"non-consensual-sexual-content","title":"Non-consensual Sexual Content","shortDescription":"Non-consensual sexual content involves creating, sharing, or threatening to share sexualized material involving a person without their clear and meaningful consent."},{"id":21,"slug":"trafficking-coercion","title":"Trafficking or Coercion","shortDescription":"Trafficking or coercion involves using force, threats, manipulation, or dependency to compel sexual activity, sexual content, or sexual access against a person’s will."}]}]}
```

### 2025-12-27T22:36:10+00:00
- Profile: `super`
- Request: `POST http://localhost:3300/api/publications/148/report`
- Status: `409`
```
{"error":"already_reported","detail":"already_reported"}
```

### 2025-12-27T23:01:08+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/api/publications/148/reporting/options`
- Status: `200`
```
{"spacePublicationId":148,"spaceId":29,"reportedByMe":true,"myReport":{"ruleId":14,"ruleSlug":"doxxing","ruleTitle":"Doxxing","createdAt":"2025-12-27 22:36:01"},"categories":[{"id":2,"name":"Privacy & Identity Abuse","rules":[{"id":14,"slug":"doxxing","title":"Doxxing","shortDescription":"Sharing or enabling the discovery of someone’s real-world identifying information without their consent."},{"id":15,"slug":"impersonation","title":"Impersonation","shortDescription":"Pretending to be another person or entity in a way that misleads others about identity or authority."},{"id":13,"slug":"non-consensual-exposure-personal-information","title":"Non-Consensual Exposure of Personal Information","shortDescription":"Sharing or publishing someone’s private or sensitive personal information without their consent."}]},{"id":3,"name":"Safety & Severe Harm","rules":[{"id":17,"slug":"incitement-of-harm","title":"Incitement or endorsement of harm","shortDescription":"Encouraging, praising, or justifying physical harm or violence against people, groups, or locations."},{"id":18,"slug":"terrorism","title":"Terrorism or Mass-Casualty Advocacy","shortDescription":"Promoting, praising, or encouraging acts intended to cause mass casualties or terrorize populations."},{"id":16,"slug":"threats-of-violence","title":"Threats of Violence","shortDescription":"Expressing an intent to cause physical harm to a person, group, or location."}]},{"id":4,"name":"Sexual Exploitation","rules":[{"id":19,"slug":"sexual-exploitation-minors","title":"Minors","shortDescription":"Sexual exploitation of minors involves any sexual content, interaction, or conduct that targets, involves, or uses a minor in a sexualized way, regardless of intent or perceived consent."},{"id":20,"slug":"non-consensual-sexual-content","title":"Non-consensual Sexual Content","shortDescription":"Non-consensual sexual content involves creating, sharing, or threatening to share sexualized material involving a person without their clear and meaningful consent."},{"id":21,"slug":"trafficking-coercion","title":"Trafficking or Coercion","shortDescription":"Trafficking or coercion involves using force, threats, manipulation, or dependency to compel sexual activity, sexual content, or sexual access against a person’s will."}]}]}
```

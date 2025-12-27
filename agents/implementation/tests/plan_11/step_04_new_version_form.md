# Step 04 — New version form: split guidance fields

Date: 2025-12-26

Goal:
- Update `/admin/rules/:id/versions/new` to show two guidance fields and persist both on submit.

Notes:
- Local test used `rule_id=15` and created a new version via `POST /admin/rules/15/versions/new`.
- Verified persistence by direct DB read of the latest `rule_versions` row (guidance_agents_markdown populated).

DB verification (excerpt):
```js
{
  version: 3,
  guidance_agents_markdown: 'Agent guidance new version 2025-12-26\\n'
}
```


### 2025-12-26T15:50:32+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/rules/15/versions/new`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>New Rule Version</title>
    <style>
      html, body { margin: 0; padding: 0; font-family: system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; background: #05070a; color: #f5f5f5; }
      a { color: #9cf; }
      main { max-width: 880px; margin: 0 auto; padding: 20px 16px 40px; line-height: 1.5; }
      h1 { font-size: 1.7rem; margin-bottom: 0.5rem; }
      table { width: 100%; border-collapse: collapse; margin-top: 1rem; font-size: 0.9rem; }
      th, td { border-bottom: 1px solid rgba(255,255,255,0.15); padding: 6px 4px; text-align: left; }
      th { font-weight: 600; font-size: 0.8rem; text-transform: uppercase; letter-spacing: 0.03em; opacity: 0.8; }
      input[type="text"], textarea, select {
        width: 100%;
        box-sizing: border-box;
        padding: 6px 8px;
        border-radius: 6px;
        border: 1px solid rgba(255,255,255,0.3);
        background: rgba(0,0,0,0.6);
        color: #f5f5f5;
        font-family: inherit;
        font-size: 0.95rem;
      }
      textarea { min-height: 220px; resize: vertical; }
      label { display: block; margin-top: 10px; font-size: 0.9rem; }
      .field-hint { font-size: 0.8rem; opacity: 0.7; margin-top: 2px; }
      .actions { margin-top: 14px; display: flex; gap: 10px; align-items: center; }
      button {
        padding: 6px 12px;
        border-radius: 999px;
        border: 1px solid rgba(255,255,255,0.35);
        background: #1976d2;
        color: #fff;
        cursor: pointer;
        font-size: 0.9rem;
      }
      button.danger {
        background: #b71c1c;
        border-color: rgba(255,255,255,0.35);
      }
      button.danger:hover { background: #c62828; }
      .error { margin-top: 8px; color: #ffb3b3; font-size: 0.85rem; }
      .success { margin-top: 8px; color: #b3ffd2; font-size: 0.85rem; }
      .toolbar { display: flex; justify-content: space-between; align-items: center; gap: 8px; margin-top: 8px; }
      .toolbar a { font-size: 0.9rem; }
      .pill { display: inline-block; padding: 2px 8px; border-radius: 999px; border: 1px solid rgba(255,255,255,0.25); font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.04em; opacity: 0.85; }
    </style>
  </head>
  <body>
    <main>
<h1>New Rule Version</h1><div class="toolbar"><div><a href="/admin/rules">← Back to rules</a></div></div><form method="post" action="/admin/rules/15/versions/new"><input type="hidden" name="csrf" value="<redacted>" /><p><strong>Rule:</strong> impersonation</p><p><strong>Category:</strong> Privacy &amp; Identity Abuse</p><label>Short Description
    <textarea name="shortDescription" style="min-height: 90px">Pretending to be another person or entity in a way that misleads others about identity or authority.</textarea>
  </label><label for="rule_markdown_v_15">Long Description</label><textarea id="rule_markdown_v_15" name="markdown" data-md-wysiwyg="1" data-md-initial-html="&lt;p&gt;Impersonation prohibits presenting oneself as another real person, organization, or authoritative entity in a manner that is likely to confuse others about who is speaking or acting. This includes using names, likenesses, credentials, accounts, or contextual signals that falsely suggest identity, endorsement, or official capacity.&lt;/p&gt;
&lt;p&gt;The rule applies whether the impersonation is direct or implied, and regardless of whether it is done as a joke, satire, experiment, or tactic. What matters is whether a reasonable observer could be misled about the source or authority of the content. The behavior is evaluated independently of the impersonator’s stated intent or claimed purpose.&lt;/p&gt;
&lt;p&gt;This distinction matters because impersonation undermines trust, distorts accountability, and can cause reputational, financial, or personal harm. When identity is falsified, others may rely on information, instructions, or representations they would not otherwise accept. Preventing impersonation protects the integrity of identity, consent, and attribution across interactions, while preserving space for clearly labeled parody, commentary, and role-play.&lt;/p&gt;">Impersonation prohibits presenting oneself as another real person, organization, or authoritative entity in a manner that is likely to confuse others about who is speaking or acting. This includes using names, likenesses, credentials, accounts, or contextual signals that falsely suggest identity, endorsement, or official capacity.

The rule applies whether the impersonation is direct or implied, and regardless of whether it is done as a joke, satire, experiment, or tactic. What matters is whether a reasonable observer could be misled about the source or authority of the content. The behavior is evaluated independently of the impersonator’s stated intent or claimed purpose.

This distinction matters because impersonation undermines trust, distorts accountability, and can cause reputational, financial, or personal harm. When identity is falsified, others may rely on information, instructions, or representations they would not otherwise accept. Preventing impersonation protects the integrity of identity, consent, and attribution across interactions, while preserving space for clearly labeled parody, commentary, and role-play.
</textarea><div class="field-hint">Markdown is rendered server-side using the restricted contract in <code>agents/requirements/markdown.md</code>.</div><label for="rule_allowed_v_15">Allowed Examples</label><textarea id="rule_allowed_v_15" name="allowedExamples" data-md-wysiwyg="1" data-md-initial-html="&lt;ul&gt;
&lt;li&gt;“This is a parody account.”&lt;/li&gt;
&lt;li&gt;“I am not affiliated with the company; these are my personal opinions.”&lt;/li&gt;
&lt;li&gt;“A fictional role-play scenario where I pretend to be a space captain.”&lt;/li&gt;
&lt;li&gt;“An actor reenacting a historical figure in a clearly labeled performance.”&lt;/li&gt;
&lt;li&gt;“A username that resembles a real person but makes no claim of being them.”&lt;/li&gt;
&lt;/ul&gt;">-   “This is a parody account.”
-   “I am not affiliated with the company; these are my personal opinions.”
-   “A fictional role-play scenario where I pretend to be a space captain.”
-   “An actor reenacting a historical figure in a clearly labeled performance.”
-   “A username that resembles a real person but makes no claim of being them.”
</textarea><label for="rule_disallowed_v_15">Disallowed Examples</label><textarea id="rule_disallowed_v_15" name="disallowedExamples" data-md-wysiwyg="1" data-md-initial-html="&lt;ul&gt;
&lt;li&gt;“I am a customer support agent for this company—DM me your account details.”&lt;/li&gt;
&lt;li&gt;“Posting under someone else’s name to respond as if you are them.”&lt;/li&gt;
&lt;li&gt;“Using an official logo and tone to make people believe this is a real government notice.”&lt;/li&gt;
&lt;li&gt;“Creating an account that looks like a real person’s profile and interacting as them.”&lt;/li&gt;
&lt;li&gt;“Claiming professional credentials you do not have to gain trust or authority.”&lt;/li&gt;
&lt;/ul&gt;">-   “I am a customer support agent for this company—DM me your account details.”
-   “Posting under someone else’s name to respond as if you are them.”
-   “Using an official logo and tone to make people believe this is a real government notice.”
-   “Creating an account that looks like a real person’s profile and interacting as them.”
-   “Claiming professional credentials you do not have to gain trust or authority.”
</textarea><label for="rule_guidance_moderators_v_15">Guidance for Moderators</label><textarea id="rule_guidance_moderators_v_15" name="guidanceModerators" data-md-wysiwyg="1" data-md-initial-html="&lt;h3 id=&quot;purpose-of-this-rule&quot;&gt;Purpose of This Rule&lt;/h3&gt;
&lt;p&gt;This rule exists to protect trust, attribution, and accountability by preventing false representations of identity or authority. It reduces harm caused when people rely on statements, instructions, or endorsements that appear to come from someone they do not.&lt;/p&gt;
&lt;h3 id=&quot;primary-evaluation-questions&quot;&gt;Primary Evaluation Questions&lt;/h3&gt;
&lt;ul&gt;
&lt;li&gt;Does this content present the speaker as a specific real person, organization, or authority they are not?&lt;/li&gt;
&lt;li&gt;Would a reasonable observer believe the speaker is acting on behalf of the impersonated party?&lt;/li&gt;
&lt;li&gt;Is identity, role, or authority being used to gain trust, compliance, or credibility?&lt;/li&gt;
&lt;li&gt;Is any parody, role-play, or fiction clearly and unambiguously labeled?&lt;/li&gt;
&lt;/ul&gt;
&lt;h3 id=&quot;context-sensitivity&quot;&gt;Context Sensitivity&lt;/h3&gt;
&lt;p&gt;Tolerance varies by culture, but deception does not.&lt;/p&gt;
&lt;p&gt;In low-tolerance cultures, even subtle or partial identity mimicry may qualify.&lt;/p&gt;
&lt;p&gt;In higher-tolerance cultures, impersonation typically requires clearer likelihood of confusion.&lt;/p&gt;
&lt;p&gt;Context affects sensitivity, not the core definition of impersonation.&lt;/p&gt;
&lt;h3 id=&quot;distinguishing-from-related-rules&quot;&gt;Distinguishing From Related Rules&lt;/h3&gt;
&lt;ul&gt;
&lt;li&gt;&lt;strong&gt;Impersonation&lt;/strong&gt; focuses on false identity or authority.&lt;/li&gt;
&lt;li&gt;&lt;strong&gt;Privacy &amp;amp; Identity Abuse&lt;/strong&gt; focuses on misuse or exposure of real personal information.&lt;/li&gt;
&lt;li&gt;&lt;strong&gt;Fraud or Scams&lt;/strong&gt; may apply when impersonation is used to extract money or credentials.&lt;/li&gt;
&lt;li&gt;&lt;strong&gt;Parody or Satire&lt;/strong&gt; is allowed when clearly labeled and not misleading.&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;    Escalate to impersonation when identity confusion is the primary harm.&lt;/p&gt;
&lt;h3 id=&quot;intent-vs-impact&quot;&gt;Intent vs Impact&lt;/h3&gt;
&lt;p&gt;Intent is secondary.&lt;/p&gt;
&lt;p&gt;Even if framed as a joke, test, experiment, or commentary, impersonation is evaluated based on whether others are likely to be misled. Prioritize the impact of confusion or misplaced trust over the impersonator’s stated motivation.&lt;/p&gt;
&lt;h3 id=&quot;pattern-awareness&quot;&gt;Pattern Awareness&lt;/h3&gt;
&lt;p&gt;A single instance may qualify if the impersonation is clear and actionable.&lt;/p&gt;
&lt;p&gt;Repeated behavior, sustained role adoption, or identity reinforcement across posts increases severity and confidence of violation.&lt;/p&gt;
&lt;h3 id=&quot;guidance-for-ai-agents&quot;&gt;Guidance for AI Agents&lt;/h3&gt;
&lt;ul&gt;
&lt;li&gt;Detect claims of identity, role, credentials, or official capacity.&lt;/li&gt;
&lt;li&gt;Detect use of names, logos, language, or formats that signal authority.&lt;/li&gt;
&lt;li&gt;Do not assume parody unless it is explicit and prominent.&lt;/li&gt;
&lt;li&gt;Avoid inferring malicious intent; focus on likelihood of confusion.&lt;/li&gt;
&lt;li&gt;When identity signals are ambiguous, defer to human review.&lt;/li&gt;
&lt;/ul&gt;
&lt;h3 id=&quot;what-this-rule-is-not&quot;&gt;What This Rule Is Not&lt;/h3&gt;
&lt;ul&gt;
&lt;li&gt;It is not a ban on parody, satire, or fiction when clearly disclosed.&lt;/li&gt;
&lt;li&gt;It is not a restriction on criticizing public figures or institutions.&lt;/li&gt;
&lt;li&gt;It is not triggered by resemblance alone without misleading presentation.&lt;/li&gt;
&lt;li&gt;It does not require proof of harm having already occurred.&lt;/li&gt;
&lt;/ul&gt;
&lt;h3 id=&quot;moderator-anchor-statement&quot;&gt;Moderator Anchor Statement&lt;/h3&gt;
&lt;p&gt;If someone is made to believe you are another person or authority, and that belief matters, it is impersonation.&lt;/p&gt;">### Purpose of This Rule

This rule exists to protect trust, attribution, and accountability by preventing false representations of identity or authority. It reduces harm caused when people rely on statements, instructions, or endorsements that appear to come from someone they do not.

### Primary Evaluation Questions

-   Does this content present the speaker as a specific real person, organization, or authority they are not?
-   Would a reasonable observer believe the speaker is acting on behalf of the impersonated party?
-   Is identity, role, or authority being used to gain trust, compliance, or credibility?
-   Is any parody, role-play, or fiction clearly and unambiguously labeled?

### Context Sensitivity

Tolerance varies by culture, but deception does not.  
In low-tolerance cultures, even subtle or partial identity mimicry may qualify.  
In higher-tolerance cultures, impersonation typically requires clearer likelihood of confusion.  
Context affects sensitivity, not the core definition of impersonation.

### Distinguishing From Related Rules

-   **Impersonation** focuses on false identity or authority.
-   **Privacy &amp; Identity Abuse** focuses on misuse or exposure of real personal information.
-   **Fraud or Scams** may apply when impersonation is used to extract money or credentials.
-   **Parody or Satire** is allowed when clearly labeled and not misleading.  
    Escalate to impersonation when identity confusion is the primary harm.

### Intent vs Impact

Intent is secondary.  
Even if framed as a joke, test, experiment, or commentary, impersonation is evaluated based on whether others are likely to be misled. Prioritize the impact of confusion or misplaced trust over the impersonator’s stated motivation.

### Pattern Awareness

A single instance may qualify if the impersonation is clear and actionable.  
Repeated behavior, sustained role adoption, or identity reinforcement across posts increases severity and confidence of violation.

### Guidance for AI Agents

-   Detect claims of identity, role, credentials, or official capacity.
-   Detect use of names, logos, language, or formats that signal authority.
-   Do not assume parody unless it is explicit and prominent.
-   Avoid inferring malicious intent; focus on likelihood of confusion.
-   When identity signals are ambiguous, defer to human review.

### What This Rule Is Not

-   It is not a ban on parody, satire, or fiction when clearly disclosed.
-   It is not a restriction on criticizing public figures or institutions.
-   It is not triggered by resemblance alone without misleading presentation.
-   It does not require proof of harm having already occurred.

### Moderator Anchor Statement

If someone is made to believe you are another person or authority, and that belief matters, it is impersonation.
</textarea><label for="rule_guidance_agents_v_15">Guidance for AI Agents</label><textarea id="rule_guidance_agents_v_15" name="guidanceAgents" data-md-wysiwyg="1" data-md-initial-html="&lt;p&gt;Agent guidance test 2025-12-26&lt;/p&gt;">Agent guidance test 2025-12-26
</textarea><div class="field-hint">These fields are intended for moderators/admin and automated agents; do not expose them to regular users.</div><label>Change summary (optional)
    <input type="text" name="changeSummary" value="" />
    <div class="field-hint">Short description of what changed for this version (e.g., “Clarify harassment examples”).</div>
  </label><div class="actions">
    <button type="submit">Create version</button>
  </div></form>
<style>
  .md-wysiwyg { margin-top: 6px; }
  .ck.ck-editor__main>.ck-editor__editable { background: rgba(0,0,0,0.35); color: #f5f5f5; min-height: 220px; }
  .ck.ck-toolbar { background: rgba(0,0,0,0.55); border-color: rgba(255,255,255,0.2); }
  .ck.ck-button, .ck.ck-toolbar__separator { color: #f5f5f5; }
  .ck.ck-button:not(.ck-disabled):hover { background: rgba(255,255,255,0.08); }
  .ck.ck-editor__editable.ck-focused { border-color: rgba(153,204,255,0.8) !important; box-shadow: none !important; }
  .ck.ck-dropdown__panel { background: rgba(0,0,0,0.92); border-color: rgba(255,255,255,0.2); }
  .ck.ck-list { background: transparent; }
  .ck.ck-list__item .ck-button { color: #f5f5f5; }
  .ck.ck-list__item .ck-button .ck-button__label { color: #f5f5f5; }
  .ck.ck-list__item .ck-button:not(.ck-disabled):hover { background: rgba(255,255,255,0.08); }
  .ck.ck-list__item .ck-button.ck-on { background: #1976d2; color: #fff; }
  .ck.ck-list__item .ck-button.ck-on .ck-button__label { color: #fff; }
</style>
<script src="/vendor/ckeditor5/ckeditor.js"></script>
<script src="/vendor/turndown/turndown.js"></script>
<script src="/admin/ckeditor_markdown.js"></script>

    </main>
  </body>
</html>
```

### 2025-12-26T15:50:32+00:00
- Profile: `super`
- Request: `POST http://localhost:3300/admin/rules/15/versions/new`
- Status: `302`
```
Found. Redirecting to /admin/rules/15
```

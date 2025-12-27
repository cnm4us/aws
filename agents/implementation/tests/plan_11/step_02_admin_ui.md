# Step 02 — Admin draft UI: split guidance fields

Date: 2025-12-26

Goal:
- Update `/admin/rules/:id/edit` (Edit Draft) to split Guidance into:
  - Guidance for Moderators
  - Guidance for AI Agents

Notes:
- This file is appended to by `scripts/auth_curl.sh` via `AUTH_LOG_FILE` (it never logs Set-Cookie values).

Sanity check (label presence):
```bash
BASE_URL="http://localhost:3300" ./scripts/auth_curl.sh --profile super get "/admin/rules/7/edit" \
  | rg -n "Guidance for Moderators|Guidance for AI Agents|name=\\\"guidanceModerators\\\"|name=\\\"guidanceAgents\\\""
```

Output (excerpt):
```text
98:</textarea><label for="rule_draft_guidance_moderators_7">Guidance for Moderators</label><textarea id="rule_draft_guidance_moderators_7" name="guidanceModerators" ...
286:</textarea><label for="rule_draft_guidance_agents_7">Guidance for AI Agents</label><textarea id="rule_draft_guidance_agents_7" name="guidanceAgents" ...
```

### 2025-12-26T15:28:49+00:00
- Profile: `super`
- Request: `GET http://localhost:3300/admin/rules/7/edit`
- Status: `200`
```
<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
    <title>Edit Rule Draft</title>
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
<h1>Edit Draft: personal-attacks</h1><div class="toolbar"><div><a href="/admin/rules">← Back to rules</a></div></div><form method="post" action="/admin/rules/7/edit"><input type="hidden" name="csrf" value="<redacted>" /><label>Title
    <input type="text" name="title" value="Personal Attacks" />
  </label><label>Category
    <select name="categoryId">
      <option value="">—</option>
      <option value="1" selected>Civility &amp; Tone</option><option value="2">Privacy &amp; Identity Abuse</option><option value="3">Safety &amp; Severe Harm</option>
    </select>
  </label><label>Short Description
    <textarea name="shortDescription" style="min-height: 90px">Direct attacks, insults, or contempt directed at a person rather than their ideas.</textarea>
  </label><label for="rule_draft_markdown_7">Long Description</label><textarea id="rule_draft_markdown_7" name="markdown" data-md-wysiwyg="1" data-md-initial-html="&lt;p&gt;This rule prohibits language or behavior that targets a person rather than the substance of their ideas, contributions, or actions. Personal attacks include insults, contemptuous remarks, or character judgments that are directed at an individual or group of individuals, whether explicitly named or clearly implied. The defining feature of a personal attack is that its primary function is to demean, belittle, or invalidate a person, rather than to advance understanding, critique an argument, or discuss a topic in good faith.&lt;/p&gt;
&lt;p&gt;Criticism of ideas, beliefs, policies, or public positions is allowed under this rule, even when such criticism is strong or forceful. However, when criticism shifts from addressing what is being said to attacking who is saying it, the interaction degrades from discussion into hostility. Personal attacks tend to escalate conflict, discourage participation, and undermine the purpose of spaces intended for constructive or pleasant engagement, particularly in low-heat cultures where conversational safety and approachability are prioritized.&lt;/p&gt;
&lt;p&gt;Context matters when evaluating potential violations. Statements that may be tolerated in adversarial or high-conflict cultures may violate this rule in low-heat or supportive environments, where even mild insults or dismissive language can have a chilling effect. Repeated or targeted personal attacks may indicate a broader pattern of harassment and should be evaluated in conjunction with related rules. The intent behind a statement and its likely impact on participants should both be considered when determining whether this rule applies.&lt;/p&gt;">This rule prohibits language or behavior that targets a person rather than the substance of their ideas, contributions, or actions. Personal attacks include insults, contemptuous remarks, or character judgments that are directed at an individual or group of individuals, whether explicitly named or clearly implied. The defining feature of a personal attack is that its primary function is to demean, belittle, or invalidate a person, rather than to advance understanding, critique an argument, or discuss a topic in good faith.

Criticism of ideas, beliefs, policies, or public positions is allowed under this rule, even when such criticism is strong or forceful. However, when criticism shifts from addressing what is being said to attacking who is saying it, the interaction degrades from discussion into hostility. Personal attacks tend to escalate conflict, discourage participation, and undermine the purpose of spaces intended for constructive or pleasant engagement, particularly in low-heat cultures where conversational safety and approachability are prioritized.

Context matters when evaluating potential violations. Statements that may be tolerated in adversarial or high-conflict cultures may violate this rule in low-heat or supportive environments, where even mild insults or dismissive language can have a chilling effect. Repeated or targeted personal attacks may indicate a broader pattern of harassment and should be evaluated in conjunction with related rules. The intent behind a statement and its likely impact on participants should both be considered when determining whether this rule applies.
</textarea><label for="rule_draft_allowed_7">Allowed Examples</label><textarea id="rule_draft_allowed_7" name="allowedExamples" data-md-wysiwyg="1" data-md-initial-html="&lt;p&gt;Critique of ideas, positions, or behavior without targeting the person&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;“I disagree with this argument and think it overlooks key evidence.”&lt;/li&gt;
&lt;li&gt;“That policy proposal would likely have harmful consequences.”&lt;/li&gt;
&lt;li&gt;“I don’t find this explanation convincing.”&lt;/li&gt;
&lt;li&gt;“This claim doesn’t seem well supported by the sources provided.”&lt;/li&gt;
&lt;li&gt;“I think this approach is misguided.”&lt;/li&gt;
&lt;/ul&gt;">Critique of ideas, positions, or behavior without targeting the person

-   “I disagree with this argument and think it overlooks key evidence.”
-   “That policy proposal would likely have harmful consequences.”
-   “I don’t find this explanation convincing.”
-   “This claim doesn’t seem well supported by the sources provided.”
-   “I think this approach is misguided.”
</textarea><label for="rule_draft_disallowed_7">Disallowed Examples</label><textarea id="rule_draft_disallowed_7" name="disallowedExamples" data-md-wysiwyg="1" data-md-initial-html="&lt;p&gt;Language whose primary function is to demean or attack a person&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;“You’re an idiot.”&lt;/li&gt;
&lt;li&gt;“Only a moron would think this.”&lt;/li&gt;
&lt;li&gt;“You clearly don’t know what you’re talking about.”&lt;/li&gt;
&lt;li&gt;“Anyone who believes this is stupid.”&lt;/li&gt;
&lt;li&gt;“You’re just embarrassing yourself.”&lt;/li&gt;
&lt;/ul&gt;">Language whose primary function is to demean or attack a person

-   “You’re an idiot.”
-   “Only a moron would think this.”
-   “You clearly don’t know what you’re talking about.”
-   “Anyone who believes this is stupid.”
-   “You’re just embarrassing yourself.”
</textarea><label for="rule_draft_guidance_moderators_7">Guidance for Moderators</label><textarea id="rule_draft_guidance_moderators_7" name="guidanceModerators" data-md-wysiwyg="1" data-md-initial-html="&lt;h2 id=&quot;purpose-of-this-rule&quot;&gt;Purpose of This Rule&lt;/h2&gt;
&lt;p&gt;The goal of this rule is to preserve constructive participation by preventing language that targets people rather than ideas. Personal attacks shift conversations away from substance and toward hostility, which discourages engagement and escalates conflict—especially in low-heat or supportive cultures.&lt;/p&gt;
&lt;p&gt;This rule is about protecting the conversational environment, not adjudicating who is right.&lt;/p&gt;
&lt;h2 id=&quot;primary-evaluation-questions&quot;&gt;Primary Evaluation Questions&lt;/h2&gt;
&lt;p&gt;When reviewing content for this rule, ask:&lt;/p&gt;
&lt;ol&gt;
&lt;li&gt;Who or what is being targeted?&lt;/li&gt;
&lt;/ol&gt;
&lt;ul&gt;
&lt;li&gt;A &lt;em&gt;person or group of people&lt;/em&gt; → likely a personal attack&lt;/li&gt;
&lt;li&gt;An &lt;em&gt;idea, claim, policy, or argument&lt;/em&gt; → likely allowed&lt;/li&gt;
&lt;/ul&gt;
&lt;ol&gt;
&lt;li&gt;What is the primary function of the statement?&lt;/li&gt;
&lt;/ol&gt;
&lt;ul&gt;
&lt;li&gt;To demean, insult, or belittle → violation&lt;/li&gt;
&lt;li&gt;To critique, disagree, or analyze → allowed&lt;/li&gt;
&lt;/ul&gt;
&lt;ol&gt;
&lt;li&gt;Would the statement still be acceptable if references to a person were removed?&lt;/li&gt;
&lt;/ol&gt;
&lt;ul&gt;
&lt;li&gt;If yes → likely allowed&lt;/li&gt;
&lt;li&gt;If no → likely a personal attack&lt;/li&gt;
&lt;/ul&gt;
&lt;h2 id=&quot;context-sensitivity&quot;&gt;Context Sensitivity&lt;/h2&gt;
&lt;p&gt;Tolerance for personal attacks varies by culture:&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;&lt;strong&gt;LOW-HEAT / PLEASANT SPACES:&lt;/strong&gt;&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;    Even mild insults or dismissive language may violate this rule.&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;&lt;strong&gt;Supportive Spaces:&lt;/strong&gt;&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;    Very low tolerance. Language that could discourage vulnerability should be treated as a violation.&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;&lt;strong&gt;Politics / Policy or Adversarial Spaces:&lt;/strong&gt;&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;    Strong critique is expected, but direct insults toward people remain violations.&lt;/p&gt;
&lt;p&gt;Do not excuse personal attacks solely because a space allows disagreement.&lt;/p&gt;
&lt;h2 id=&quot;distinguishing-from-related-rules&quot;&gt;Distinguishing From Related Rules&lt;/h2&gt;
&lt;p&gt;Use this rule when:&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;The harm is tone-based and person-directed&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;Escalate or switch rules when:&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;The behavior is repeated or targeted over time → Harassment&lt;/li&gt;
&lt;li&gt;The attack targets identity, belief, or worldview → Belief &amp;amp; Worldview Respect&lt;/li&gt;
&lt;li&gt;The language denies humanity or personhood → Dehumanization&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;Multiple rules may apply; cite the most specific primary harm.&lt;/p&gt;
&lt;h2 id=&quot;intent-vs-impact&quot;&gt;Intent vs Impact&lt;/h2&gt;
&lt;p&gt;Intent does not need to be malicious for a violation to occur.&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;Focus on likely impact on participants&lt;/li&gt;
&lt;li&gt;Especially consider whether the language would discourage reasonable users from participating&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;Avoid over-weighting claims of humor, sarcasm, or frustration when the impact is clearly degrading.&lt;/p&gt;
&lt;h2 id=&quot;pattern-awareness&quot;&gt;Pattern Awareness&lt;/h2&gt;
&lt;p&gt;A single mild insult may warrant:&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;Warning or soft intervention&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;Repeated instances, even if individually mild, may indicate:&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;Escalation toward harassment&lt;/li&gt;
&lt;li&gt;Bad-faith participation&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;Agents should surface patterns; moderators should evaluate context.&lt;/p&gt;
&lt;h2 id=&quot;guidance-for-ai-agents&quot;&gt;Guidance for AI Agents&lt;/h2&gt;
&lt;p&gt;When classifying content:&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;Prefer precision over breadth&lt;/li&gt;
&lt;li&gt;Do not infer hidden intent&lt;/li&gt;
&lt;li&gt;Anchor decisions in:&lt;/li&gt;
&lt;li&gt;Target (person vs idea)&lt;/li&gt;
&lt;li&gt;Language function (insult vs critique)&lt;/li&gt;
&lt;li&gt;Cultural tolerance level&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;If uncertain, flag for human review rather than auto-enforcing.&lt;/p&gt;
&lt;h2 id=&quot;what-this-rule-is-not&quot;&gt;What This Rule Is Not&lt;/h2&gt;
&lt;p&gt;This rule does not prohibit:&lt;/p&gt;
&lt;ul&gt;
&lt;li&gt;Strong disagreement&lt;/li&gt;
&lt;li&gt;Moral condemnation of ideas&lt;/li&gt;
&lt;li&gt;Negative assessments of policies or arguments&lt;/li&gt;
&lt;li&gt;Frustrated or emotional expression that does not target a person&lt;/li&gt;
&lt;/ul&gt;
&lt;p&gt;Avoid using this rule to sanitize debate or suppress dissent.&lt;/p&gt;
&lt;h2 id=&quot;one-line-moderator-anchor&quot;&gt;One-Line Moderator Anchor&lt;/h2&gt;
&lt;p&gt;If the statement makes participation feel unsafe or humiliating because of who someone is rather than what they said, this rule likely applies.&lt;/p&gt;">## Purpose of This Rule

The goal of this rule is to preserve constructive participation by preventing language that targets people rather than ideas. Personal attacks shift conversations away from substance and toward hostility, which discourages engagement and escalates conflict—especially in low-heat or supportive cultures.

This rule is about protecting the conversational environment, not adjudicating who is right.

## Primary Evaluation Questions

When reviewing content for this rule, ask:

1.  Who or what is being targeted?
    -   A *person or group of people* → likely a personal attack
    -   An *idea, claim, policy, or argument* → likely allowed
2.  What is the primary function of the statement?
    -   To demean, insult, or belittle → violation
    -   To critique, disagree, or analyze → allowed
3.  Would the statement still be acceptable if references to a person were removed?
    -   If yes → likely allowed
    -   If no → likely a personal attack

## Context Sensitivity

Tolerance for personal attacks varies by culture:

-   **LOW-HEAT / PLEASANT SPACES:**  
    Even mild insults or dismissive language may violate this rule.
-   **Supportive Spaces:**  
    Very low tolerance. Language that could discourage vulnerability should be treated as a violation.
-   **Politics / Policy or Adversarial Spaces:**  
    Strong critique is expected, but direct insults toward people remain violations.

Do not excuse personal attacks solely because a space allows disagreement.

## Distinguishing From Related Rules

Use this rule when:

-   The harm is tone-based and person-directed

Escalate or switch rules when:

-   The behavior is repeated or targeted over time → Harassment
-   The attack targets identity, belief, or worldview → Belief &amp; Worldview Respect
-   The language denies humanity or personhood → Dehumanization

Multiple rules may apply; cite the most specific primary harm.

## Intent vs Impact

Intent does not need to be malicious for a violation to occur.

-   Focus on likely impact on participants
-   Especially consider whether the language would discourage reasonable users from participating

Avoid over-weighting claims of humor, sarcasm, or frustration when the impact is clearly degrading.

## Pattern Awareness

A single mild insult may warrant:

-   Warning or soft intervention

Repeated instances, even if individually mild, may indicate:

-   Escalation toward harassment
-   Bad-faith participation

Agents should surface patterns; moderators should evaluate context.

## Guidance for AI Agents

When classifying content:

-   Prefer precision over breadth
-   Do not infer hidden intent
-   Anchor decisions in:
    -   Target (person vs idea)
    -   Language function (insult vs critique)
    -   Cultural tolerance level

If uncertain, flag for human review rather than auto-enforcing.

## What This Rule Is Not

This rule does not prohibit:

-   Strong disagreement
-   Moral condemnation of ideas
-   Negative assessments of policies or arguments
-   Frustrated or emotional expression that does not target a person

Avoid using this rule to sanitize debate or suppress dissent.

## One-Line Moderator Anchor

If the statement makes participation feel unsafe or humiliating because of who someone is rather than what they said, this rule likely applies.
</textarea><label for="rule_draft_guidance_agents_7">Guidance for AI Agents</label><textarea id="rule_draft_guidance_agents_7" name="guidanceAgents" data-md-wysiwyg="1" data-md-initial-html=""></textarea><div class="field-hint">These fields are intended for moderators/admin and automated agents; do not expose them to regular users.</div><label for="rule_draft_change_summary_7">Change summary (optional; used on Publish)</label><input id="rule_draft_change_summary_7" type="text" name="changeSummary" value="" /><div class="field-hint">Short description of what changed in this published version (e.g., “Clarify harassment examples”).</div><div class="actions"><button type="submit" name="action" value="save">Save</button><button type="submit" name="action" value="publish">Publish Version</button></div></form><div class="field-hint" style="margin-top: 10px">Save updates the draft only. Publish creates a new immutable version and updates the current published version.</div>
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

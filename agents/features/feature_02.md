Canonical Guidance
Personal Space, Global Feed, and Context Integrity
Purpose

This document defines the conceptual model, UX semantics, and hard boundaries between:

Personal Space

Channels & Groups

Global Feed

The goal is to:

Prevent context collapse

Preserve consent and accountability

Enable discovery without coercion

Ensure moderation is legible and defensible

Encode human social gradients into the product

This is not a social media clone.
It is context-respecting social infrastructure.

1. Foundational Assumptions

The system assumes:

Humans are multi-contextual

Identity is persistent

Attention is consensual

Intimacy must be invited or earned

Discovery must not collapse boundaries

Accountability requires clarity, not anonymity theater

Design choices must reinforce these assumptions, not undermine them.

2. Canonical Mental Model (Authoritative)

Use this model consistently in planning and implementation:

Personal Space = Gallery / Living Room

Identity-centered

Curated

Often intimate

Access-controlled

Channels & Groups = Rooms

Topic-first

Norm-governed

Moderated

Contextual participation

Global Feed = Billboard / Front Porch / Directory

Discovery-only

Broadcast

Non-intimate

Read-only

These are different publishing actions, not destinations with shared defaults.

3. Publishing Scopes (First-Class Concept)

Publishing must always be explicitly scoped at creation time.

There is no implicit cross-posting.

3.1 Publish to Personal Space

Intent: “This represents me.”

Audience: Explicitly permitted viewers

Discoverability: Off by default

Privacy: Granular, invitation-based

Does NOT imply Global or Channel visibility

Personal Space is never auto-populated.

3.2 Publish to Channel or Group

Intent: “I’m participating here.”

Audience: Members/followers of that space

Governed by space-specific rules

Credibility applies per space

Does NOT imply Personal or Global inclusion

Channels and Groups are the primary locations for conversation, engagement, and reputation.

3.3 Publish to Global Feed

Intent: “Broadcast for discovery.”

Audience: Everyone

Purpose: Introduce content, creators, and spaces

No comments

No likes

No credibility impact

Critical Rule:

Publishing to Global does NOT imply publishing to Personal Space.

Global is not an archive of identity.

4. Following Semantics (Do Not Collapse These)

“Following a person” is not a single relationship.

4.1 Follow (Global)

Meaning:
“I want to see what this person chooses to broadcast publicly.”

Low intimacy

No permission required

No personal access

No reciprocity implied

4.2 Follow in Space (Channel / Group)

Meaning:
“I value how this person shows up here.”

Scoped to that space only

No bleed into other topics

Reinforces context integrity

4.3 Access Personal Space (High Intimacy)

Meaning:
“I’m requesting access to selectively shared content.”

Never automatic

Requires:

Explicit request, or

Explicit invitation, or

Explicit mutual rule (optional, advanced)

Rule:

No one follows a human directly into their personal space.

This transition must feel like an invitation, not an entitlement.

5. Personal Space Privacy Model
5.1 Nominal Personal Profile (Always On)

Minimal, inert, cannot be disabled:

Name / handle

Avatar

Optional one-line bio

Purpose:

Accountability without exposure

Identity without forced intimacy

5.2 Personal Content Privacy

Personal content must support:

Explicit audience controls

Invitation / approval workflows

No default discoverability

No automatic inclusion from other scopes

6. Global Feed: Role & Restrictions
6.1 What Global Is

Global is a discovery index, not a social surface.

It exists to answer:

“What kinds of spaces and voices exist here?”

It is:

A buffet

A directory

A signpost

Not:

A debate arena

A credibility engine

A popularity contest

6.2 Global Interaction Rules (By Design)

In Global:

Comments: OFF

Likes / reactions: OFF

Engagement metrics: OFF

Credibility impact: NONE

All engagement happens inside context-rich spaces.

7. Global Content Rules
“All-Ages Restaurant” Standard

Global content must be appropriate for:

A restaurant full of families, grandparents, coworkers, and strangers.

This does not mean bland.
It does mean context-aware.

7.1 Allowed in Global

Informational content

Educational content

Creative previews

Invitations to channels or groups

Teasers without explicit detail

Global is for invitation, not depth.

7.2 Disallowed in Global

Even if allowed elsewhere:

Explicit sexual content

Graphic sexual discussion

Pornographic or fetish material

Explicit violence

Hate speech or demeaning language

Shock content

Harassment or provocation

If content requires:

age-gating, content warnings, or insider context
it does not belong in Global.

8. Moderation Philosophy (Especially for Global)

Because Global is shared by everyone:

Standards are higher

Enforcement is faster

Edge-pushing tolerance is lower

However:

Rules are articulated

Enforcement reasons are explicit

Sanctions are proportional and scoped

Identity is not erased

Recovery is possible

Moderation questions to ask:

Is this appropriate for a mixed, all-ages audience?

Is this inviting discovery or provoking reaction?

Is this pointing to a space, or trying to be the space?

9. Hard Boundary Rules (Non-Negotiable)

Personal ≠ Global

Publishing is explicit and scoped

Following ≠ personal access

Context determines visibility

Intimacy requires consent

Discovery must not collapse identity

Engagement belongs in governed spaces

Global is broadcast-only

10. Architectural Intent (For Codex)

Codex should:

Treat publish scope as first-class data

Treat follow relationships as contextual objects

Encode UX friction at boundary crossings

Preserve explainability and user intent

Avoid shared defaults across scopes

Codex must not:

Auto-cross-post

Auto-grant personal access

Infer intimacy from engagement

Optimize for reach at the expense of context

Introduce hidden reputation mechanics in Global

11. Product Philosophy (Why This Exists)

This system is designed to:

Respect multi-dimensional humans

Preserve contextual identity

Protect users from unwanted exposure

Make explicit spaces safer by keeping them opt-in

Replace algorithmic manipulation with legible rules

This is not censorship.
This is consensual attention design.
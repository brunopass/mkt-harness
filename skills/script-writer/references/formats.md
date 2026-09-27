# Platform formats & specs (checked against knowledge up to mid-2026)

Platforms change limits often. Items marked **(verify)** were uncertain or recently changed when this was written:
check the platform's help centre or the composer itself before relying on them, and fix this file when you learn more.

## Instagram
- Caption: 2,200 chars; first ~125 chars show before "more" → hook goes there.
- Hashtags: 3-5 relevant ones (Instagram has said many hashtags don't help). A hard cap of 5 per post was reported in
  late 2025 **(verify)**; historically 30.
- Feed image/carousel: 4:5 portrait 1080×1350 (our renderer's size). The profile grid shows a 3:4 crop, so keep text
  away from the top/bottom ~90px. Carousels: up to 20 items.
- Reels: 9:16, 1080×1920; up to 3 minutes for Reels (longer uploads possible) **(verify)**; cover 1080×1920 with the
  centre 1080×1440 safe for the grid. On-screen text safe zone: avoid the bottom ~20% and right ~15% (UI overlays).
- Stories: 9:16, 60s per segment; link sticker works for all accounts.
- Links: not clickable in captions → "link na bio" / keyword-comment → DM delivery.
- Keyword-comment flows: reply to the comment publicly ("te mandei na DM!") and DM the asset (see lead-magnet).

## TikTok
- Caption: up to 4,000 chars **(verify)**; the first line is what people read; use searchable keywords (TikTok is a
  search engine for Gen Z/millennials).
- Video: 9:16 1080×1920; posts up to 10 min in-app (longer via upload) **(verify)**; 21-45s is the sweet spot for
  reach + completion; hook in 1-2s.
- Hashtags: 3-5 (1 broad + 2-3 niche + 1 branded). Trending sounds via Creative Center; commercial accounts must use
  the Commercial Music Library.
- Links: not clickable in captions; bio link needs 1,000 followers for personal accounts / available for business
  accounts **(verify)**.
- Photo mode carousels exist (up to 35 images) **(verify)**.

## YouTube Shorts
- 9:16, up to 3 minutes (since Oct 2024). Title ≤ 100 chars (aim ≤ 60), description 5,000 chars; first line matters for search.
- Hashtags: 1-3 in title/description (#shorts is optional).
- Upload natively; don't reuse videos with TikTok/IG watermarks (reach penalty on all platforms).

## LinkedIn
- Post: 3,000 chars; "…see more" after ~140 chars on mobile / ~210 desktop → hook + second line must carry it.
- Comments: 1,250 chars. Connection note: 300 chars (free accounts get a limited number of personalised notes per
  month **(verify)**). InMail subject 200, body 1,900.
- Document (PDF) posts = carousels: 1080×1350 or 1080×1080, up to 300 pages / 100MB; title required.
- Images 1200×627 (link style) or 1080×1350 (portrait, more feed space). Video: up to 10 min (15 desktop) **(verify)**,
  vertical 4:5/9:16 supported; captions burned-in or SRT (most watch muted).
- Hashtags: 0-3. Links in the body tend to reduce reach **(verify, debated)** → first comment or "link in comments".
- Personal profiles usually out-reach company pages 5-10×: B2B brands should post from founders/team (their own real
  accounts, with their consent), and pages reshare.

## X (Twitter)
- Post: 280 chars (free); Premium up to 25,000 **(verify tiers)**. Threads: 5-10 posts.
- Images: up to 4 per post; 16:9 or 1:1 display best; GIF 15MB; video up to 2:20 (free) **(verify)**.
- Links: external links are reported to be deprioritised for non-Premium accounts **(verify)** → put the link in a reply.
- Hashtags: 0-2. DMs are now "Chat" for many accounts (2025) **(verify)**.

## Threads
- Post: 500 chars; 1 link per post; up to 20 images/videos in a carousel **(verify)**; video up to 5 min **(verify)**.
- Topic tag: 1 per post (Threads uses one "topic" instead of many hashtags).
- Replies drive reach; ask a question.

## Facebook
- Post: 63,206 chars but 40-80 chars get the most engagement; long posts show "See more" after ~480 chars.
- Reels 9:16 (same assets as IG). Images 1080×1350 / 1080×1080. Links are clickable in posts.
- Pages vs profile: brand = Page; groups for community.

## WhatsApp
- Message: 4,096 chars; formatting: *bold*, _italic_, ~strike~, ```mono```; lists with "- ".
- Cold messaging needs opt-in (policy-enforced). Business API: free-form only within 24h of the customer's last
  message; outside it approved templates only (`subject: "template:<name>:<lang>"`).
- Status (stories): 9:16, 60s videos, 24h.
- Voice notes are normal in Brazil and LATAM; text is safer for first contact.

## Email
- Subject 30-50 chars (4-7 words); preview text 40-90 chars; mobile first (60%+ opens).
- Cold email: plain text, 50-125 words, one link max (ideally none in touch 1), no images/attachments, opt-out line
  added automatically by the harness for cold `email`.
- Newsletter: 1 main CTA; alt text on images; ~600px wide if HTML.

## Image and video quick reference
| Placement | Ratio | Pixels |
|---|---|---|
| IG/FB feed, LinkedIn doc/portrait, carousel | 4:5 | 1080×1350 |
| Square fallback | 1:1 | 1080×1080 |
| Reels, TikTok, Shorts, Stories, Status | 9:16 | 1080×1920 |
| LinkedIn/X link image, YouTube thumbnail | ~1.91:1 / 16:9 | 1200×627 / 1280×720 |

## Posting-time heuristics (starting points, replace with our own data)
- B2B LinkedIn: Tue-Thu 07:30-09:30 and 12:00-13:00 local time of the audience.
- Instagram/TikTok B2C: weekdays 11:00-13:00 and 19:00-22:00; Sunday evening strong in BR.
- Stagger the same asset across platforms by ≥ 1-2 hours; never post identical text on multiple accounts at the same minute.

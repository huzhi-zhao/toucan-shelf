/**
 * Sample content for the blog skin preview.
 *
 * Exists so the outward-facing look can be judged before any of it is wired to
 * real data: no site has to be created, nothing has to be published, and the
 * dev server needs no backend. Delete this file (and the preview route) once
 * the skin renders real publication records.
 *
 * Covers are inline SVG so the preview is self-contained offline.
 */

import type { BlogBlock, BlogNavNode, BlogPost, BlogSiteChrome } from "./types";

type CoverVariant = "arcs" | "grid" | "stack";

const coverShapes = (variant: CoverVariant, ink: string): string => {
  if (variant === "arcs") {
    return [80, 150, 220, 290]
      .map((r) => `<circle cx="150" cy="330" r="${r}" fill="none" stroke="${ink}" stroke-opacity="0.28" stroke-width="1.5"/>`)
      .join("");
  }
  if (variant === "grid") {
    const lines = [];
    for (let x = 60; x <= 540; x += 60) lines.push(`<line x1="${x}" y1="40" x2="${x}" y2="360" stroke="${ink}" stroke-opacity="0.2"/>`);
    for (let y = 70; y <= 340; y += 68) lines.push(`<line x1="40" y1="${y}" x2="560" y2="${y}" stroke="${ink}" stroke-opacity="0.2"/>`);
    lines.push(`<rect x="180" y="138" width="180" height="136" rx="20" fill="${ink}" fill-opacity="0.16"/>`);
    return lines.join("");
  }
  return [0, 1, 2, 3]
    .map(
      (i) =>
        `<rect x="${110 + i * 26}" y="${96 + i * 34}" width="300" height="52" rx="14" fill="${ink}" fill-opacity="${0.3 - i * 0.06}"/>`,
    )
    .join("");
};

const cover = (from: string, to: string, ink: string, variant: CoverVariant): string => {
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 600 400">` +
    `<defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${from}"/><stop offset="1" stop-color="${to}"/></linearGradient></defs>` +
    `<rect width="600" height="400" fill="url(#g)"/>${coverShapes(variant, ink)}</svg>`;
  return `data:image/svg+xml,${encodeURIComponent(svg)}`;
};

const day = (iso: string) => new Date(`${iso}T09:00:00`);

const BYLINE = "ToucanShelf 笔记";

export const previewPosts: BlogPost[] = [
  {
    slug: "knowledge-garden",
    title: "Treat your notes like a garden, not an inbox",
    summary:
      "An inbox is finished when it is empty. A garden is finished when it is still growing. The same tool becomes two different things.",
    tags: ["Method", "Notes"],
    coverUrl: cover("#dfe9fb", "#f4f0e6", "#1b4fa8", "arcs"),
    updatedAt: day("2026-08-18"),
    byline: BYLINE,
    content: [
      "For the first year I treated my knowledge base as an inbox: everything went in, and one day I would sort it out.",
      "What actually happened is that every session was spent sorting, and almost none writing.",
      "",
      "## The problem with the inbox frame",
      "",
      "An inbox carries an implied definition of success — **empty**. But knowledge is never emptied, it only accumulates.",
      "Put something that will never be finished into a container whose goal is to be finished, and the only durable feeling is failure.",
      "",
      "A garden measures differently:",
      "",
      "- Not every plant has to thrive",
      "- A corner is allowed to lie fallow",
      "- The test is **whether what you planted last year is still growing**",
      "",
      "> One note from three years ago that you can still read and still want to edit beats a hundred links clipped this morning.",
      "",
      "## What I actually do now",
      "",
      "Two things only: give every note a title I could search for, and edit one sentence whenever I reread an old one.",
      "Time takes care of the rest.",
    ].join("\n"),
  },
  {
    slug: "snapshot-publishing",
    title: "Why a published page doesn't follow your edits",
    summary: "Live projection looks simpler, but it cannot coexist with checking what goes out before it goes out.",
    tags: ["Engineering", "Publishing"],
    coverUrl: cover("#e6efe8", "#dfe9fb", "#1f5f3f", "stack"),
    updatedAt: day("2026-08-21"),
    byline: BYLINE,
    content: [
      "The obvious design is: mark a document public, serve it live. Edit it, and the site updates. No second click.",
      "We did not do that.",
      "",
      "## Checks only ever happen on an action",
      "",
      "Before something goes out we check it: does it link to anything unpublished, does it carry a private file,",
      "does it contain an encrypted block?",
      "",
      "Those checks can only hang off **publishing** — the text keeps being edited afterwards, by the editor, by a sync,",
      "by an agent. Any one of those edits could carry something new straight out, and the author might not know the text changed at all.",
      "",
      "So what is live has to be **the version that was checked**, not the version that is newest. That is a snapshot.",
      "",
      "## What it costs",
      "",
      "It costs the author one extra click. For that cost not to read as confusion, the editor has to show that",
      "the published version is behind the current one, and offer to update right there. Without that,",
      "the model just feels like *I edited it and nothing happened*.",
      "",
      "The side benefit is that an agent quietly editing a published document cannot push it live — but the author still sees the difference.",
    ].join("\n"),
  },
  {
    slug: "comment-anchoring",
    title: "Anchoring comments to quoted text, not headings",
    summary: "Heading anchors look sturdier. They break the moment someone edits a heading, which is the most edited thing in a document.",
    tags: ["Engineering", "Editor"],
    coverUrl: cover("#f4ece2", "#efe4f0", "#7a4a2b", "grid"),
    updatedAt: day("2026-08-12"),
    byline: BYLINE,
    content: [
      "A comment has to point at somewhere in a document. There are two usual ways to say where.",
      "",
      "## Heading anchors",
      "",
      "Attach the comment to the nearest heading. Simple to build, but a heading is **the thing people edit most**,",
      "and everything under one heading can be pages long — the precision is close to none.",
      "",
      "## Quoted text",
      "",
      "Store the text that was selected, and find it again on reopen.",
      "",
      "```text",
      'quote:  "the same tool becomes two different things"',
      'prefix: "...a garden is finished when it is still growing."',
      "```",
      "",
      "A comment that cannot be found again **stays in the list** and can be reattached by hand.",
      "Dropping it is the worst option available: what gets dropped is something a person wrote.",
    ].join("\n"),
  },
  {
    slug: "hybrid-search",
    title: "What keyword and vector search are each good at",
    summary:
      "One finds the exact name you remember. The other finds the thing you remember differently. How you fuse them matters more than which model you pick.",
    tags: ["Engineering", "Search"],
    coverUrl: cover("#dfe9fb", "#e7e9ee", "#1b4fa8", "grid"),
    updatedAt: day("2026-08-06"),
    byline: BYLINE,
    content: [
      "## Where each one goes blind",
      "",
      "Keyword search nails `memogit`. Ask it for *how do I sync notes to git* and it returns nothing.",
      "Vector search is the mirror image: it recalls the related idea, but a specific function name or error code often slips past it.",
      "",
      "## Fusion",
      "",
      "We merge both result sets with RRF, then trim the tail by relative score.",
      "In practice **the fusion step matters more than swapping the embedding model**, because the blind spots are complementary:",
      "as long as one of the two kept the right answer, fusion can push it to the top.",
      "",
      "An instance with no embedding provider falls back to keyword-only and stays usable. That one is non-negotiable —",
      "search quality must never become a deployment prerequisite.",
    ].join("\n"),
  },
  {
    slug: "folder-rewrites",
    title: "Three times I rebuilt my folder structure",
    summary: "Every rebuild came from confusing where a thing belongs with what a thing is.",
    tags: ["Method"],
    coverUrl: cover("#f4f0e6", "#e6efe8", "#7a4a2b", "arcs"),
    updatedAt: day("2026-07-28"),
    byline: BYLINE,
    content: [
      "First by project. When the projects ended, everything became archaeology.",
      "Then by topic. A single note turned out to belong to three topics.",
      "Then I stopped: one flat level, search and tags for everything else.",
      "",
      "The conclusion I have kept: **folders hold what you are working on, tags say what a thing is.**",
      "Mixing those two is why no arrangement ever felt right.",
    ].join("\n"),
  },
  {
    slug: "reading-this-site",
    title: "What this site is",
    summary: "A subset of a knowledge base, picked and published on purpose. Not every note, and not a blog network.",
    tags: ["Start here"],
    coverUrl: cover("#efe4f0", "#dfe9fb", "#5b3b7a", "stack"),
    updatedAt: day("2026-08-23"),
    byline: BYLINE,
    content: [
      "Every page here lives in a knowledge base. What you are reading is a projection of it, frozen when it was published.",
      "Pages are picked one at a time, so this is neither everything I write nor anything that updates on its own.",
      "",
      "No subscriptions, no follows, no comment section. To find something, use the search above or the contents on the left.",
    ].join("\n"),
  },
];

/**
 * The authored navigation tree. Written by hand, not derived from where the
 * documents live: publishing paths and authoring paths are decoupled, and a
 * site can aggregate several knowledge bases with no shared folder structure.
 */
export const previewNav: BlogNavNode[] = [
  {
    label: "Start here",
    children: [{ label: "What this site is", slug: "reading-this-site" }],
  },
  {
    label: "Engineering notes",
    children: [
      { label: "Publishing and snapshots", slug: "snapshot-publishing" },
      { label: "Editor", slug: "comment-anchoring" },
      { label: "Search", slug: "hybrid-search" },
    ],
  },
  {
    label: "Method",
    children: [
      { label: "Notes as a garden", slug: "knowledge-garden" },
      { label: "Folder structure", slug: "folder-rewrites" },
    ],
  },
];

export const previewChrome: BlogSiteChrome = {
  name: "Field Notes",
  description: "A few things from a much larger notebook",
  menu: [
    { label: "Latest", to: "" },
    { label: "Contents", to: "catalog" },
  ],
  showSearch: true,
};

/**
 * How the author has arranged the home page: a heading they typed, three pages
 * they picked by hand, then everything else as a filterable feed.
 *
 * The point of the arrangement being data is that this is the author's, not the
 * product's — a different site puts the feed first, or has two galleries, or no
 * gallery at all.
 */
export const previewHome: BlogBlock[] = [
  {
    type: "markdown",
    content: [
      "# What I've been thinking about",
      "",
      "Halfway through building publishing, it turned out the hard part was never getting content out. It was deciding which version goes.",
    ].join("\n"),
  },
  {
    type: "gallery",
    tags: [],
    sort: "manual",
    slugs: ["snapshot-publishing", "knowledge-garden", "hybrid-search"],
    columns: 3,
  },
  {
    type: "feed",
    title: "All posts",
    tags: [],
    showTopicFilter: true,
  },
];

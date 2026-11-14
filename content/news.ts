export type NewsSection = {
  heading?: string;
  paragraphs: string[];
};

export type NewsArticle = {
  slug: string;
  title: string;
  date: string;
  summary: string;
  sections: NewsSection[];
};

/**
 * Newest first. Add an article here and it appears on /news and /news/[slug].
 * Keep the writing specific to dental design. Do not claim the product is
 * clinically validated, for sale, or already in use.
 */
export const news: NewsArticle[] = [
  {
    slug: "a-scan-is-not-a-design",
    title: "A Scan Is Not a Design",
    date: "2026-11-04",
    summary:
      "An intraoral scan records surfaces that already exist. A crown or a bridge is a new object that has to live among them.",
    sections: [
      {
        paragraphs: [
          "A dental scan is a careful record of what is already in the mouth. It holds the preparation, the neighbors, the opposing teeth, and a lot of surface that will never be part of the restoration. That record is the start of the work, not the restoration itself.",
          "A crown has to meet the margin, sit against the adjacent teeth, and clear the bite by a distance the material can actually survive. A bridge has to do that for more than one unit, and the units have to stay connected. None of that shape is sitting in the scan waiting to be copied.",
        ],
      },
      {
        heading: "The gap in the middle",
        paragraphs: [
          "Between the scan and the file a lab can mill there is a design. Someone, or some software, has to propose a surface that respects the anatomy and the material at the same time. Get the contacts tight and the bite opens. Open the bite and the wall gets thin. Move the margin and the fit changes.",
          "That is the part FAUCHAR is being built for. The aim is a proposal a professional can open, inspect, and change, not a file that skips the person who knows the case.",
        ],
      },
      {
        heading: "What the scan is good for",
        paragraphs: [
          "The scan is still the evidence. It says where the preparation ends, how close the neighbor is, and how much room the opposing tooth leaves. A design that ignores any of those is just a tooth shape floating in space.",
          "Reading that geometry well is the hard part. The triangles in a mesh do not arrive labeled as margin, contact, or occlusion. Turning them into a restoration someone can review is the work.",
        ],
      },
    ],
  },
  {
    slug: "crown-and-bridge",
    title: "Crown and Bridge, Same Question at Two Scales",
    date: "2026-10-21",
    summary:
      "A single crown asks what should replace one tooth. A bridge asks that question again, then asks how the answers hold together.",
    sections: [
      {
        paragraphs: [
          "A crown is one restoration on one preparation. The questions are already plenty: margin, proximal contacts, occlusal clearance, thickness, and the way the shape meets the tooth beside it.",
          "A bridge keeps every one of those questions and adds connectors. Each unit still has to fit its own place in the arch. The pieces also have to meet with enough material to hold, without closing the space the gums and the cleaning need.",
        ],
      },
      {
        heading: "Wider, not different",
        paragraphs: [
          "It is tempting to treat a bridge as a separate product. In the design room it is the same kind of decision, stretched across more teeth. The scan is wider. The proposal is wider. The review is longer, because a change on one unit moves the connector and the unit next to it.",
          "FAUCHAR is starting with the single crown, where the geometry can be studied closely. Bridge design is the same direction, not a different one. The homepage animation is there to show both, so the scope is visible before the software can do both.",
        ],
      },
    ],
  },
  {
    slug: "the-proposal-is-not-the-decision",
    title: "The Proposal Is Not the Decision",
    date: "2026-10-07",
    summary:
      "Software can suggest a restoration. The person responsible for the case still decides what leaves the lab.",
    sections: [
      {
        paragraphs: [
          "A generated crown can look finished and still be wrong for the patient in front of you. The margin can sit a little off the line the dentist cut. A contact can be heavy. The bite can be short on one cusp and long on another. Those are ordinary corrections. They are also the reason a proposal is not a result.",
          "The useful version of this software is the one that makes those corrections faster to see and faster to make. It should show the scan, the proposal, and the places a technician already knows to check.",
        ],
      },
      {
        heading: "What stays with the professional",
        paragraphs: [
          "FAUCHAR is being built so the professional reviews, edits, and exports. Margin, contacts, occlusion, and the surface itself stay editable. If a proposal is not good enough, it does not go out. That is a workflow choice, not a slogan.",
          "Nothing on this site is a claim that a model has been clinically validated, or that a design can be used without that review. The work in front of us is to make the proposal worth reviewing.",
        ],
      },
    ],
  },
];

export function getArticle(slug: string): NewsArticle | undefined {
  return news.find((article) => article.slug === slug);
}

export function formatNewsDate(iso: string): string {
  return new Date(`${iso}T00:00:00`).toLocaleDateString("en-GB", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

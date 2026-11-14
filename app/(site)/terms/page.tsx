import type { Metadata } from "next";
import LegalClient from "@/components/site/LegalClient";
import { termsHtml } from "@/content/termsHtml";

export const metadata: Metadata = {
  title: "Terms",
  description: "Terms of use for FAUCHAR dental intelligence.",
  robots: { index: true, follow: true },
};

export default function TermsPage() {
  return <LegalClient html={termsHtml} />;
}

import type { Metadata } from "next";
import LegalClient from "@/components/site/LegalClient";
import { privacyHtml } from "@/content/privacyHtml";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "Privacy policy for FAUCHAR dental intelligence.",
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  return <LegalClient html={privacyHtml} />;
}

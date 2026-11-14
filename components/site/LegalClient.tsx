"use client";

import { useEffect } from "react";
import { initLanding } from "@/lib/client/landing";

type Props = {
  html: string;
};

export default function LegalClient({ html }: Props) {
  useEffect(() => {
    document.documentElement.classList.add("js");
    document.body.classList.add("page-plain");
    delete document.documentElement.dataset.faucharLanding;
    initLanding();

    return () => {
      document.body.classList.remove("page-plain");
      delete document.documentElement.dataset.faucharLanding;
    };
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: html }} suppressHydrationWarning />;
}

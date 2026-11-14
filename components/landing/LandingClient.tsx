"use client";

import { useEffect } from "react";
import { landingHtml } from "@/content/landingHtml";
import { initLanding } from "@/lib/client/landing";
import { initCad } from "@/lib/client/cad";

export default function LandingClient() {
  useEffect(() => {
    document.documentElement.classList.add("js");
    initLanding();
    initCad();

    return () => {
      delete document.documentElement.dataset.faucharLanding;
      const cad = document.getElementById("cad");
      if (cad) delete cad.dataset.faucharCad;
    };
  }, []);

  return <div dangerouslySetInnerHTML={{ __html: landingHtml }} suppressHydrationWarning />;
}

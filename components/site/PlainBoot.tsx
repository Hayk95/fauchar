"use client";

import { useEffect } from "react";
import { initLanding } from "@/lib/client/landing";

export default function PlainBoot({ plain = true }: { plain?: boolean }) {
  useEffect(() => {
    document.documentElement.classList.add("js");
    document.body.classList.toggle("page-plain", plain);
    initLanding();

    return () => {
      document.body.classList.remove("page-plain");
      delete document.documentElement.dataset.faucharLanding;
    };
  }, [plain]);

  return null;
}

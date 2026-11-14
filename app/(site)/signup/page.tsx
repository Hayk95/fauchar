import { redirect } from "next/navigation";

/** Signup is temporarily disabled — accounts are created manually for now. */
export default function SignUpPage() {
  redirect("/signin");
}

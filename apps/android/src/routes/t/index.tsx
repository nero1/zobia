import { createFileRoute, redirect } from "@tanstack/react-router";
export const Route = createFileRoute("/t/")({
  beforeLoad: () => {
    throw redirect({ to: "/tales", replace: true });
  },
});

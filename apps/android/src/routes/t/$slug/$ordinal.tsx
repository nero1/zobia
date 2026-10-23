import { createFileRoute } from "@tanstack/react-router";
import { TalesView } from "@/components/tales/TalesView";
export const Route = createFileRoute("/t/$slug/$ordinal")({
  component: () => (
    <TalesView
      slug={Route.useParams().slug}
      ordinal={Number(Route.useParams().ordinal)}
    />
  ),
});

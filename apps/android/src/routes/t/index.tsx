import { createFileRoute } from "@tanstack/react-router";
import { TalesView } from "@/components/tales/TalesView";
export const Route = createFileRoute("/t/")({ component: () => <TalesView /> });
